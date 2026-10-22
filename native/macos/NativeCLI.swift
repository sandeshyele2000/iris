import AppKit
import Foundation

// Standalone fixture/diagnostic executable only. The app links CaptureEngine directly.
@main
struct NativeCLI {
    @MainActor static func main() async {
        NSApplication.shared.setActivationPolicy(.accessory)
        let result = await CaptureEngine.envelope(Array(CommandLine.arguments.dropFirst()))
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) { print(json) }
        if result["ok"] as? Bool != true { exit(1) }
    }
}
