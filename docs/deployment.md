# Packaging and internal deployment

## Local build

```sh
pnpm install --frozen-lockfile
pnpm app:build
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/Iris.app"
```

The build runs the Swift compiler, TypeScript/Vite, Rust release build, and Tauri bundle packaging. Minimum supported macOS: 14.0. The manifest includes the screen-capture privacy description and app icon. Local configuration uses ad hoc signing (`-`), which is not Developer ID signing or notarization. Permission attribution must be retested for the final identity.

## Developer ID distribution

Use a CI/keychain setup with your real Developer ID Application certificate. Run from the repository root:

```sh
pnpm exec tauri build --bundles app --config '{"bundle":{"macOS":{"signingIdentity":"Developer ID Application: Your Company (TEAMID)"}}}'
```

Replace the example identity with the certificate installed in your keychain. The configuration override replaces local ad hoc signing. For automatic notarization, configure Tauri's supported Apple credentials through the build environment/secret manager; never commit credentials. Inspect the build output rather than assuming notarization occurred.

For a separate notarization workflow, configure a notarytool keychain profile, zip the signed application, submit it, then staple and assess it:

```sh
ditto -c -k --keepParent "src-tauri/target/release/bundle/macos/Iris.app" /tmp/Iris-Screenshot.zip
xcrun notarytool submit /tmp/Iris-Screenshot.zip --keychain-profile YOUR_PROFILE --wait
xcrun stapler staple "src-tauri/target/release/bundle/macos/Iris.app"
codesign --verify --deep --strict "src-tauri/target/release/bundle/macos/Iris.app"
spctl --assess --type execute --verbose=2 "src-tauri/target/release/bundle/macos/Iris.app"
```

These distribution commands are instructions, not claims of execution. This workspace does not contain your certificate or notarization credentials. Tauri signing configuration and platform requirements should be checked against [Tauri’s signing guide](https://v2.tauri.app/distribute/sign/macos/) and [Apple’s notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) in your release pipeline.

## Apple Silicon and Intel

Build on Apple Silicon for `aarch64-apple-darwin` and on an Intel Mac for `x86_64-apple-darwin`. Cargo's build script compiles the Swift static library for the Rust target architecture and links it into the application executable. The standalone fixture script is host-native and is not a production sidecar. Use separate native CI runners and distribute the tested matching bundle. Intel execution and universal packaging have not been verified here.

## Company rollout

1. Review source/dependencies and your company’s data retention/redaction requirements.
2. Complete the manual acceptance matrix on authorized Macs with representative monitors and applications.
3. Sign and notarize the final bundle using a stable bundle ID/team identity; verify the executable and the stable bundle identity.
4. Have IT review MDM restrictions, application-control policy, and supported PPPC configuration. Screen Recording permission may still require user action; do not promise silent granting.
5. Deploy the app to a stable location (typically `/Applications`) using your normal software-management process. Have users grant access to the responsible app identified by macOS.
6. Test installation, capture, clipboard paste, login launch, relaunch, and upgrades with the exact deployed identity. Login launch is opt-in via the official autostart plugin’s per-user LaunchAgent and is subject to company policy.
7. Back up the private library consistently while Iris is closed. Keep metadata and referenced image revisions together. Apply your retention policy to originals as well as exports.

No automatic update or upload service is included. Updates are delivered through your organization’s management system. Remove login launch before uninstalling; the private library and user exports are retained unless explicitly deleted by the user/administrator.
