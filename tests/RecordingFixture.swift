import AppKit
import AVFoundation
import ScreenCaptureKit

// Feeds generated pixels to the writer without starting a screen stream or requesting access.
@main struct RecordingFixture {
    @MainActor static func main() async throws {
        let output = CommandLine.arguments[1]
        let empty = try ScreenRecording(path: output + ".empty.mp4", width: 320, height: 180)
        do {
            try await empty.stop()
            fatalError("An empty recording must fail")
        } catch let error as HelperFailure {
            precondition(error.code == "RECORDING_EMPTY")
            precondition(!FileManager.default.fileExists(atPath: output + ".empty.mp4"))
        }
        let recording = try ScreenRecording(path: output, width: 320, height: 180)
        var pixelBuffer: CVPixelBuffer?
        precondition(CVPixelBufferCreate(kCFAllocatorDefault, 320, 180, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixelBuffer) == kCVReturnSuccess)
        let pixels = pixelBuffer!
        CVPixelBufferLockBaseAddress(pixels, [])
        memset(CVPixelBufferGetBaseAddress(pixels), 180, CVPixelBufferGetDataSize(pixels))
        CVPixelBufferUnlockBaseAddress(pixels, [])
        var format: CMVideoFormatDescription?
        precondition(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixels, formatDescriptionOut: &format) == noErr)
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30),
            presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        precondition(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixels,
            formatDescription: format!, sampleTiming: &timing, sampleBufferOut: &sample) == noErr)
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample!, createIfNecessary: true)!
        let attachment = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: NSMutableDictionary.self)
        attachment[SCStreamFrameInfo.status.rawValue] = SCFrameStatus.complete.rawValue
        // This stream is never started. It supplies only the unused delegate argument.
        let stream = SCStream(filter: SCContentFilter(), configuration: SCStreamConfiguration(), delegate: nil)
        recording.stream(stream, didOutputSampleBuffer: sample!, of: .screen)
        try await Task.sleep(for: .seconds(1))
        try await recording.stop()
        let asset = AVURLAsset(url: URL(fileURLWithPath: output))
        let duration = try await asset.load(.duration).seconds
        precondition(duration >= 0.9 && duration < 4, "Static-screen duration was truncated")
        let tracks = try await asset.loadTracks(withMediaType: .video)
        precondition(tracks.count == 1)
        let size = try await tracks[0].load(.naturalSize)
        precondition(size.width == 320 && size.height == 180)
        let generator = AVAssetImageGenerator(asset: asset)
        let first = try await generator.image(at: .zero)
        let last = try await generator.image(at: CMTime(seconds: 0.8, preferredTimescale: 600))
        precondition(first.image.width == 320 && last.image.height == 180)
        print("Generated MP4: \(duration)s, 320x180; first and last frames decode; empty recording cleaned up")
    }
}
