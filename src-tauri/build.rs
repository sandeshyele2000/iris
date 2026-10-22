fn main() {
    use std::{env, path::PathBuf, process::Command};
    let native = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../native/macos");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        _ => panic!("Unsupported macOS architecture"),
    };
    let mut compiler = Command::new("xcrun");
    compiler
        .args([
            "swiftc",
            "-swift-version",
            "6",
            "-parse-as-library",
            "-O",
            "-emit-library",
            "-static",
            "-module-name",
            "IrisNative",
            "-target",
            &format!("{arch}-apple-macos14.0"),
            "-module-cache-path",
        ])
        .arg(out.join("swift-cache"));
    for file in [
        "CaptureEngine.swift",
        "ScreenRecording.swift",
        "RegionSelection.swift",
        "ImageServices.swift",
        "NativeBridge.swift",
    ] {
        let path = native.join(file);
        println!("cargo:rerun-if-changed={}", path.display());
        compiler.arg(path);
    }
    let status = compiler
        .arg("-o")
        .arg(out.join("libIrisNative.a"))
        .status()
        .expect("Swift compiler unavailable");
    assert!(status.success(), "Swift native library failed to compile");
    // Build the standalone fixture executable through Cargo as well; it is not bundled.
    let diagnostics_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("binaries");
    std::fs::create_dir_all(&diagnostics_dir).expect("Cannot create native diagnostics directory");
    let mut diagnostics = Command::new("xcrun");
    diagnostics
        .args([
            "swiftc",
            "-swift-version",
            "6",
            "-parse-as-library",
            "-O",
            "-target",
            &format!("{arch}-apple-macos14.0"),
            "-module-cache-path",
        ])
        .arg(out.join("swift-cache"));
    for file in [
        "CaptureEngine.swift",
        "ScreenRecording.swift",
        "RegionSelection.swift",
        "ImageServices.swift",
        "NativeCLI.swift",
    ] {
        let path = native.join(file);
        println!("cargo:rerun-if-changed={}", path.display());
        diagnostics.arg(path);
    }
    let diagnostics_path =
        diagnostics_dir.join(format!("iris-capture-{}", env::var("TARGET").unwrap()));
    assert!(
        diagnostics
            .arg("-o")
            .arg(diagnostics_path)
            .status()
            .expect("Swift compiler unavailable")
            .success(),
        "Native diagnostics failed to compile"
    );
    swift_rs::SwiftLinker::new("14.0").link();
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=IrisNative");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "diagnose",
            "request_permission",
            "list_sources",
            "library",
            "library_image",
            "capture",
            "start_recording",
            "stop_recording",
            "recording_status",
            "import_image",
            "save_edit",
            "export_image",
            "library_action",
            "copy_text",
            "open_permissions",
            "choose_directory",
            "update_settings",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
