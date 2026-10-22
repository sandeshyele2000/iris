import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct HelperFailure: Error {
    let code: String
    let message: String
}

struct CaptureEngine {
    @MainActor static var accessVerified = false

    @MainActor static func shareableContent() async throws -> SCShareableContent {
        // The capture API is authoritative. Preflight can lag behind a newly granted permission.
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        accessVerified = true
        return content
    }

    @MainActor static func run(_ args: [String], input: String? = nil) async throws -> [String: Any] {
        guard let command = args.first else {
            throw HelperFailure(code: "INVALID_ARGUMENT", message: "Expected diagnose, request-permission, sources, or capture <display-id> <output.png>.")
        }
        if let result = try imageService(args, input: input) { return result }
        if let result = try await RecordingController.run(args) { return result }
        switch command {
        case "diagnose" where args.count == 1:
            return ["permissionGranted": CGPreflightScreenCaptureAccess() || accessVerified,
                    "bundleIdentifier": Bundle.main.bundleIdentifier ?? "command-line diagnostic",
                    "processId": ProcessInfo.processInfo.processIdentifier,
                    "macOS": ProcessInfo.processInfo.operatingSystemVersionString]
        case "request-permission" where args.count == 1:
            return ["permissionGranted": CGPreflightScreenCaptureAccess() || accessVerified || CGRequestScreenCaptureAccess(),
                    "message": "If permission changed, quit and reopen the responsible app before capturing."]
        case "sources" where args.count == 1:
            let content = try await shareableContent()
            return ["displays": content.displays.map { display in
                ["id": display.displayID, "width": display.width, "height": display.height,
                 "x": display.frame.origin.x, "y": display.frame.origin.y] as [String: Any]
            }, "windows": content.windows.filter { $0.frame.width > 0 && $0.frame.height > 0 && $0.owningApplication?.bundleIdentifier != "com.iris.screenshot" }.map { window in
                ["id": window.windowID, "title": window.title ?? "Untitled",
                 "width": window.frame.width, "height": window.frame.height,
                 "application": window.owningApplication?.applicationName ?? "Unknown"] as [String: Any]
            }]
        case "capture" where args.count == 3,
             "capture-region" where args.count == 3,
             "capture-window" where args.count == 3:
            guard let requestedID = UInt32(args[1]), (requestedID > 0 || command != "capture-window"), args[2].hasPrefix("/"),
                  URL(fileURLWithPath: args[2]).pathExtension.lowercased() == "png" else {
                throw HelperFailure(code: "INVALID_ARGUMENT", message: "Expected a numeric source ID and absolute PNG output path.")
            }
            let content = try await shareableContent()
            let pointerScreen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) }
            let pointerID = (pointerScreen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
            let sourceID = requestedID == 0 ? pointerID : requestedID
            let filter: SCContentFilter
            var region: CGRect?
            if command == "capture-window" {
                guard let window = content.windows.first(where: { $0.windowID == sourceID }) else {
                    throw HelperFailure(code: "WINDOW_UNAVAILABLE", message: "Window is unavailable. Refresh sources.")
                }
                filter = SCContentFilter(desktopIndependentWindow: window)
            } else {
                guard let display = content.displays.first(where: { $0.displayID == sourceID }) else {
                    throw HelperFailure(code: "DISPLAY_UNAVAILABLE", message: "Display disconnected. Refresh sources.")
                }
                // Exclude Iris windows, including pinned previews, using its own bundle identity.
                let ownApps = content.applications.filter { $0.bundleIdentifier == "com.iris.screenshot" }
                filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])
                if command == "capture-region" { region = try await selectRegion(displayID: sourceID) }
            }
            let config = SCStreamConfiguration()
            let size = region?.size ?? filter.contentRect.size
            if let region { config.sourceRect = region }
            config.width = Int((size.width * Double(filter.pointPixelScale)).rounded())
            config.height = Int((size.height * Double(filter.pointPixelScale)).rounded())
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            try writeImage(image, path: args[2])
            return ["path": args[2], "width": image.width, "height": image.height, "displayId": sourceID]
        default:
            throw HelperFailure(code: "INVALID_ARGUMENT", message: "Unknown command or incorrect argument count.")
        }
    }

    @MainActor static func envelope(_ args: [String], input: String? = nil) async -> [String: Any] {
        do { return ["ok": true, "result": try await run(args, input: input)] }
        catch let failure as HelperFailure { return ["ok": false, "error": ["code": failure.code, "message": failure.message]] }
        catch {
            let ns = error as NSError
            if ns.domain == SCStreamErrorDomain && ns.code == -3801 { accessVerified = false }
            return ["ok": false, "error": ["code": ns.domain == SCStreamErrorDomain && ns.code == -3801 ? "PERMISSION_REQUIRED" : "NATIVE_ERROR",
                "message": ns.domain == SCStreamErrorDomain && ns.code == -3801 ? "macOS denied Screen Recording access to Iris. Enable Iris in System Settings > Privacy & Security > Screen Recording, then quit and reopen Iris if macOS asks. \(ns.localizedDescription)" : ns.localizedDescription, "domain": ns.domain, "nativeCode": ns.code]]
        }
    }
}
