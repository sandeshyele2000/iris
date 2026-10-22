import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func loadImage(_ path: String) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0, height > 0, width <= 32768, height <= 32768, width * height <= 160_000_000,
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: max(width, height)] as CFDictionary) else {
        throw HelperFailure(code: "INVALID_IMAGE", message: "Image is unreadable or exceeds the 160 megapixel / 32768 pixel limit.")
    }
    return image
}

func writeImage(_ image: CGImage, path: String, jpeg: Bool = false) throws {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, (jpeg ? UTType.jpeg : UTType.png).identifier as CFString, 1, nil) else {
        throw HelperFailure(code: "ENCODING_FAILED", message: "Could not initialize image encoder.")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.94] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw HelperFailure(code: "ENCODING_FAILED", message: "Image encoding failed.") }
    // Rust chooses unique paths; never silently replace an existing native output.
    try (data as Data).write(to: URL(fileURLWithPath: path), options: [.withoutOverwriting])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
}

@MainActor
func selectedPath(_ panel: NSSavePanel) -> [String: Any] {
    NSApplication.shared.activate(ignoringOtherApps: true)
    guard panel.runModal() == .OK, let path = panel.url?.path else { return ["path": NSNull()] }
    return ["path": path]
}

@MainActor
func imageService(_ args: [String], input: String? = nil) throws -> [String: Any]? {
    switch args.first {
    case "image-info" where args.count == 2:
        let image = try loadImage(args[1])
        return ["width": image.width, "height": image.height]
    case "thumbnail" where args.count == 3:
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 320, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else {
            throw HelperFailure(code: "INVALID_IMAGE", message: "Could not create thumbnail.")
        }
        try writeImage(image, path: args[2])
        return [:]
    case "convert" where args.count == 4 && ["png", "jpeg"].contains(args[3]):
        try writeImage(loadImage(args[1]), path: args[2], jpeg: args[3] == "jpeg")
        return [:]
    case "copy-image" where args.count == 2:
        let image = try loadImage(args[1])
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]), let tiff = rep.tiffRepresentation else {
            throw HelperFailure(code: "CLIPBOARD_FAILED", message: "Could not encode clipboard image.")
        }
        let board = NSPasteboard.general
        board.clearContents()
        guard board.setData(png, forType: .png), board.setData(tiff, forType: .tiff) else {
            throw HelperFailure(code: "CLIPBOARD_FAILED", message: "macOS rejected the clipboard image.")
        }
        return [:]
    case "copy-text" where args.count == 1:
        let data = input.map { Data($0.utf8) } ?? FileHandle.standardInput.readDataToEndOfFile()
        guard data.count <= 4_000_000, let text = String(data: data, encoding: .utf8) else { throw HelperFailure(code: "INVALID_ARGUMENT", message: "Invalid clipboard text.") }
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(text, forType: .string) else { throw HelperFailure(code: "CLIPBOARD_FAILED", message: "macOS rejected clipboard text.") }
        return [:]
    case "ocr" where args.count == 2:
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: loadImage(args[1])).perform([request])
        return ["text": (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")]
    case "open-image" where args.count == 1:
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.png, .jpeg, .tiff, .heic]
        return selectedPath(panel)
    case "choose-directory" where args.count == 1:
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
        panel.prompt = "Choose"
        return selectedPath(panel)
    case "save-dialog" where args.count == 4 && ["png", "jpeg"].contains(args[3]):
        let panel = NSSavePanel()
        panel.directoryURL = URL(fileURLWithPath: args[1])
        panel.nameFieldStringValue = args[2]
        panel.allowedContentTypes = [args[3] == "jpeg" ? .jpeg : .png]
        panel.canCreateDirectories = true
        return selectedPath(panel)
    case "reveal" where args.count == 2:
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: args[1])])
        return [:]
    case "open-permissions" where args.count == 1:
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"), NSWorkspace.shared.open(url) else {
            throw HelperFailure(code: "SETTINGS_FAILED", message: "Open System Settings > Privacy & Security > Screen Recording.")
        }
        return [:]
    default: return nil
    }
}
