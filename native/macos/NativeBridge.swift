import Foundation

private typealias Reply = @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void

// Swift owns this request until its one callback completes. Rust copies the reply synchronously.
private final class NativeRequest: @unchecked Sendable {
    let json: String
    let reply: Reply
    let context: UnsafeMutableRawPointer?
    init(json: String, reply: @escaping Reply, context: UnsafeMutableRawPointer?) {
        self.json = json; self.reply = reply; self.context = context
    }
}

@_cdecl("iris_native_request")
public func irisNativeRequest(_ json: UnsafePointer<CChar>?, _ reply: (@convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void)?, _ context: UnsafeMutableRawPointer?) {
    guard let json, let reply else { return }
    let request = NativeRequest(json: String(cString: json), reply: reply, context: context)
    Task { @MainActor in
        let result: [String: Any]
        if let data = request.json.data(using: .utf8),
           let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let args = payload["args"] as? [String] {
            result = await CaptureEngine.envelope(args, input: payload["input"] as? String)
        } else {
            result = ["ok": false, "error": ["code": "INVALID_ARGUMENT", "message": "Invalid native request."]]
        }
        let data = (try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])) ?? Data("{\"ok\":false,\"error\":{\"code\":\"NATIVE_PROTOCOL\",\"message\":\"Could not encode native reply\"}}".utf8)
        String(decoding: data, as: UTF8.self).withCString { request.reply($0, request.context) }
    }
}
