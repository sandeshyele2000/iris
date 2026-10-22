use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, Value>;
pub fn failure(code: &str, message: impl ToString) -> Value {
    json!({"code": code, "message": message.to_string()})
}
pub fn io(error: impl ToString) -> Value {
    failure("FILESYSTEM", error)
}
pub const MAX_IMAGE: usize = 80 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub directory: PathBuf,
    pub filename: String,
    pub format: String,
    pub appearance: String,
    pub shortcuts: [String; 3],
    pub launch_at_login: bool,
}
impl Settings {
    pub fn defaults(pictures: PathBuf) -> Self {
        Self {
            directory: pictures.join("IrisCaptures"),
            filename: "Capture-{date}-{time}-{mode}".into(),
            format: "png".into(),
            appearance: "system".into(),
            shortcuts: [
                "CommandOrControl+Shift+1".into(),
                "CommandOrControl+Shift+2".into(),
                "CommandOrControl+Shift+3".into(),
            ],
            launch_at_login: false,
        }
    }
    pub fn validate(&self) -> Result<()> {
        validate_name(&self.filename)?;
        if !["png", "jpeg"].contains(&self.format.as_str())
            || !["system", "light", "dark"].contains(&self.appearance.as_str())
        {
            return Err(failure("INVALID_SETTINGS", "Invalid format or appearance"));
        }
        for shortcut in &self.shortcuts {
            if shortcut.len() > 100 {
                return Err(failure("INVALID_SHORTCUT", "Shortcut is too long"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub mode: String,
    pub source_id: u32,
    pub width: u32,
    pub height: u32,
    pub original_width: u32,
    pub original_height: u32,
    pub edited: bool,
    #[serde(default)]
    pub revision: Option<String>,
    pub edits: Value,
    pub export_path: Option<PathBuf>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Database {
    pub version: u32,
    pub settings: Settings,
    pub captures: Vec<Record>,
}
pub struct Store {
    pub root: PathBuf,
    pub db: Database,
    pub startup_errors: Vec<String>,
    _lock: fs::File,
}

pub fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty()
        || name.len() > 120
        || name.starts_with('.')
        || name.chars().any(|c| c.is_control() || "/\\:".contains(c))
    {
        return Err(failure(
            "INVALID_NAME",
            "Use 1–120 characters without path separators, colons, control characters, or a leading dot.",
        ));
    }
    Ok(())
}
pub fn image_bytes(data: &str) -> Result<Vec<u8>> {
    let encoded = data
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| failure("INVALID_IMAGE", "Expected a PNG data URL"))?;
    if encoded.len() > MAX_IMAGE * 4 / 3 + 4 {
        return Err(failure("IMAGE_TOO_LARGE", "Image exceeds 80 MiB"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| failure("INVALID_IMAGE", "Invalid base64"))?;
    if bytes.len() > MAX_IMAGE || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(failure("INVALID_IMAGE", "Invalid PNG"));
    }
    Ok(bytes)
}
pub fn data_url(path: &Path) -> Result<String> {
    let meta = fs::symlink_metadata(path).map_err(io)?;
    if !meta.is_file() || meta.len() > MAX_IMAGE as u64 {
        return Err(failure(
            "INVALID_IMAGE",
            "Image is missing, unsafe, or too large",
        ));
    }
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(fs::read(path).map_err(io)?)
    ))
}
pub fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(io)?;
    }
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(path);
        return Err(io(error));
    }
    Ok(())
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(failure("UNSAFE_PATH", "Refusing a symbolic link"));
    }
    let temp = path.with_file_name(format!(".iris-{}.tmp", uuid::Uuid::new_v4()));
    write_new(&temp, bytes)?;
    let result = fs::rename(&temp, path).map_err(io);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    // Persist directory entries as well as file contents.
    fs::File::open(
        path.parent()
            .ok_or_else(|| failure("UNSAFE_PATH", "Missing parent"))?,
    )
    .and_then(|dir| dir.sync_all())
    .map_err(io)
}
impl Store {
    pub fn open_with_legacy(root: PathBuf, pictures: PathBuf, legacy: PathBuf) -> Result<Self> {
        if !root.exists() && legacy.join("library.json").exists() {
            if fs::symlink_metadata(&legacy)
                .map_err(io)?
                .file_type()
                .is_symlink()
                || fs::symlink_metadata(legacy.join(".lock"))
                    .is_ok_and(|meta| meta.file_type().is_symlink())
            {
                return Err(failure(
                    "UNSAFE_PATH",
                    "Legacy library must not use symbolic links",
                ));
            }
            let lock = OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(legacy.join(".lock"))
                .map_err(io)?;
            lock.try_lock().map_err(|_| {
                failure(
                    "LIBRARY_IN_USE",
                    "Quit the earlier Iris app before moving its library to the new app identity.",
                )
            })?;
            // Rename the entire library atomically while holding its existing process lock.
            // A library already created under the new identity always takes precedence.
            if !root.exists() {
                fs::create_dir_all(
                    root.parent()
                        .ok_or_else(|| failure("INVALID_PATH", "Missing library parent"))?,
                )
                .map_err(io)?;
                fs::rename(&legacy, &root).map_err(io)?;
            }
        }
        Self::open(root, pictures)
    }
    pub fn open(root: PathBuf, pictures: PathBuf) -> Result<Self> {
        if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(failure(
                "UNSAFE_PATH",
                "Library directory must not be a symbolic link",
            ));
        }
        fs::create_dir_all(&root).map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(io)?;
        }
        let root = root.canonicalize().map_err(io)?;
        let lock_path = root.join(".lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(failure(
                "UNSAFE_PATH",
                "Library lock must not be a symbolic link",
            ));
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            lock.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(io)?;
        }
        lock.try_lock().map_err(|_| failure("LIBRARY_IN_USE", "Another Iris process is using this library. Quit it before launching a second instance."))?;
        let path = root.join("library.json");
        let db: Database = if path.exists() {
            let meta = fs::symlink_metadata(&path).map_err(io)?;
            if !meta.is_file() || meta.len() > 32 * 1024 * 1024 {
                return Err(failure(
                    "LIBRARY_INVALID",
                    "Library database is unsafe or exceeds 32 MiB",
                ));
            }
            serde_json::from_slice(&fs::read(path).map_err(io)?).map_err(|e| failure("LIBRARY_INVALID", format!("Library metadata cannot be read; preserve library.json and restore a backup: {e}")))?
        } else {
            Database {
                version: 1,
                settings: Settings::defaults(pictures),
                captures: vec![],
            }
        };
        if db.version != 1 {
            return Err(failure("LIBRARY_VERSION", "Unsupported library version"));
        }
        db.settings.validate()?;
        for record in &db.captures {
            uuid::Uuid::parse_str(&record.id)
                .map_err(|_| failure("LIBRARY_INVALID", "Invalid capture ID"))?;
            validate_name(&record.name)?;
            if let Some(revision) = &record.revision {
                uuid::Uuid::parse_str(revision)
                    .map_err(|_| failure("LIBRARY_INVALID", "Invalid image revision"))?;
            }
        }
        let mut store = Self {
            root,
            db,
            startup_errors: vec![],
            _lock: lock,
        };
        store.recover_orphans()?;
        Ok(store)
    }
    fn recover_orphans(&mut self) -> Result<()> {
        let mut live = std::collections::HashSet::new();
        for row in &self.db.captures {
            live.insert(format!("{}.png", row.id));
            live.insert(format!("{}-thumb.png", row.id));
            if row.edited {
                let key = row
                    .revision
                    .as_ref()
                    .map(|r| format!("{}-{r}", row.id))
                    .unwrap_or_else(|| format!("{}-edited", row.id));
                live.insert(format!("{key}.png"));
                if row.revision.is_some() {
                    live.insert(format!("{key}-thumb.png"));
                }
            }
        }
        for entry in fs::read_dir(&self.root).map_err(io)? {
            let entry = entry.map_err(io)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let generated = if let Some(id) = name
                .strip_prefix(".iris-")
                .and_then(|n| n.strip_suffix(".tmp"))
            {
                uuid::Uuid::parse_str(id).is_ok()
            } else if let Some(id) = name.strip_prefix(".trash-") {
                uuid::Uuid::parse_str(id).is_ok()
            } else if name.len() >= 36
                && name.is_char_boundary(36)
                && uuid::Uuid::parse_str(&name[..36]).is_ok()
            {
                let suffix = &name[36..];
                [
                    ".png",
                    "-thumb.png",
                    "-edited.png",
                    "-edit-staging.png",
                    "-thumb-staging.png",
                    "-export.png",
                    "-export.jpg",
                ]
                .contains(&suffix)
                    || suffix
                        .strip_prefix('-')
                        .and_then(|s| {
                            s.strip_suffix("-thumb.png")
                                .or_else(|| s.strip_suffix(".png"))
                        })
                        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
            } else {
                false
            };
            if generated
                && !live.contains(&name)
                && !entry.file_type().map_err(io)?.is_dir()
                && let Err(error) = fs::remove_file(entry.path())
            {
                self.startup_errors.push(format!(
                    "Could not remove interrupted-operation file {name}: {error}"
                ));
            }
        }
        Ok(())
    }
    pub fn commit(&mut self, next: Database) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&next).map_err(io)?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(failure(
                "LIBRARY_FULL",
                "Library metadata exceeds 32 MiB; remove older captures",
            ));
        }
        atomic_write(&self.root.join("library.json"), &bytes)?;
        self.db = next;
        Ok(())
    }
    pub fn record(&self, id: &str) -> Result<&Record> {
        uuid::Uuid::parse_str(id).map_err(|_| failure("INVALID_ID", "Invalid capture ID"))?;
        self.db
            .captures
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| failure("NOT_FOUND", "Capture no longer exists"))
    }
    pub fn path(&self, id: &str, original: bool) -> Result<PathBuf> {
        let record = self.record(id)?;
        let suffix = if !original && record.edited {
            record
                .revision
                .as_ref()
                .map(|r| format!("-{r}"))
                .unwrap_or_else(|| "-edited".into())
        } else {
            String::new()
        };
        let path = self.root.join(format!("{id}{suffix}.png"));
        if !fs::symlink_metadata(&path).is_ok_and(|m| m.is_file()) {
            return Err(failure(
                "FILE_MISSING",
                "Image is missing or unsafe. You can remove the stale history entry.",
            ));
        }
        Ok(path)
    }
    pub fn snapshot(&self) -> Value {
        let captures: Vec<_> = self
            .db
            .captures
            .iter()
            .map(|record| {
                let mut row = serde_json::to_value(record).unwrap_or(Value::Null);
                row["missing"] = json!(self.path(&record.id, false).is_err());
                row["thumbnail"] = json!(
                    data_url(&self.root.join(format!(
                            "{}{}-thumb.png",
                            record.id,
                            record
                                .revision
                                .as_ref()
                                .filter(|_| record.edited)
                                .map(|r| format!("-{r}"))
                                .unwrap_or_default()
                        )))
                    .ok()
                );
                row
            })
            .collect();
        json!({"settings": self.db.settings, "captures": captures, "startupErrors": self.startup_errors})
    }
    pub fn rename(&mut self, id: &str, name: String) -> Result<()> {
        validate_name(&name)?;
        self.record(id)?;
        let mut next = self.db.clone();
        next.captures.iter_mut().find(|c| c.id == id).unwrap().name = name;
        self.commit(next)
    }
    pub fn delete(&mut self, id: &str) -> Result<()> {
        let row = self.record(id)?.clone();
        let mut next = self.db.clone();
        next.captures.retain(|c| c.id != id);
        // Metadata is committed first: a crash may leave an unreferenced file, never a broken live record.
        self.commit(next)?;
        let mut suffixes = vec![".png".to_owned(), "-edited.png".into(), "-thumb.png".into()];
        if let Some(revision) = row.revision {
            suffixes.push(format!("-{revision}.png"));
            suffixes.push(format!("-{revision}-thumb.png"));
        }
        for suffix in suffixes {
            match fs::remove_file(self.root.join(format!("{id}{suffix}"))) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(io(e)),
            }
        }
        Ok(())
    }
    pub fn export_name(&self, mode: &str, format: &str) -> Result<String> {
        self.db.settings.validate()?;
        let now = Local::now();
        let name = self
            .db
            .settings
            .filename
            .replace("{date}", &now.format("%Y-%m-%d").to_string())
            .replace("{time}", &now.format("%H-%M-%S").to_string())
            .replace("{mode}", mode);
        validate_name(&name)?;
        Ok(format!(
            "{name}-{}.{}",
            &uuid::Uuid::new_v4().simple().to_string()[..8],
            if format == "jpeg" { "jpg" } else { "png" }
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store {
        Store::open(
            std::env::temp_dir().join(format!("iris-test-{}", uuid::Uuid::new_v4())),
            PathBuf::from("/tmp/Pictures"),
        )
        .unwrap()
    }
    fn record() -> Record {
        Record {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Capture".into(),
            created_at: Local::now().to_rfc3339(),
            mode: "display".into(),
            source_id: 1,
            width: 10,
            height: 20,
            original_width: 10,
            original_height: 20,
            edited: false,
            revision: None,
            edits: json!([]),
            export_path: None,
        }
    }
    #[test]
    fn identity_migration_preserves_library_and_refuses_a_running_writer() {
        let mut old = store();
        let row = record();
        let id = row.id.clone();
        let mut next = old.db.clone();
        next.captures.push(row);
        old.commit(next).unwrap();
        write_new(&old.root.join(format!("{id}.png")), b"original").unwrap();
        let legacy = old.root.clone();
        let root = legacy.with_file_name(format!("iris-migrated-{}", uuid::Uuid::new_v4()));
        let error = Store::open_with_legacy(root.clone(), PathBuf::new(), legacy.clone())
            .err()
            .unwrap();
        assert_eq!(error["code"], "LIBRARY_IN_USE");
        assert!(legacy.exists());
        assert!(!root.exists());
        drop(old);
        let migrated =
            Store::open_with_legacy(root.clone(), PathBuf::new(), legacy.clone()).unwrap();
        assert_eq!(migrated.record(&id).unwrap().name, "Capture");
        assert_eq!(
            fs::read(migrated.path(&id, false).unwrap()).unwrap(),
            b"original"
        );
        assert!(!legacy.exists());
        drop(migrated);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn identity_migration_does_not_replace_an_existing_library() {
        let mut old = store();
        let mut next = old.db.clone();
        next.settings.filename = "Old-{date}".into();
        old.commit(next).unwrap();
        let legacy = old.root.clone();
        drop(old);
        let current = store();
        let root = current.root.clone();
        drop(current);
        let reopened =
            Store::open_with_legacy(root.clone(), PathBuf::new(), legacy.clone()).unwrap();
        assert_ne!(reopened.db.settings.filename, "Old-{date}");
        assert!(legacy.join("library.json").exists());
        drop(reopened);
        fs::remove_dir_all(legacy).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn filenames_are_safe_unique_and_expand_tokens() {
        let s = store();
        let a = s.export_name("region", "png").unwrap();
        let b = s.export_name("region", "png").unwrap();
        assert_ne!(a, b);
        assert!(a.contains("region"));
        assert!(!a.contains('{'));
        assert!(a.ends_with(".png"));
        for name in ["../escape", "x/y", "x\\y", "", ".hidden", "x\ny", "a:b"] {
            assert!(validate_name(name).is_err());
        }
        fs::remove_dir_all(s.root).unwrap();
    }
    #[test]
    fn persistence_rename_delete_and_missing_files() {
        let mut s = store();
        let row = record();
        let id = row.id.clone();
        let mut next = s.db.clone();
        next.captures.push(row);
        s.commit(next).unwrap();
        assert!(s.path(&id, false).is_err());
        write_new(&s.root.join(format!("{id}.png")), b"original").unwrap();
        s.rename(&id, "Renamed".into()).unwrap();
        let root = s.root.clone();
        drop(s);
        let mut s = Store::open(root, PathBuf::new()).unwrap();
        assert_eq!(s.record(&id).unwrap().name, "Renamed");
        assert!(s.path("../../etc/passwd", false).is_err());
        s.delete(&id).unwrap();
        assert!(s.record(&id).is_err());
        fs::remove_dir_all(s.root).unwrap();
    }
    #[test]
    fn corrupt_metadata_is_not_silently_overwritten() {
        let s = store();
        write_new(&s.root.join("library.json"), b"broken").unwrap();
        let root = s.root.clone();
        drop(s);
        assert!(Store::open(root.clone(), PathBuf::new()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_second_writer_is_rejected_and_failed_commits_preserve_memory() {
        let mut s = store();
        assert!(Store::open(s.root.clone(), PathBuf::new()).is_err());
        fs::create_dir(s.root.join("library.json")).unwrap();
        let mut next = s.db.clone();
        next.captures.push(record());
        assert!(s.commit(next).is_err());
        assert!(s.db.captures.is_empty());
        fs::remove_dir_all(s.root).unwrap();
    }
    #[test]
    fn interrupted_image_writes_are_reclaimed_after_restart() {
        let s = store();
        let root = s.root.clone();
        let orphan = root.join(format!("{}.png", uuid::Uuid::new_v4()));
        write_new(&orphan, b"interrupted").unwrap();
        let unknown = root.join("user-note.txt");
        write_new(&unknown, b"keep").unwrap();
        drop(s);
        let s = Store::open(root, PathBuf::new()).unwrap();
        assert!(!orphan.exists());
        assert!(unknown.exists());
        fs::remove_dir_all(s.root).unwrap();
    }
    #[test]
    fn exclusive_writes_and_png_validation() {
        let s = store();
        let path = s.root.join("test.png");
        write_new(&path, b"first").unwrap();
        assert!(write_new(&path, b"second").is_err());
        assert_eq!(fs::read(path).unwrap(), b"first");
        assert!(image_bytes("data:image/png;base64,bm90IGEgcG5n").is_err());
        assert!(image_bytes("data:image/jpeg;base64,abcd").is_err());
        fs::remove_dir_all(s.root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_redirect_library_reads_or_writes() {
        use std::os::unix::fs::symlink;
        let mut s = store();
        let row = record();
        let id = row.id.clone();
        let mut next = s.db.clone();
        next.captures.push(row);
        s.commit(next).unwrap();
        let outside = s.root.join("outside");
        write_new(&outside, b"secret").unwrap();
        symlink(&outside, s.root.join(format!("{id}.png"))).unwrap();
        assert!(s.path(&id, true).is_err());
        assert!(atomic_write(&s.root.join(format!("{id}.png")), b"overwrite").is_err());
        assert_eq!(fs::read(outside).unwrap(), b"secret");
        fs::remove_dir_all(s.root).unwrap();
    }
}
