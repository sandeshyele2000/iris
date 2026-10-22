# Iris

A local macOS screenshot workspace built with Tauri 2, React 19, TypeScript, Tailwind 4, Rust, and Swift. **Minimum macOS version: 14.0 (Sonoma)**, using ScreenCaptureKit’s supported single-frame capture API. Apple Silicon builds are verified here; Intel source and build support require an Intel Mac for validation.

## Run

Install macOS 14+, Xcode command-line tools, Node 24.15+ (24.x LTS) or a newer supported LTS, pnpm 11.25.0, and Rust 1.99+. Dependency versions are pinned in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`.

```sh
pnpm install --frozen-lockfile
pnpm app:dev
```

The repository includes `.nvmrc` for Node 24. Use a working standard Node/pnpm/Rust installation. `pnpm dev` alone previews the frontend in a browser; `pnpm app:dev` launches the native application. Cargo's `build.rs` automatically compiles and links Swift. No custom shell launcher is required.

## Use

- **Full screen:** capture the selected display. Refresh sources to select another monitor or “All displays” (separate images).
- **While minimized:** press **⇧⌘2** (default) or use the menu-bar **Capture Area** command. Drag on the monitor under the pointer. Escape cancels without reopening the minimized window; capture opens the editor.
- **Region:** choose one display, then drag on its transparent native overlay. Escape cancels. Coordinates are display-local points, converted to Retina pixels by ScreenCaptureKit.
- **Window:** select an available external application window. macOS may omit protected, off-screen, minimized, or unavailable windows.
- **Screen recording:** use the record icon to record one display, then stop to save an MP4 in your configured output folder and reveal it in Finder. Video is H.264 at up to 4K / 30 fps, with the cursor and no audio. Iris windows are excluded. Recording continues while minimized; use **Stop Recording** in the menu bar. Closing the window during recording hides it; quitting finalizes the video. Videos are saved directly to disk rather than the screenshot library.
- **Open image:** import PNG, JPEG, TIFF, or HEIC through a native file picker. Editing, history, OCR, clipboard, and export also work with imports when screen capture is unavailable.
- **Editor:** crop, arrows, rectangles, ellipses, text, pixelation, undo/redo (⌘Z / ⇧⌘Z), and restore original. Select a tool and drag; text is placed by clicking. Set its text and properties before placing it.
- **Save / Save as:** flatten the current edits and write PNG or JPEG. Save as uses a native save panel and confirms replacement. ⌘S saves; ⇧⌘S opens Save as. Successful saving is reported only after writing finishes.
- **Copy:** flatten current edits and place PNG + TIFF representations on the native pasteboard. ⌘C copies the image when focus is outside a text input.
- **History:** search, sort, open, rename (click the image name), delete, copy, extract text, pin, and reveal in Finder. Missing files can be removed from history.
- **Settings:** output directory, filename tokens, PNG/JPEG default, appearance, configurable global shortcuts, and opt-in launch at login. Shortcuts work while Iris is running.
- **Diagnostics:** Screen Recording permission status, permission request, and System Settings link.

New captures and imports immediately enter the private library. Editing is non-destructive: switching away with unsaved changes asks before discarding those changes. Copy, OCR, pin, and export first persist the current edits. Closing/discarding the editor keeps the original in history; Delete removes the private original and edits, while preserving exported files. Pixelation is visual obscuring: unredacted originals remain in the private library until deleted. For irreversible redaction, inspect the flattened export and remove the library original as required by your organization.

Default exports: `~/Pictures/IrisCaptures`. Private originals, edited revisions, thumbnails, and atomic JSON metadata: `~/Library/Application Support/com.iris.screenshot/library/`. Library directory permissions are `0700`, files `0600`. There is no upload service, telemetry, or remote OCR.

## Screen Recording permission

Screen Recording permission and capture now run inside Iris itself. The old separate-helper/preflight loop has been removed. Permission preflight is advisory; Iris lets ScreenCaptureKit decide access and does not automatically request permission again after an API denial. The app uses bundle ID `com.iris.screenshot` and its own application-data directory. Previous builds used a different identity; grant Screen Recording permission to this Iris build. Existing images in a previous application-data directory can be imported through Open image. Screen Recording permission is app-specific. Enable the responsible application identified by macOS in **System Settings → Privacy & Security → Screen Recording / Screen & System Audio Recording**, then reopen it when prompted. Development launchers can receive permission attribution; test the final bundle separately.

Iris checks Screen Recording permission and uses ScreenCaptureKit directly. Native API failures are reported as returned by macOS. Import and editing remain usable independently.

## Tests and build

```sh
pnpm build
pnpm test
pnpm native:build
pnpm test:native
pnpm test:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm app:build
```

`pnpm check` combines the frontend build, frontend tests, native tests, and Rust tests. Native tests require macOS/Xcode. The standard native suite processes a generated image; it never requests permission, changes the clipboard, or captures a granted screen. Actual display capture requires an explicit opt-in:

```sh
# Run only where screen capture is organizationally authorized and permission is granted.
IRIS_TEST_CAPTURE=1 pnpm test:native
```

Apple Vision requires local macOS services unavailable in some execution sandboxes. Its fixture test passed outside the Codex execution sandbox on this Mac. See [testing](docs/testing.md) for the complete automated/manual matrix and verified results.

The local build is at:

```sh
open "src-tauri/target/release/bundle/macos/Iris.app"
```

Local builds use ad hoc signing. They are **not Developer ID distribution builds and are not notarized**. See [deployment](docs/deployment.md) for signing, notarization, Intel builds, and MDM deployment.

## Repository

```text
src/
  App.tsx                         capture/library coordination and navigation
  components/                     icons and settings panel
  features/capture/api.ts         IPC types and desktop invocation
  features/editor/                immutable editing model and pointer editor
  styles.css                      responsive light/dark interface
src-tauri/
  src/main.rs                     commands, native process boundary, app integration
  src/store.rs                    persistence, history, filenames, file safety
  capabilities/                   local main/pin window permissions
  icons/                          macOS icon and PNG sizes
native/macos/
  CaptureEngine.swift             in-process permissions, diagnostics, ScreenCaptureKit
  NativeBridge.swift              MainActor C ABI bridge into the Iris executable
  NativeCLI.swift                 standalone diagnostics for tests only
  RegionSelection.swift           native region overlay and point coordinates
  ImageServices.swift             image encoding, clipboard, OCR, native dialogs
tests/                            frontend, rendering, native fixtures and CLI runner
docs/                             architecture, test matrix, troubleshooting, deployment
```

Scrolling capture is intentionally omitted: reliable cross-application scrolling needs application-specific testing and is not part of the standard capture path. Region selection is confined to one selected display; use separate captures across monitors. Successful authorized capture, mixed-display geometry, native clipboard pasting, pin behavior, login launch, and signed-bundle permission attribution still require the manual acceptance steps in [testing](docs/testing.md). This repository does not claim production acceptance before those checks and your organization’s review are complete.
