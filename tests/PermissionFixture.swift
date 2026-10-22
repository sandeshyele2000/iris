import Foundation

@main struct PermissionFixture {
    @MainActor static func main() {
        let suite = "com.iris.screenshot.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var requests = 0
        let deny = { requests += 1; return false }
        precondition(!LaunchPermission.request(defaults: defaults, granted: false, requestAccess: deny))
        precondition(requests == 1)
        precondition(!LaunchPermission.request(defaults: defaults, granted: false, requestAccess: deny))
        precondition(requests == 1, "Denied access must not be requested again on launch")
        precondition(LaunchPermission.request(defaults: defaults, granted: true, requestAccess: deny))
        precondition(requests == 1)
        defaults.removePersistentDomain(forName: suite)
        precondition(LaunchPermission.request(defaults: defaults, granted: true, requestAccess: deny))
        precondition(requests == 1, "An existing grant must skip the request")
        defaults.removePersistentDomain(forName: suite)
        precondition(LaunchPermission.request(defaults: defaults, granted: false, requestAccess: { requests += 1; return true }))
        precondition(requests == 2)
        print("First launch requests once; denial never loops; existing grants skip requests")
    }
}
