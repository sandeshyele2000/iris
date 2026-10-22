# Troubleshooting

## Screen Recording

Capture and permission requests now run inside Iris itself, not a short-lived helper; another app’s grant is unrelated. Open Diagnostics → Request access. Enable the application macOS identifies under System Settings → Privacy & Security → Screen Recording (or Screen & System Audio Recording). Quit and reopen when requested. Use the final installed app for acceptance; Terminal, development launchers, and ad hoc builds can have different attribution or lose permission after rebuilding.

Iris checks Screen Recording permission and uses ScreenCaptureKit directly. Native errors retain their original domain and code.

## Error meanings

| Code | Action |
| --- | --- |
| PERMISSION_REQUIRED | Grant the responsible app Screen Recording access and reopen it. |
| NATIVE_ERROR | Preserve domain/nativeCode; review actual API failure, Screen Recording permission, session, and source. |
| DISPLAY_UNAVAILABLE / WINDOW_UNAVAILABLE | Source disconnected or became unavailable. Refresh sources. |
| CANCELLED | User cancelled region selection; no screenshot was saved. |
| FILESYSTEM / SAVE_FAILED | Check directory permissions, disk space, and availability. Save to a directory you select through the native picker. |
| INVALID_IMAGE / IMAGE_TOO_LARGE | File is unreadable or exceeds encoded/pixel limits. Try a smaller PNG/JPEG. |
| FILE_MISSING | History metadata remains but its image is missing; remove the stale entry or restore a backup. |
| LIBRARY_IN_USE | Quit the other Iris process before launching a second instance. |
| LIBRARY_INVALID / LIBRARY_VERSION | Quit Iris. Preserve/backup the entire private library and restore a known-good library.json with its matching image revisions. Do not delete originals merely to reset metadata. |
| SHORTCUT_CONFLICT / INVALID_SHORTCUT | Change or disable the conflicting shortcut in Settings. Startup failures appear in Diagnostics. |
| LOGIN_FAILED | Login launch was rejected. Check company policy and Login Items in System Settings. |
| NATIVE_PROTOCOL / NATIVE_CANCELLED | Native bridge returned an invalid/missing reply; rebuild Iris and report the exact error. |
| DESKTOP_REQUIRED | Launch `pnpm app:dev`, rather than the browser-only `pnpm dev`. |

## Node fails with libsimdjson.30.dylib

This error is the machine’s Homebrew Node installation, before Iris starts. Use a working supported Node installation matching `.nvmrc`, then run `pnpm install --frozen-lockfile` and `pnpm app:dev`. Iris does not modify Homebrew or your shell profile.

## OCR inside an execution sandbox

Vision can return `Foundation._GenericObjCError (0)` when a command execution sandbox prevents access to local macOS services. The generated OCR fixture passed when run outside that sandbox. Verify the packaged app under the normal user session. No remote OCR fallback exists. If the error persists outside the sandbox, include its domain/code and test image characteristics in diagnostics.

## Clipboard, pinning, and storage

Copy places flattened PNG and TIFF representations on the pasteboard. Test pasting into Preview, Notes, and your messaging/document apps. Other clipboard utilities can replace the contents. Pins are snapshots that refresh when pinned again; closing a pin does not delete its library entry. Deleting a library entry preserves previously exported files. The original remains unredacted until that private capture is deleted.

Iris stores its private library under `~/Library/Application Support/com.iris.capture/library/`; export default is `~/Pictures/IrisCaptures`. Existing Phase 1 files under `captures/` are left untouched. Import an image manually if you want it in the new library. The previous `com.iris.screenshot/library` is moved automatically on first launch if the new library does not exist. Quit the older Iris process before launching the new identity. Existing destination libraries are preserved. Do not modify library files while Iris is running. The next startup cleans recognized files left by interrupted operations; it preserves unrelated filenames.

## Permission was granted but the app asks again

The earlier build used a separate executable for permission checks and stopped on a false preflight result. Iris now links the native engine into its own process, lets ScreenCaptureKit decide access, and does not automatically repeat the permission request after a failure. The app now uses `com.iris.capture` and a matching application-data directory, so earlier permission grants do not transfer. Quit the earlier build and open the new `Iris.app`. Do not grant access to the standalone test CLI expecting it to grant Iris access.

A prior grant may still refer to an older ad hoc-signed binary or a different installed copy. macOS can require one grant/relaunch for the new build. Use a stable installed location and Developer ID identity for distribution. 

## Area capture while minimized

Minimize Iris with the title-bar button or its minimize icon. Press the configured area shortcut (default ⇧⌘2), or choose **Capture Area** from Iris's menu-bar icon. The native overlay appears on the display under the pointer; drag to capture or press Escape to cancel. Successful capture opens the editor; cancellation leaves Iris minimized. The shortcut and tray path execute in Rust and do not depend on a minimized webview handling an input event.

Earlier runtime inspection found an enabled entry for a previous build while the updated executable received `-3801`. After the complete identity rename, use the + button to select `src-tauri/target/release/bundle/macos/Iris.app`, enable it, and quit/reopen Iris. A stable Developer ID build in a stable installed location is recommended to avoid grant changes after ad hoc rebuilds.
