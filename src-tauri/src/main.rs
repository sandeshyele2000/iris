#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod native;
mod store;

use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use store::{
    Record, Result, Settings, Store, atomic_write, data_url, failure, image_bytes, io, write_new,
};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct State {
    store: Mutex<Store>,
    operation: tokio::sync::Mutex<()>,
    recording: AtomicBool,
    shortcuts_paused: AtomicBool,
}
fn locked(state: &State) -> Result<std::sync::MutexGuard<'_, Store>> {
    state
        .store
        .lock()
        .map_err(|_| failure("STORE_LOCK", "Library lock failed; restart Iris"))
}
async fn native(args: &[String], input: Option<String>) -> Result<Value> {
    native::call(args, input).await
}
async fn helper(args: &[String]) -> Result<Value> {
    native(args, None).await
}
fn path_arg(path: &std::path::Path) -> Result<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| failure("INVALID_PATH", "Path is not UTF-8"))
}

#[tauri::command]
async fn diagnose(verify_access: Option<bool>) -> Result<Value> {
    let args = if verify_access.unwrap_or(false) {
        vec!["diagnose".into(), "verify-access".into()]
    } else {
        vec!["diagnose".into()]
    };
    helper(&args).await
}
#[tauri::command]
async fn request_permission() -> Result<Value> {
    helper(&["request-permission".into()]).await
}
#[tauri::command]
async fn recording_status() -> Result<Value> {
    helper(&["record-status".into()]).await
}
#[tauri::command]
async fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    source_id: u32,
) -> Result<Value> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another operation is running"))?;
    if state.recording.load(Ordering::SeqCst) {
        return Err(failure("BUSY", "A recording is already running"));
    }
    let directory = locked(&state)?.db.settings.directory.clone();
    std::fs::create_dir_all(&directory).map_err(io)?;
    let path = directory.join(format!(
        "Recording-{}-{}.mp4",
        chrono::Local::now().format("%Y-%m-%d-%H-%M-%S"),
        uuid::Uuid::new_v4()
    ));
    let output = path_arg(&path)?;
    // Keep the main window alive while the native stream starts and runs.
    state.recording.store(true, Ordering::SeqCst);
    let result = helper(&["record-start".into(), source_id.to_string(), output]).await;
    if result.is_err() {
        let _ = std::fs::remove_file(&path);
        state.recording.store(false, Ordering::SeqCst);
    }
    if let Ok(status) = &result {
        let _ = app.emit_to("main", "recording-changed", status);
    }
    result
}
async fn finish_recording(app: &tauri::AppHandle) -> Result<Value> {
    let state = app.state::<State>();
    let _operation = state.operation.lock().await;
    let result = helper(&["record-stop".into()]).await;
    state.recording.store(false, Ordering::SeqCst);
    let status = result
        .as_ref()
        .cloned()
        .unwrap_or_else(|_| json!({"active": false}));
    let _ = app.emit_to("main", "recording-changed", status);
    result
}
#[tauri::command]
async fn stop_recording(app: tauri::AppHandle) -> Result<Value> {
    let result = finish_recording(&app).await?;
    if let Some(path) = result["path"].as_str() {
        helper(&["reveal".into(), path.into()]).await?;
    }
    Ok(result)
}
fn quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if app.state::<State>().recording.load(Ordering::SeqCst)
            && let Err(error) = finish_recording(&app).await
        {
            show_main(&app);
            let _ = app.emit_to("main", "capture-error", error);
            return;
        }
        app.exit(0);
    });
}
#[tauri::command]
async fn list_sources() -> Result<Value> {
    helper(&["sources".into()]).await
}
#[tauri::command]
fn library(state: tauri::State<'_, State>) -> Result<Value> {
    Ok(locked(&state)?.snapshot())
}
#[tauri::command]
fn library_image(state: tauri::State<'_, State>, id: String, original: bool) -> Result<String> {
    data_url(&locked(&state)?.path(&id, original)?)
}

async fn thumbnail(root: &std::path::Path, id: &str, source: &std::path::Path) -> Result<()> {
    let temp = root.join(format!("{}-thumb-staging.png", uuid::Uuid::new_v4()));
    let result = helper(&["thumbnail".into(), path_arg(source)?, path_arg(&temp)?]).await;
    if let Err(error) = result {
        let _ = std::fs::remove_file(temp);
        return Err(error);
    }
    let bytes = std::fs::read(&temp).map_err(io)?;
    let _ = std::fs::remove_file(temp);
    atomic_write(&root.join(format!("{id}-thumb.png")), &bytes)
}

