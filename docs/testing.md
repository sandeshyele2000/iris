# Verification and acceptance

Verified on October 22, 2026 (Asia/Kolkata), Apple Silicon macOS 26.7, Swift 6.2.3, Node 24.19.0, pnpm 11.25.0, and Rust 1.99.1. Minimum deployment target is macOS 14.0. This is an implementation/build report, not a claim of completed company deployment acceptance.

## Automated suite

| Check | Result |
| --- | --- |
| Linked Swift library and fixture CLI targeting macOS 14, including region overlay and image services | Compiled |
| TypeScript + Vite production build | Passed |
| Frontend tests | 13 passed |
| Rust store/filesystem/native protocol tests | 9 passed |
| Rust clippy with warnings denied | Passed |
| Native fixture/diagnostic tests outside execution sandbox | 6 passed, 1 capture test skipped |
| Release `.app`, ad hoc signature verification | Built successfully; signature valid |
| Packaged app library/settings/diagnostics and native bridge IPC | Verified via native accessibility UI outside execution sandbox |
| Real authorized display capture | Not run: Iris process permission needs verification after migration; explicit opt-in test is supplied |

Frontend tests cover permission denial without capture, preservation of native errors, settings submission, empty library, window-dialog cancellation, pointer text placement, keyboard undo/redo, original restoration, immutable timeline branching, coordinate clipping, and rejection of malformed edit documents. Real canvas tests inspect cropped pixels, flattened annotations, pixelation changes, and preservation of pixels outside the selected area. Component tests mock IPC; they do not prove that the macOS webview or native capture succeeds.

Rust tests cover safe collision-resistant filenames, token expansion, exclusive writes, PNG payload validation, metadata persistence/reopen, rename/delete, stale entries, invalid IDs, symlink refusal, corrupt metadata, concurrent writers, failed-commit memory consistency, and startup cleanup of interrupted image writes.

