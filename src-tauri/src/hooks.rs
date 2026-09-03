use serde_json::{Map, Value};
use std::env;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const OWNED_MARKER: &str = "--codex-halo";
const LEGACY_HELPER_NAME: &str = "codex-halo-hook";
const TEMP_LIMIT: usize = 64;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
const HELPER_FILENAME: &str = "codex-halo-hook.exe";
#[cfg(not(windows))]
const HELPER_FILENAME: &str = "codex-halo-hook";

#[derive(Debug)]
pub enum HookError {
    HomeDirectoryUnavailable,
    RepairRequired,
    Json(serde_json::Error),
    Io(io::Error),
}

impl fmt::Display for HookError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::HomeDirectoryUnavailable => "Codex home directory is unavailable",
            Self::RepairRequired => "Codex hooks.json needs repair before it can be changed",
            Self::Json(_) => "Codex hooks.json has invalid JSON",
            Self::Io(_) => "Codex hooks configuration I/O failed",
        })
    }
}

impl std::error::Error for HookError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::HomeDirectoryUnavailable | Self::RepairRequired => None,
        }
    }
}

impl From<serde_json::Error> for HookError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<io::Error> for HookError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn codex_home() -> Result<PathBuf, HookError> {
    codex_home_from_environment(
        env::var_os("CODEX_HOME"),
        env::var_os("HOME"),
        env::var_os("USERPROFILE"),
        env::var_os("HOMEDRIVE"),
        env::var_os("HOMEPATH"),
    )
}

fn codex_home_from_environment(
    codex_home: Option<std::ffi::OsString>,
    _home: Option<std::ffi::OsString>,
    userprofile: Option<std::ffi::OsString>,
    homedrive: Option<std::ffi::OsString>,
    homepath: Option<std::ffi::OsString>,
) -> Result<PathBuf, HookError> {
    if let Some(path) = codex_home.filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }

    #[cfg(windows)]
    let home = userprofile.or_else(|| {
        let drive = homedrive?;
        let path = homepath?;
        Some(PathBuf::from(drive).join(path).into_os_string())
    });
    #[cfg(not(windows))]
    let home = {
        let _ = (userprofile, homedrive, homepath);
        _home
    };

    home.map(|path| PathBuf::from(path).join(".codex"))
        .ok_or(HookError::HomeDirectoryUnavailable)
}

pub fn helper_filename() -> &'static str {
    HELPER_FILENAME
}

fn runtime_root_from(codex_home: &Path) -> PathBuf {
    codex_home.join("codex-halo")
}

fn runtime_state_dir_from(codex_home: &Path) -> PathBuf {
    runtime_root_from(codex_home).join("state")
}

fn runtime_helper_path_from(codex_home: &Path) -> PathBuf {
    runtime_root_from(codex_home).join(helper_filename())
}

pub fn runtime_root() -> Result<PathBuf, HookError> {
    codex_home().map(|path| runtime_root_from(&path))
}

pub fn runtime_state_dir() -> Result<PathBuf, HookError> {
    codex_home().map(|path| runtime_state_dir_from(&path))
}

pub fn runtime_helper_path() -> Result<PathBuf, HookError> {
    codex_home().map(|path| runtime_helper_path_from(&path))
}

pub fn cleanup_legacy_entries() -> Result<bool, HookError> {
    cleanup_legacy_entries_at(&codex_home()?.join("hooks.json"))
}

fn cleanup_legacy_entries_at(config_path: &Path) -> Result<bool, HookError> {
    let (mut config, existed) = read_config(config_path)?;
    if !existed {
        return Ok(false);
    }
    if !config.is_object() {
        return Err(HookError::RepairRequired);
    }

    let Some(hooks_value) = config.get_mut("hooks") else {
        return Ok(false);
    };
    let hooks = hooks_value
        .as_object_mut()
        .ok_or(HookError::RepairRequired)?;
    let mut removed = false;

    for events in hooks.values_mut() {
        let events = events.as_array_mut().ok_or(HookError::RepairRequired)?;
        for group in &mut *events {
            if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                let before = handlers.len();
                handlers.retain(|handler| !is_owned_handler(handler));
                removed |= before != handlers.len();
            }
        }
        let before = events.len();
        events.retain(|group| !is_owned_handler(group));
        removed |= before != events.len();
    }

    if !removed {
        return Ok(false);
    }

    create_backup(config_path)?;
    atomic_write_json(config_path, &config)?;
    Ok(true)
}

fn is_owned_handler(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("command")
        && value
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| {
                command.contains(LEGACY_HELPER_NAME)
                    && command.contains(OWNED_MARKER)
                    && command.contains("--state-dir")
            })
}

fn read_config(path: &Path) -> Result<(Value, bool), HookError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(HookError::RepairRequired);
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok((Value::Object(Map::new()), false));
        }
        Err(error) => return Err(error.into()),
    }
    match fs::read(path) {
        Ok(bytes) => Ok((
            serde_json::from_slice(&bytes).map_err(|_| HookError::RepairRequired)?,
            true,
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Ok((Value::Object(Map::new()), false))
        }
        Err(error) => Err(error.into()),
    }
}

fn create_backup(path: &Path) -> Result<PathBuf, HookError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .ok_or(HookError::RepairRequired)?
        .to_string_lossy();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    for sequence in 0..TEMP_LIMIT {
        let suffix = if sequence == 0 {
            format!("{timestamp}")
        } else {
            format!("{timestamp}.{sequence}")
        };
        let backup = parent.join(format!("{name}.bak.{suffix}"));
        match copy_new_file(path, &backup) {
            Ok(()) => return Ok(backup),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "backup path unavailable").into())
}