#[tauri::command]
async fn capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    mode: String,
    source_id: u32,
) -> Result<Value> {
    capture_image(&app, &state, mode, source_id).await
}
async fn capture_image(
    app: &tauri::AppHandle,
    state: &State,
    mode: String,
    source_id: u32,
) -> Result<Value> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    let command = match mode.as_str() {
        "display" => "capture",
        "region" => "capture-region",
        "window" => "capture-window",
        _ => return Err(failure("INVALID_MODE", "Unknown capture mode")),
    };
    if source_id == 0 && mode == "window" {
        return Err(failure("INVALID_SOURCE", "Choose an available source"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let root = locked(state)?.root.clone();
    let path = root.join(format!("{id}.png"));
    let windows: Vec<_> = app
        .webview_windows()
        .into_values()
        .map(|window| {
            let visible =
                window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            if visible {
                let _ = window.hide();
            }
            (window, visible)
        })
        .collect();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let result = helper(&[command.into(), source_id.to_string(), path_arg(&path)?]).await;
    for (window, visible) in windows {
        if visible {
            let _ = window.show();
        }
    }
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            if error["code"] != "CANCELLED" {
                show_main(app);
            }
            return Err(error);
        }
    };
    let imported: Result<Value> = async {
        data_url(&path)?;
        thumbnail(&root, &id, &path).await?;
        let width = result["width"]
            .as_u64()
            .ok_or_else(|| failure("HELPER_PROTOCOL", "Missing image dimensions"))?
            as u32;
        let height = result["height"]
            .as_u64()
            .ok_or_else(|| failure("HELPER_PROTOCOL", "Missing image dimensions"))?
            as u32;
        let row = Record {
            id: id.clone(),
            name: format!("Capture {}", chrono::Local::now().format("%H-%M-%S")),
            created_at: chrono::Local::now().to_rfc3339(),
            mode,
            source_id: result["displayId"].as_u64().unwrap_or(source_id as u64) as u32,
            width,
            height,
            original_width: width,
            original_height: height,
            edited: false,
            revision: None,
            edits: json!([]),
            export_path: None,
        };
        let mut store = locked(state)?;
        let mut next = store.db.clone();
        next.captures.insert(0, row.clone());
        store.commit(next)?;
        Ok(json!(row))
    }
    .await;
    if imported.is_err() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(root.join(format!("{id}-thumb.png")));
    }
    if imported.is_ok() {
        show_main(app);
    }
    imported
}

#[tauri::command]
async fn import_image(state: tauri::State<'_, State>) -> Result<Option<Record>> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    let result = helper(&["open-image".into()]).await?;
    let Some(source) = result["path"].as_str() else {
        return Ok(None);
    };
    let root = locked(&state)?.root.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let path = root.join(format!("{id}.png"));
    let imported: Result<Record> = async {
        helper(&[
            "convert".into(),
            source.into(),
            path_arg(&path)?,
            "png".into(),
        ])
        .await?;
        data_url(&path)?;
        let info = helper(&["image-info".into(), path_arg(&path)?]).await?;
        thumbnail(&root, &id, &path).await?;
        let width = info["width"]
            .as_u64()
            .ok_or_else(|| failure("INVALID_IMAGE", "Missing width"))? as u32;
        let height = info["height"]
            .as_u64()
            .ok_or_else(|| failure("INVALID_IMAGE", "Missing height"))? as u32;
        let row = Record {
            id: id.clone(),
            name: format!("Imported {}", chrono::Local::now().format("%H-%M-%S")),
            created_at: chrono::Local::now().to_rfc3339(),
            mode: "import".into(),
            source_id: 0,
            width,
            height,
            original_width: width,
            original_height: height,
            edited: false,
            revision: None,
            edits: json!([]),
            export_path: None,
        };
        let mut store = locked(&state)?;
        let mut next = store.db.clone();
        next.captures.insert(0, row.clone());
        store.commit(next)?;
        Ok(row)
    }
    .await;
    if imported.is_err() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(root.join(format!("{id}-thumb.png")));
    }
    imported.map(Some)
}