Native tests generate a local text image rather than taking a screenshot. They verify image dimensions, actual PNG/JPEG signatures and decoded dimensions, thumbnail size, OCR content, exclusive output behavior, invalid-image errors, Screen Recording permission diagnostics, argument validation, and malformed capture input without invoking screen capture. The old preflight-denial test was removed because preflight no longer vetoes native API calls; running source enumeration in default tests could legitimately display a system prompt. Apple Vision failed inside the Codex execution sandbox with Foundation._GenericObjCError (0), and passed on the same fixture outside it. This difference is an execution-environment limitation; the test is not weakened to pass silently.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm native:build
pnpm test:native
pnpm test:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm app:build
```

Use the standard Node/pnpm/Rust toolchain; Cargo builds both the linked Swift library and the standalone test executable. Native tests require macOS and Xcode tools. Rust application tests require the macOS/Tauri development environment; frontend/model tests can run on standard Node CI. The provided GitHub workflow runs the complete suite on a macOS runner, with capture intentionally skipped.

## Authorized capture test

Only on a Mac where your organization authorizes capture and the test CLI has its own Screen Recording permission:

```sh
IRIS_TEST_CAPTURE=1 pnpm test:native
```

This test captures the first available display to a temporary PNG, checks actual decoded dimensions, and removes the fixture. Setting the variable is explicit consent to capture that display for testing; ensure no sensitive content is visible. It does not grant permission or alter MDM settings. Clipboard tests are manual so the default suite does not overwrite your clipboard.

## Required device acceptance

Use the final installed bundle and stable signing identity. Repeat on Apple Silicon and Intel before claiming both are supported in production.

1. **Permissions:** test fresh, denied, granted, revoked, and relaunch-required states. Check which responsible app macOS displays. Diagnostics must stay useful if the system command fails. Preserve native domain/code for an API failure; do not claim a successful capture from permission status alone.
2. **Displays:** connect two differently scaled monitors, including one with negative global coordinates. Refresh sources, select each, capture full display, and compare decoded PNG dimensions and pixels with the physical screen. Choose All displays and verify separate library records. Disconnect a selected display between listing and capture; expect a source error rather than a capture of the wrong display.
3. **Regions:** select each display, drag all four directions, capture near every edge, and verify pixel dimensions equal the selected points multiplied by the reported scale. Test 1× and Retina/HiDPI, display scaling, Escape, tiny drags, and native timeout. Confirm no dimming, outlines, dimension label, or Iris window is present in the saved image. Selections stay within the chosen display.
4. **Windows:** capture an external app, a partially occluded window, and a window on each monitor. Close/minimize/move it after enumeration. Check unavailable/protected windows report accurate errors. Test full-screen Spaces and protected content according to company policy.
5. **Imports/editor:** import a known PNG/JPEG without Screen Recording permission. Place arrows, shapes, multiline text, pixelation, and crops in sequence. Undo/redo, restore original, reopen after relaunch, and compare original bytes. Confirm Copy/OCR/Pin/Save reflect the current edits. Confirm discard/close navigation asks before losing unsaved changes.
6. **Exports:** save PNG and JPEG into the default and a user-chosen directory. Use Save as, cancel it, confirm replacement, and test an existing name, read-only destination, disk full, disconnected volume, and unavailable native helper. Do not show success before a completed write. Verify collision suffixes and actual PNG/JPEG contents.
7. **Clipboard/OCR:** copy an edited image and paste into Preview, Notes, a browser upload control, and your company’s common apps. Check both image and text paste workflows. Extract text from rotated/small/multilingual examples supported by the installed Vision models; OCR accuracy is not guaranteed for arbitrary content.
8. **Library:** rename, search, sort, reveal original/export, delete, and relaunch. Check that exported files survive library deletion. Remove an image externally and verify stale-entry removal. Interrupt an operation and restart; metadata should remain readable and generated orphan files should be cleaned. Preserve a backup before destructive acceptance tests.
9. **Desktop integration:** assign all three global shortcuts and a conflicting shortcut; ensure rollback and diagnostics. Trigger capture while another app is focused. Pin a preview, edit/re-pin it, confirm the pin updates and stays above other windows, and close it. Enable login launch, log out/in, and disable it again; confirm MDM rejection is reported. Do not enable login launch during unattended CI.
10. **Accessibility/appearance:** keyboard-tab every control, test VoiceOver names, dialog focus trapping/Escape/focus restoration, light/dark/system settings, minimum window size, and large text. Verify reduced-motion preference. Canvas drawing remains pointer-based; annotation tool selection and undo/redo are keyboard-accessible.
11. **Packaging/privacy:** inspect final architecture/signature/helper placement, test the installed signed bundle, notarize/staple/assess before managed deployment, and confirm no screenshot/metadata uploads. Repeat permission attribution after an upgrade under the same stable identity.

Scrolling capture is not implemented and is not part of acceptance. Cross-display region stitching, universal binary packaging, multi-user concurrency, crash-proof storage against malicious same-user processes, and enterprise retention enforcement are outside this implementation’s guarantees. Organization-specific acceptance and security review remain required before rollout.

## Iris regression checks

Verify the window title and app name are Iris, while diagnostics reports bundle ID `com.iris.screenshot`. With permission already granted, capture must proceed without another explicit permission request. Compare diagnostics from Iris itself, not the fixture CLI. Minimize the main window, press ⇧⌘2 or use the menu-bar Capture Area item, drag a rectangle, and confirm the editor opens on the persisted result. Repeat and press Escape; Iris should remain minimized. Background operations run in Rust and notify the UI after capture.

Before the complete identity rename, the Iris UI and in-process native bridge were inspected at runtime. ScreenCaptureKit returned user-denied `-3801`, and System Settings showed an enabled entry for an older build. Those observations do not verify capture under the new identity. The rebuilt `com.iris.screenshot` application requires its own grant and fresh runtime acceptance. No successful capture is claimed.

The complete project rename uses `com.iris.screenshot` and `iris-screenshot`. Earlier runtime permission observations describe the previous identity; reauthorize the rebuilt Iris app before capture acceptance.

## Screen recording

The native recording test feeds generated pixels into the MP4 writer without starting screen capture. It checks empty-recording cleanup, video dimensions, first/last frame decoding, and that a static screen retains its elapsed duration. Frontend tests cover start/stop, failed starts, and menu-bar state updates.

Manual acceptance: record a moving and static desktop, minimize and close the main window during recording, stop from the menu bar, check playback and duration in QuickTime, and quit during recording to confirm finalization. Test multiple displays, permission denial/revocation, display disconnection, and a full disk. No live screen recording runs in the default automated suite.