fn copy_new_file(source_path: &Path, destination_path: &Path) -> io::Result<()> {
    let mut source = File::open(source_path)?;
    let mut destination = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination_path)?;
    let result = (|| {
        preserve_config_permissions(source_path, destination_path)?;
        io::copy(&mut source, &mut destination)?;
        destination.flush()?;
        destination.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination_path);
    }
    result
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), HookError> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec_pretty(value)?;
    let file_name = path
        .file_name()
        .ok_or(HookError::RepairRequired)?
        .to_string_lossy();
    let permissions = config_permissions(path)?;

    for _ in 0..TEMP_LIMIT {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(
            "{file_name}.tmp.{}.{}",
            std::process::id(),
            sequence
        ));
        let mut file = match OpenOptions::new().create_new(true).write(true).open(&temp) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        let result: io::Result<()> = (|| {
            apply_config_permissions(&temp, permissions)?;
            file.write_all(&bytes)?;
            file.flush()?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        return result.map_err(HookError::from);
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "temporary path unavailable").into())
}

#[cfg(unix)]
fn config_permissions(path: &Path) -> io::Result<u32> {
    use std::os::unix::fs::PermissionsExt;

    fs::symlink_metadata(path)
        .map(|metadata| metadata.permissions().mode() & 0o7777)
        .or_else(|error| {
            (error.kind() == io::ErrorKind::NotFound)
                .then_some(0o600)
                .ok_or(error)
        })
}

#[cfg(not(unix))]
fn config_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn apply_config_permissions(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(windows)]
fn apply_config_permissions(path: &Path, _mode: ()) -> io::Result<()> {
    crate::hook_protocol::set_private_permissions(path, 0o600)
}

#[cfg(not(any(unix, windows)))]
fn apply_config_permissions(_path: &Path, _mode: ()) -> io::Result<()> {
    Ok(())
}

#[cfg(windows)]
fn preserve_config_permissions(_source: &Path, destination: &Path) -> io::Result<()> {
    crate::hook_protocol::set_private_permissions(destination, 0o600)
}

#[cfg(not(windows))]
fn preserve_config_permissions(source: &Path, destination: &Path) -> io::Result<()> {
    apply_config_permissions(destination, config_permissions(source)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "codex-halo-hooks-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_config(path: &Path, value: &Value) {
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn runtime_paths_follow_supplied_codex_home_without_environment_mutation() {
        let codex_home = Path::new("/tmp/codex-home");
        let root = runtime_root_from(codex_home);

        assert_eq!(root, PathBuf::from("/tmp/codex-home/codex-halo"));
        assert_eq!(runtime_state_dir_from(codex_home), root.join("state"));
        assert_eq!(
            runtime_helper_path_from(codex_home),
            root.join(helper_filename())
        );
        assert_eq!(
            codex_home_from_environment(
                Some(std::ffi::OsString::from("/tmp/codex-home")),
                None,
                None,
                None,
                None,
            )
            .unwrap(),
            codex_home
        );
        assert!(matches!(
            codex_home_from_environment(None, None, None, None, None),
            Err(HookError::HomeDirectoryUnavailable)
        ));
    }

    #[test]
    fn cleanup_removes_only_codex_halo_entries_and_keeps_unrelated_hooks() {
        let root = temp_dir("cleanup");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(
            &config,
            &json!({
                "hooks": {
                        "Stop": [
                        { "hooks": [
                            { "type": "command", "command": "mine" },
                            { "type": "command", "command": "codex-halo-hook --codex-halo --state-dir state" }
                        ]},
                        { "type": "command", "command": "codex-halo-hook --codex-halo --state-dir state" }
                    ]
                }
            }),
        );

        assert!(cleanup_legacy_entries_at(&config).unwrap());
        let cleaned: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(
            cleaned["hooks"]["Stop"][0]["hooks"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(cleaned["hooks"]["Stop"][0]["hooks"][0]["command"], "mine");
        assert_eq!(cleaned["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert!(fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("hooks.json.bak.")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_is_idempotent() {
        let root = temp_dir("idempotent");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(
            &config,
            &json!({
                "hooks": {
                    "Stop": [{ "hooks": [
                        { "type": "command", "command": "codex-halo-hook --codex-halo --state-dir state" }
                    ]}]
                }
            }),
        );

        assert!(cleanup_legacy_entries_at(&config).unwrap());
        assert!(!cleanup_legacy_entries_at(&config).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_does_not_overwrite_invalid_json() {
        let root = temp_dir("invalid");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let original = b"{ invalid";
        fs::write(&config, original).unwrap();

        assert!(cleanup_legacy_entries_at(&config).is_err());
        assert_eq!(fs::read(&config).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ownership_requires_a_command_marker() {
        assert!(!is_owned_handler(&json!({
            "type": "command",
            "command": "python3 ./codex-halo.py"
        })));
        assert!(is_owned_handler(&json!({
            "type": "command",
            "command": "codex-halo-hook --codex-halo --state-dir state"
        })));
        assert!(!is_owned_handler(&json!({
            "type": "command",
            "command": "other-tool --codex-halo --state-dir state"
        })));
        assert!(!is_owned_handler(&json!({ "note": "--codex-halo" })));
    }
}