#[tauri::command]
async fn save_edit(
    state: tauri::State<'_, State>,
    id: String,
    image: String,
    edits: Value,
) -> Result<()> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    if !edits.is_array() || edits.to_string().len() > 1024 * 1024 {
        return Err(failure(
            "INVALID_EDITS",
            "Invalid or oversized edit document",
        ));
    }
    let bytes = image_bytes(&image)?;
    let root = {
        let store = locked(&state)?;
        store.record(&id)?;
        store.root.clone()
    };
    let revision = uuid::Uuid::new_v4().to_string();
    let key = format!("{id}-{revision}");
    let path = root.join(format!("{key}.png"));
    write_new(&path, &bytes)?;
    let updated: Result<()> = async {
        let info = helper(&["image-info".into(), path_arg(&path)?]).await?;
        thumbnail(&root, &key, &path).await?;
        let mut store = locked(&state)?;
        let mut next = store.db.clone();
        let row = next
            .captures
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| failure("NOT_FOUND", "Capture no longer exists"))?;
        row.width = info["width"]
            .as_u64()
            .ok_or_else(|| failure("INVALID_IMAGE", "Missing width"))? as u32;
        row.height = info["height"]
            .as_u64()
            .ok_or_else(|| failure("INVALID_IMAGE", "Missing height"))? as u32;
        row.edited = true;
        row.revision = Some(revision);
        row.edits = edits;
        row.export_path = None;
        let previous = store.record(&id)?.revision.clone();
        store.commit(next)?;
        if let Some(previous) = previous {
            let _ = std::fs::remove_file(root.join(format!("{id}-{previous}.png")));
            let _ = std::fs::remove_file(root.join(format!("{id}-{previous}-thumb.png")));
        }
        Ok(())
    }
    .await;
    if updated.is_err() {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(root.join(format!("{key}-thumb.png")));
    }
    updated
}

#[tauri::command]
async fn export_image(
    state: tauri::State<'_, State>,
    id: String,
    format: String,
    save_as: bool,
) -> Result<Option<String>> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    if !["png", "jpeg"].contains(&format.as_str()) {
        return Err(failure("INVALID_FORMAT", "Choose PNG or JPEG"));
    }
    let (source, root, directory, filename) = {
        let store = locked(&state)?;
        (
            store.path(&id, false)?,
            store.root.clone(),
            store.db.settings.directory.clone(),
            store.export_name(&store.record(&id)?.mode, &format)?,
        )
    };
    std::fs::create_dir_all(&directory).map_err(io)?;
    let destination = if save_as {
        let result = helper(&[
            "save-dialog".into(),
            path_arg(&directory)?,
            filename,
            format.clone(),
        ])
        .await?;
        match result["path"].as_str() {
            Some(path) => PathBuf::from(path),
            None => return Ok(None),
        }
    } else {
        directory.join(filename)
    };
    // This path originates exclusively from settings/native save panel, never from the renderer.
    if !destination.is_absolute()
        || std::fs::symlink_metadata(&destination).is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err(failure("UNSAFE_PATH", "Invalid export destination"));
    }
    let temp = root.join(format!(
        "{}-export.{}",
        uuid::Uuid::new_v4(),
        if format == "jpeg" { "jpg" } else { "png" }
    ));
    let result = helper(&[
        "convert".into(),
        path_arg(&source)?,
        path_arg(&temp)?,
        format,
    ])
    .await;
    if let Err(error) = result {
        let _ = std::fs::remove_file(temp);
        return Err(error);
    }
    let bytes = std::fs::read(&temp).map_err(io)?;
    let _ = std::fs::remove_file(temp);
    if save_as {
        atomic_write(&destination, &bytes)?;
    } else {
        write_new(&destination, &bytes)?;
    }
    let mut store = locked(&state)?;
    let mut next = store.db.clone();
    next.captures
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| failure("NOT_FOUND", "Capture no longer exists"))?
        .export_path = Some(destination.clone());
    store.commit(next)?;
    Ok(Some(path_arg(&destination)?))
}

