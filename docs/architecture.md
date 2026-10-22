# Architecture

## Process and trust boundaries

React handles navigation, preview, library browsing, settings forms, and editing interactions. `features/capture/api.ts` defines result and request types. Native invocations fail explicitly in browser previews. The webview receives image data URLs, not filesystem permissions or arbitrary executable paths.

Rust exposes a fixed set of commands, validates IDs and operation parameters, manages persistence and exports, hides/restores the app during capture, creates pinned windows, and coordinates the official Tauri global-shortcut and autostart plugins. Mutating image operations use a shared async operation lock; overlapping requests return BUSY. Store access uses a separate short-held mutex; it is never held across a native await.

Swift is statically linked into the Iris executable by `src-tauri/build.rs`, with macOS 14 minimum. Rust sends a JSON request through a small C ABI; Swift copies it before returning and dispatches AppKit/ScreenCaptureKit work to MainActor. A one-shot callback carries `{ok:true,result}` or `{ok:false,error:{code,message,domain?,nativeCode?}}` back to an awaited Rust channel. The reply pointer remains valid during the callback and is copied synchronously; the boxed Rust sender is consumed exactly once. Native UI operations remain alive until completion or user cancellation, rather than killing a separate process while a dialog is open. No screen capture or permission request runs in a sidecar. `NativeCLI.swift` is a separate fixture/diagnostic executable used only by tests, never bundled or launched by the app.

The product is Iris, the bundle ID is `com.iris.screenshot`, the Rust package/executable is `iris-screenshot`, and the standalone fixture executable is `iris-capture`. Private data is stored under the Iris bundle identifier. This identity change requires a new Screen Recording grant. A Developer ID signing identity is still needed for consistent distribution/upgrades; ad hoc rebuilds can invalidate macOS's earlier grants.

## Capture

ScreenCaptureKit access is attempted directly in the Iris process. `CGPreflightScreenCaptureAccess` is advisory in diagnostics and never vetoes a capture; it can lag a recent grant. The UI does not automatically call `CGRequestScreenCaptureAccess` after a failed source request. Explicit permission requests remain available in Diagnostics, and skip the request if preflight or a prior successful ScreenCaptureKit operation already establishes access. The OS can display its first-use prompt as part of native source enumeration. System failures are preserved; no fallback capture API is used.

`SCShareableContent` enumerates displays and available on-screen external application windows. Full-display filters exclude Iris’s own application windows. Window capture uses `SCContentFilter(desktopIndependentWindow:)`. `SCScreenshotManager.captureImage` is the only screen-image acquisition API. Pixel output sizes derive from `contentRect` and `pointPixelScale`; the returned image dimensions are used as the source of truth.

Region selection uses an AppKit borderless panel on the selected NSScreen (matched by `NSScreenNumber`, not array position). Its view has a top-left origin and returns local screen points, independent of negative global desktop origins. Dragging in either direction normalizes and clips the rectangle. Escape cancels. The panel runs a native modal event loop, closes before capture, and allows WindowServer 200 ms to remove it. The local rect becomes `SCStreamConfiguration.sourceRect`; its dimensions are multiplied by the filter’s point-to-pixel scale. Region selection does not cross display boundaries. “All displays” captures each monitor independently; no stitched desktop image is implied.

Rust hides individual Iris webviews before native capture so activating the native overlay cannot unhide the main app window. It restores prior visibility after selection; successful capture unminimizes the editor, while Escape preserves the minimized state. Display capture excludes the Iris bundle identity as an additional precaution. Region and mixed-Retina geometry still need acceptance on authorized hardware. Capture succeeds only when ScreenCaptureKit returns an image.

## Screen recording

ScreenCaptureKit streams one display to a serial queue and AVAssetWriter encodes H.264 MP4 at up to 3840×2160 and 30 fps, without audio. Iris windows are excluded; the cursor is included. The first complete frame establishes the writer timeline. On stop, the final frame is repeated at the current host-clock time so an idle desktop retains its full duration. Empty and failed recordings return errors and remove incomplete output.

