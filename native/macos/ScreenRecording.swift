import AppKit
import AVFoundation
import ScreenCaptureKit

// Writer state is confined to queue; ScreenCaptureKit delivers frames on that queue.
final class ScreenRecording: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let path: String
    private let queue = DispatchQueue(label: "com.iris.screenshot.recording")
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var stream: SCStream?
    private var firstTime: CMTime?
    private var lastFrame: CMSampleBuffer?
    private var failure: Error?
    private var finishing = false

    init(path: String, width: Int, height: Int) throws {
        self.path = path
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mp4)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000,
                                               AVVideoMaxKeyFrameIntervalKey: 60]
        ])
        input.expectsMediaDataInRealTime = true
        super.init()
        guard writer.canAdd(input) else {
            throw HelperFailure(code: "RECORDING_FAILED", message: "Video encoder is unavailable.")
        }
        writer.add(input)
        guard writer.startWriting() else {
            throw writer.error ?? HelperFailure(code: "RECORDING_FAILED", message: "Could not create the recording.")
        }
    }

    @MainActor func start(filter: SCContentFilter, configuration: SCStreamConfiguration) async throws {
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        self.stream = stream
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try await stream.startCapture()
        } catch {
            await cancel()
            throw error
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, !finishing, failure == nil, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int,
              status == SCFrameStatus.complete.rawValue else { return }
        guard input.isReadyForMoreMediaData else { return }
        let time = sampleBuffer.presentationTimeStamp
        if firstTime == nil {
            writer.startSession(atSourceTime: time)
            firstTime = time
        }
        if input.append(sampleBuffer) {
            lastFrame = sampleBuffer
        } else {
            failure = writer.error ?? HelperFailure(code: "RECORDING_FAILED", message: "Could not encode a video frame.")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async { self.failure = error }
    }

    private func cancel() async {
        await withCheckedContinuation { (reply: CheckedContinuation<Void, Never>) in
            queue.async {
                self.finishing = true
                self.writer.cancelWriting()
                try? FileManager.default.removeItem(atPath: self.path)
                reply.resume()
            }
        }
    }

    @MainActor func stop() async throws {
        // Finalize frames already received even if the display disconnected or permission changed.
        if let stream { try? await stream.stopCapture() }
        self.stream = nil
        try await withCheckedThrowingContinuation { (reply: CheckedContinuation<Void, Error>) in
            queue.async {
                self.finishing = true
                guard self.firstTime != nil, let last = self.lastFrame else {
                    self.writer.cancelWriting()
                    try? FileManager.default.removeItem(atPath: self.path)
                    reply.resume(throwing: self.failure ?? HelperFailure(code: "RECORDING_EMPTY", message: "No video frames were captured. Try recording again."))
                    return
                }
                // Repeat the last frame at stop time so a static screen retains its full duration.
                let end = CMClockGetTime(CMClockGetHostTimeClock())
                if end > last.presentationTimeStamp, self.input.isReadyForMoreMediaData {
                    var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: end, decodeTimeStamp: .invalid)
                    var finalFrame: CMSampleBuffer?
                    if CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: last, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &finalFrame) == noErr,
                       let finalFrame {
                        if !self.input.append(finalFrame) { self.failure = self.writer.error }
                    }
                }
                guard self.writer.status == .writing else {
                    try? FileManager.default.removeItem(atPath: self.path)
                    reply.resume(throwing: self.writer.error ?? HelperFailure(code: "RECORDING_FAILED", message: "Video encoding failed."))
                    return
                }
                self.writer.endSession(atSourceTime: CMTimeAdd(end, CMTime(value: 1, timescale: 30)))
                self.input.markAsFinished()
                self.writer.finishWriting {
                    self.queue.async {
                        if self.writer.status == .completed {
                            reply.resume()
                        } else {
                            try? FileManager.default.removeItem(atPath: self.path)
                            reply.resume(throwing: self.writer.error ?? self.failure ?? HelperFailure(code: "RECORDING_FAILED", message: "Could not save the recording."))
                        }
                    }
                }
            }
        }
    }
}

@MainActor enum RecordingController {
    private static var current: ScreenRecording?
    private static var changing = false

    static func run(_ args: [String]) async throws -> [String: Any]? {
        switch args.first {
        case "record-status" where args.count == 1:
            return ["active": current != nil]
        case "record-start" where args.count == 3:
            guard !changing, current == nil else {
                throw HelperFailure(code: "BUSY", message: "A recording is already running.")
            }
            guard let requestedID = UInt32(args[1]), args[2].hasPrefix("/"),
                  URL(fileURLWithPath: args[2]).pathExtension.lowercased() == "mp4" else {
                throw HelperFailure(code: "INVALID_ARGUMENT", message: "Expected a display ID and absolute MP4 output path.")
            }
            changing = true
            defer { changing = false }
            let content = try await CaptureEngine.shareableContent()
            let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) }
            let pointerID = (screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
            let id = requestedID == 0 ? pointerID : requestedID
            guard let display = content.displays.first(where: { $0.displayID == id }) else {
                throw HelperFailure(code: "DISPLAY_UNAVAILABLE", message: "Display disconnected. Refresh sources.")
            }
            let ownApps = content.applications.filter { $0.bundleIdentifier == "com.iris.screenshot" }
            let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])
            let config = SCStreamConfiguration()
            // H.264-compatible even dimensions, preserving aspect ratio up to 4K.
            let scale = min(1.0, min(3840.0 / Double(display.width), 2160.0 / Double(display.height)))
            config.width = max(2, Int(Double(display.width) * scale) / 2 * 2)
            config.height = max(2, Int(Double(display.height) * scale) / 2 * 2)
            config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            config.queueDepth = 5
            config.showsCursor = true
            config.capturesAudio = false
            let recording = try ScreenRecording(path: args[2], width: config.width, height: config.height)
            try await recording.start(filter: filter, configuration: config)
            current = recording
            return ["active": true]
        case "record-stop" where args.count == 1:
            guard !changing else { throw HelperFailure(code: "BUSY", message: "Recording is starting or stopping.") }
            guard let recording = current else { return ["active": false] }
            changing = true
            defer { current = nil; changing = false }
            try await recording.stop()
            return ["active": false, "path": recording.path]
        default:
            return nil
        }
    }
}