#[tauri::command]
async fn library_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    id: String,
    action: String,
    name: Option<String>,
) -> Result<Value> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    if action == "rename" {
        locked(&state)?.rename(
            &id,
            name.ok_or_else(|| failure("INVALID_NAME", "Enter a name"))?,
        )?;
        return Ok(Value::Null);
    }
    if action == "delete" {
        locked(&state)?.delete(&id)?;
        return Ok(Value::Null);
    }
    let path = {
        let store = locked(&state)?;
        if action == "reveal" {
            store
                .record(&id)?
                .export_path
                .clone()
                .filter(|p| p.exists())
                .unwrap_or(store.path(&id, false)?)
        } else {
            store.path(&id, false)?
        }
    };
    match action.as_str() {
        "copy" => helper(&["copy-image".into(), path_arg(&path)?]).await,
        "ocr" => helper(&["ocr".into(), path_arg(&path)?]).await,
        "reveal" => helper(&["reveal".into(), path_arg(&path)?]).await,
        "pin" => {
            let label = format!("pin-{id}");
            if let Some(window) = app.get_webview_window(&label) {
                window.show().map_err(io)?;
                app.emit_to(&label, "image-updated", ()).map_err(io)?;
                window.set_focus().map_err(io)?;
            } else {
                let row = locked(&state)?.record(&id)?.clone();
                tauri::WebviewWindowBuilder::new(
                    &app,
                    &label,
                    tauri::WebviewUrl::App(format!("index.html?pin={id}").into()),
                )
                .title(&row.name)
                .inner_size(
                    (row.width as f64 / 2.0).clamp(240.0, 900.0),
                    (row.height as f64 / 2.0).clamp(160.0, 700.0),
                )
                .always_on_top(true)
                .build()
                .map_err(io)?;
            }
            Ok(Value::Null)
        }
        _ => Err(failure("INVALID_ACTION", "Unknown library action")),
    }
}
#[tauri::command]
async fn copy_text(text: String) -> Result<Value> {
    if text.len() > 4_000_000 {
        return Err(failure("TEXT_TOO_LARGE", "Text exceeds 4 MB"));
    }
    native(&["copy-text".into()], Some(text)).await
}
#[tauri::command]
async fn open_permissions() -> Result<Value> {
    helper(&["open-permissions".into()]).await
}
#[tauri::command]
async fn choose_directory(state: tauri::State<'_, State>) -> Result<Option<String>> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    let result = helper(&["choose-directory".into()]).await?;
    let Some(path) = result["path"].as_str() else {
        return Ok(None);
    };
    let directory = PathBuf::from(path).canonicalize().map_err(io)?;
    if !directory.is_dir() {
        return Err(failure("INVALID_DIRECTORY", "Choose a directory"));
    }
    let mut store = locked(&state)?;
    let mut next = store.db.clone();
    next.settings.directory = directory.clone();
    store.commit(next)?;
    Ok(Some(path_arg(&directory)?))
}
fn show_main(app: &tauri::AppHandle) {
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn background_capture(app: &tauri::AppHandle, mode: &str) {
    let app = app.clone();
    let mode = mode.to_owned();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<State>();
        match capture_image(&app, &state, mode, 0).await {
            Ok(row) => {
                let _ = app.emit_to(
                    "main",
                    "capture-completed",
                    row["id"].as_str().unwrap_or_default(),
                );
            }
            Err(error) if error["code"] == "CANCELLED" || error["code"] == "BUSY" => {}
            Err(error) => {
                show_main(&app);
                let _ = app.emit_to("main", "capture-error", error);
            }
        }
    });
}
fn tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let area = MenuItem::with_id(app, "capture-region", "Capture Area", true, None::<&str>)?;
    let screen = MenuItem::with_id(app, "capture-display", "Capture Screen", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop-recording", "Stop Recording", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Iris", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Iris", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&area, &screen, &stop, &open, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("iris")
        .tooltip("Iris · Capture Area ⇧⌘2")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture-region" => background_capture(app, "region"),
            "capture-display" => background_capture(app, "display"),
            "open" => show_main(app),
            "stop-recording" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = stop_recording(app.clone()).await {
                        let _ = app.emit_to("main", "capture-error", error);
                    }
                    show_main(&app);
                });
            }
            "quit" => quit(app),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