Rust serializes start/stop with other image operations, generates the destination under the configured output directory, and emits state changes to the UI. The menu bar can stop and save while the app is minimized or hidden. Closing the main window during a recording hides it and preserves the webview; quit waits for video finalization. MP4s are exported directly rather than added to the image-only library. Abrupt process termination cannot finalize an in-progress MP4.

## Editor

The original PNG is immutable. Edits are serializable operations in image-pixel coordinates, with an immutable undo/redo timeline capped at 100 history snapshots. Crop establishes the coordinate space for subsequent operations. Arrows, outlined rectangles/ellipses, text, and pixelation render on canvas. Reopening replays validated operations against the original. Crop/pixelation bounds are normalized and clipped. Export/copy/OCR/pin flatten the current operations into a new PNG revision; they never overwrite the original. Restoring original is itself undoable.

Images are limited to 80 MiB encoded, 32768 pixels per axis, and 160 megapixels by the native decoder. Large images can still consume significant canvas memory; test your organization’s highest-resolution displays. Pixelation retains underlying originals in the private library. It is not a claim of irreversible redaction or information-theoretic removal.

## Persistence and file operations

A process-level file lock prevents concurrent writers. `library.json` contains schema version 1, settings, and records keyed by UUID. Records hold capture mode/source, ISO timestamp, dimensions, operations, selected rendered revision, and last export path. Image/thumbnail names are generated from validated UUIDs rather than renderer-provided paths.

Metadata commits use exclusive temporary files, file fsync, atomic rename, and directory fsync; memory is updated only after writing. Corrupt or unsupported metadata is reported without silently replacing it. Edited PNGs and thumbnails are versioned: bytes are complete before the new revision is committed, and old revision files are removed afterward. A failed edit does not damage a committed version. Originals remain immutable. Deletion commits removal from metadata before unlinking images; an interrupted operation can leave orphaned bytes but cannot introduce a broken live record. Startup reclaims recognized orphan/temp files while holding the exclusive lock; unrelated filenames are preserved. Missing files are flagged as stale history entries.

Library directories use mode 0700 and library image/metadata writes use 0600. Final image paths and metadata files reject symlinks. The code does not protect against a malicious process already running as the same user that races filesystem checks; it is not an App Sandbox container.

Only the native directory picker can change the persisted export directory. Save uses a sanitized filename template with date/time/mode tokens and a random suffix; exclusive writes prevent collisions. Save as uses a native panel, which confirms existing-file replacement, followed by a temp write and atomic rename. Export paths never originate from a webview text field. Image conversion, thumbnails, pasteboard PNG/TIFF representations, OCR (Vision), dialogs, and Finder reveal use documented local APIs.

## Desktop integration and capabilities

Global shortcuts are registered by Rust with `tauri-plugin-global-shortcut`. Invalid/duplicate/conflicting registrations return errors and settings changes attempt to restore previous bindings. Full-screen and region shortcuts run capture directly in Rust and work while the webview is minimized. Region selection uses the monitor under the pointer. Only window selection needs the main UI. A menu-bar menu exposes Capture Area, Capture Screen, Open Iris, and Quit Iris. Success emits a completed capture ID after persistence and opens the editor; Escape returns to the previous minimized state. Launch at login is opt-in via `tauri-plugin-autostart` using a per-user LaunchAgent; changes can be rejected by organizational policy. There is no privilege escalation.

Pinned previews use separate always-on-top webviews. Their capability permits only loading library images and listening for refresh events; they cannot export, modify metadata, capture, invoke a shell, or access arbitrary files. The main window can invoke only the declared application commands plus event subscriptions and its close request. CSP disallows remote scripts, frames, uploads, and external image sources. The UI retains error/success states, keyboard tool access, focus-trapped dialogs, close/navigation handling for unsaved edits, and light/dark/system appearance.

## References

- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit)
- [Apple screenshot manager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)
- [Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri global shortcuts](https://v2.tauri.app/plugin/global-shortcut/)
- [Tauri autostart](https://v2.tauri.app/plugin/autostart/)
