import AppKit
let image = NSImage(size: NSSize(width: 640, height: 200))
image.lockFocus()
NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 640, height: 200).fill()
("IRIS LOCAL TEST" as NSString).draw(at: NSPoint(x: 25, y: 70), withAttributes: [.font: NSFont.systemFont(ofSize: 44), .foregroundColor: NSColor.black])
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