fn shortcuts(app: &tauri::AppHandle, values: &[String; 3]) -> Result<()> {
    let mut parsed = vec![];
    for (index, value) in values.iter().enumerate() {
        if value.is_empty() {
            continue;
        }
        let shortcut: Shortcut = value.parse().map_err(|e| failure("INVALID_SHORTCUT", e))?;
        if parsed.iter().any(|(_, s)| s == &shortcut) {
            return Err(failure("SHORTCUT_CONFLICT", "Choose distinct shortcuts"));
        }
        parsed.push((index, shortcut));
    }
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| failure("SHORTCUT_FAILED", e))?;
    for (index, shortcut) in parsed {
        app.global_shortcut()
            .on_shortcut(shortcut, move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    if index < 2 {
                        background_capture(app, ["display", "region"][index]);
                    } else {
                        show_main(app);
                        let _ = app.emit_to("main", "capture-shortcut", "window");
                    }
                }
            })
            .map_err(|e| failure("SHORTCUT_CONFLICT", e))?;
    }
    Ok(())
}
fn restore_shortcuts(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<State>();
    if state.shortcuts_paused.swap(false, Ordering::SeqCst) {
        let values = locked(&state)?.db.settings.shortcuts.clone();
        if let Err(error) = shortcuts(app, &values) {
            state.shortcuts_paused.store(true, Ordering::SeqCst);
            return Err(error);
        }
    }
    Ok(())
}
#[tauri::command]
fn set_shortcut_capture(app: tauri::AppHandle, active: bool) -> Result<()> {
    let state = app.state::<State>();
    if active {
        app.global_shortcut()
            .unregister_all()
            .map_err(|error| failure("SHORTCUT_FAILED", error))?;
        state.shortcuts_paused.store(true, Ordering::SeqCst);
        Ok(())
    } else {
        restore_shortcuts(&app)
    }
}
#[tauri::command]
async fn update_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    mut settings: Settings,
) -> Result<()> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| failure("BUSY", "Another image operation is running"))?;
    settings.validate()?;
    let old = locked(&state)?.db.settings.clone();
    settings.directory = old.directory.clone();
    if let Err(error) = shortcuts(&app, &settings.shortcuts) {
        let _ = shortcuts(&app, &old.shortcuts);
        return Err(error);
    }
    let login = app.autolaunch();
    let result = if settings.launch_at_login == old.launch_at_login {
        Ok(())
    } else if settings.launch_at_login {
        login.enable()
    } else {
        login.disable()
    };
    if let Err(error) = result {
        let _ = shortcuts(&app, &old.shortcuts);
        return Err(failure("LOGIN_FAILED", error));
    }
    let result = {
        let mut store = locked(&state)?;
        let mut next = store.db.clone();
        next.settings = settings;
        store.commit(next)
    };
    if result.is_err() {
        let _ = shortcuts(&app, &old.shortcuts);
        let _ = if old.launch_at_login {
            login.enable()
        } else {
            login.disable()
        };
    }
    result
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .setup(|app| {
            let data = app.path().app_local_data_dir()?;
            let legacy = data.with_file_name("com.iris.screenshot").join("library");
            let mut store =
                Store::open_with_legacy(data.join("library"), app.path().picture_dir()?, legacy)
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
            if let Err(error) = shortcuts(app.handle(), &store.db.settings.shortcuts) {
                store.startup_errors.push(error.to_string());
            }
            match app.autolaunch().is_enabled() {
                Ok(enabled) => store.db.settings.launch_at_login = enabled,
                Err(error) => store.startup_errors.push(error.to_string()),
            }
            app.manage(State {
                store: Mutex::new(store),
                operation: tokio::sync::Mutex::new(()),
                recording: AtomicBool::new(false),
                shortcuts_paused: AtomicBool::new(false),
            });
            tray(app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match helper(&["startup-permission".into()]).await {
                    Ok(status) => {
                        let _ = handle.emit_to("main", "permission-changed", status);
                    }
                    Err(error) => {
                        let _ = handle.emit_to("main", "capture-error", error);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            diagnose,
            request_permission,
            list_sources,
            library,
            library_image,
            capture,
            start_recording,
            stop_recording,
            recording_status,
            import_image,
            save_edit,
            export_image,
            library_action,
            copy_text,
            open_permissions,
            choose_directory,
            update_settings,
            set_shortcut_capture
        ])
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Destroyed
                )
                && let Err(error) = restore_shortcuts(window.app_handle())
            {
                let _ = window.emit("capture-error", error);
            }
            if window.label() == "main"
                && window.state::<State>().recording.load(Ordering::SeqCst)
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to start Iris")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } = event
                && app.state::<State>().recording.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                quit(app);
            }
        });
}
