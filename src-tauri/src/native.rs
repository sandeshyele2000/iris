use crate::store::{Result, failure};
use serde_json::{Value, json};
use std::ffi::{CStr, CString, c_char, c_void};
use tokio::sync::oneshot;

type Reply = unsafe extern "C" fn(*const c_char, *mut c_void);
unsafe extern "C" {
    fn iris_native_request(json: *const c_char, reply: Reply, context: *mut c_void);
}
type Sender = oneshot::Sender<Result<Value>>;

fn decode(reply: &[u8]) -> Result<Value> {
    let envelope: Value =
        serde_json::from_slice(reply).map_err(|e| failure("NATIVE_PROTOCOL", e))?;
    if envelope["ok"] == true {
        envelope
            .get("result")
            .cloned()
            .ok_or_else(|| failure("NATIVE_PROTOCOL", "Missing native result"))
    } else {
        Err(envelope
            .get("error")
            .cloned()
            .unwrap_or_else(|| failure("NATIVE_PROTOCOL", "Missing native error")))
    }
}
unsafe extern "C" fn completed(json: *const c_char, context: *mut c_void) {
    // Swift calls this exactly once and keeps the C string alive for this callback.
    let sender = unsafe { Box::from_raw(context.cast::<Sender>()) };
    let result = if json.is_null() {
        Err(failure("NATIVE_PROTOCOL", "Empty native reply"))
    } else {
        decode(unsafe { CStr::from_ptr(json) }.to_bytes())
    };
    let _ = sender.send(result);
}
pub async fn call(args: &[String], input: Option<String>) -> Result<Value> {
    let payload = CString::new(json!({"args": args, "input": input}).to_string())
        .map_err(|e| failure("NATIVE_INPUT", e))?;
    let (sender, receiver) = oneshot::channel();
    let context = Box::into_raw(Box::new(sender));
    // The entry point copies the request before returning and dispatches AppKit work to MainActor.
    unsafe { iris_native_request(payload.as_ptr(), completed, context.cast()) };
    receiver
        .await
        .map_err(|_| failure("NATIVE_CANCELLED", "Native operation ended without a reply"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_native_permission_error_and_domain() {
        let error = decode(br#"{"ok":false,"error":{"code":"PERMISSION_REQUIRED","domain":"SCStreamErrorDomain","nativeCode":-3801,"message":"Denied"}}"#).unwrap_err();
        assert_eq!(error["nativeCode"], -3801);
        assert_eq!(error["code"], "PERMISSION_REQUIRED");
    }
    #[test]
    fn validates_envelopes_and_preserves_results() {
        assert_eq!(
            decode(br#"{"ok":true,"result":{"width":42}}"#).unwrap()["width"],
            42
        );
        assert!(decode(b"invalid").is_err());
        assert!(decode(br#"{"ok":true}"#).is_err());
    }
}
