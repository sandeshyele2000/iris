import Foundation
import ScreenCaptureKit

@main struct PermissionAccessFixture {
    @MainActor static func main() async {
        var probes = 0
        let passive = await CaptureEngine.permissionSnapshot(verifyAccess: false, preflight: false, probe: { probes += 1 })
        precondition(probes == 0 && passive["permissionState"] as? String == "unverified")
        let granted = await CaptureEngine.permissionSnapshot(verifyAccess: true, preflight: false, probe: { probes += 1 })
        precondition(granted["permissionGranted"] as? Bool == true, "Actual access must override stale preflight")
        let revoked = await CaptureEngine.permissionSnapshot(verifyAccess: true, preflight: true, probe: {
            throw NSError(domain: SCStreamErrorDomain, code: -3801)
        })
        precondition(revoked["permissionGranted"] as? Bool == false, "A previous grant must never hide revocation")
        precondition(revoked["permissionState"] as? String == "denied")
        let unavailable = await CaptureEngine.permissionSnapshot(verifyAccess: true, preflight: true, probe: {
            throw NSError(domain: NSCocoaErrorDomain, code: 4)
        })
        precondition(unavailable["permissionState"] as? String == "unverified", "Other API failures must not be called permission denial")
        print("Verified access overrides stale preflight; revocation and unrelated errors remain accurate")
    }
}
