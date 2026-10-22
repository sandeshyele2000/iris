import AppKit
import CoreGraphics

@MainActor
final class RegionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class RegionView: NSView {
    var start: NSPoint?
    var selection = CGRect.zero
    var complete: ((CGRect?) -> Void)?
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.35).setFill()
        let shade = NSBezierPath(rect: bounds)
        if !selection.isEmpty { shade.appendRect(selection); shade.windingRule = .evenOdd }
        shade.fill()
        NSColor.white.setStroke()
        NSBezierPath(rect: selection).stroke()
        let label = selection.isEmpty ? "Drag to select · Esc to cancel" : "\(Int(selection.width)) × \(Int(selection.height)) pt · Esc to cancel"
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 13, weight: .medium), .foregroundColor: NSColor.white, .backgroundColor: NSColor.black.withAlphaComponent(0.8)]
        (label as NSString).draw(at: NSPoint(x: max(12, selection.minX), y: max(12, selection.minY - 25)), withAttributes: attributes)
    }
    override func mouseDown(with event: NSEvent) { start = convert(event.locationInWindow, from: nil) }
    override func mouseDragged(with event: NSEvent) {
        guard let start else { return }
        let end = convert(event.locationInWindow, from: nil)
        selection = CGRect(x: min(start.x, end.x), y: min(start.y, end.y), width: abs(end.x - start.x), height: abs(end.y - start.y)).intersection(bounds)
        needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) {
        mouseDragged(with: event)
        complete?(selection.width >= 2 && selection.height >= 2 ? selection : nil)
        complete = nil
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { complete?(nil); complete = nil }
    }
}

@MainActor
func selectRegion(displayID: UInt32) async throws -> CGRect {
    guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID }) else {
        throw HelperFailure(code: "DISPLAY_UNAVAILABLE", message: "Display disconnected. Refresh displays and try again.")
    }
    let panel = RegionPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isReleasedWhenClosed = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hidesOnDeactivate = false
    panel.sharingType = .none
    let view = RegionView(frame: CGRect(origin: .zero, size: screen.frame.size))
    panel.contentView = view
    var selected: CGRect?
    view.complete = { rect in
        selected = rect
        NSApplication.shared.stopModal()
        panel.orderOut(nil)
    }
    NSApplication.shared.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(view)
    NSApplication.shared.runModal(for: panel)
    panel.close()
    guard let rect = selected else { throw HelperFailure(code: "CANCELLED", message: "Region capture cancelled.") }
    // Allow WindowServer to remove the selection surface before capture.
    try await Task.sleep(for: .milliseconds(200))
    return rect
}
