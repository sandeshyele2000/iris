import Foundation

@MainActor enum LaunchPermission {
    static func request(defaults: UserDefaults = .standard, granted: Bool, requestAccess: () -> Bool) -> Bool {
        let key = "iris.screenRecordingPermissionRequested"
        guard !defaults.bool(forKey: key) else { return granted }
        // Persist before asking so denying access cannot cause a request loop.
        defaults.set(true, forKey: key)
        return granted || requestAccess()
    }
}
