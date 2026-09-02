use serde_json::{Map, Value};
use std::env;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const OWNED_MARKER: &str = "--codex-halo";
const TEMP_LIMIT: usize = 64;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
const HELPER_FILENAME: &str = "codex-halo-hook.exe";
#[cfg(not(windows))]
const HELPER_FILENAME: &str = "codex-halo-hook";

const EVENT_SPECS: [EventSpec; 8] = [
    EventSpec {
        name: "SessionStart",
        matcher: Some("startup|resume|clear|compact"),
        asynchronous: true,
    },
    EventSpec {
        name: "UserPromptSubmit",
        matcher: None,
        asynchronous: true,
    },
    EventSpec {
        name: "PreToolUse",
        matcher: Some(""),
        asynchronous: true,
    },
    EventSpec {
        name: "PermissionRequest",
        matcher: Some(""),
        asynchronous: true,
    },
    EventSpec {
        name: "PreCompact",
        matcher: Some("manual|auto"),
        asynchronous: true,
    },
    EventSpec {
        name: "PostCompact",
        matcher: Some("manual|auto"),
        asynchronous: true,
    },
    EventSpec {
        name: "Stop",
        matcher: None,
        asynchronous: true,
    },
    EventSpec {
        name: "SessionEnd",
        matcher: None,
        asynchronous: false,
    },
];

#[derive(Clone, Copy)]
struct EventSpec {
    name: &'static str,
    matcher: Option<&'static str>,
    asynchronous: bool,
}

#[derive(Debug)]
pub enum HookError {
    HomeDirectoryUnavailable,
    InvalidPath,
    RepairRequired,
    Json(serde_json::Error),
    Io(io::Error),
}

impl fmt::Display for HookError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::HomeDirectoryUnavailable => "Codex home directory is unavailable",
            Self::InvalidPath => "Codex hook paths must be absolute",
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
            Self::HomeDirectoryUnavailable | Self::InvalidPath | Self::RepairRequired => None,
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

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct InstallReport {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct RemoveReport {
    pub changed: bool,
    pub removed_handlers: usize,
    pub backup_path: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HookStatus {
    Installed,
    Missing,
    Invalid,
    PartiallyInstalled,
}

pub fn codex_home() -> Result<PathBuf, HookError> {
    if let Some(path) = env::var_os("CODEX_HOME").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }

    #[cfg(windows)]
    let home = env::var_os("USERPROFILE").or_else(|| {
        let drive = env::var_os("HOMEDRIVE")?;
        let path = env::var_os("HOMEPATH")?;
        Some(PathBuf::from(drive).join(path).into_os_string())
    });
    #[cfg(not(windows))]
    let home = env::var_os("HOME");

    home.map(|path| PathBuf::from(path).join(".codex"))
        .ok_or(HookError::HomeDirectoryUnavailable)
}

pub fn helper_filename() -> &'static str {
    HELPER_FILENAME
}

pub fn install_hooks(
    config_path: &Path,
    helper_path: &Path,
    state_dir: &Path,
) -> Result<InstallReport, HookError> {
    if !helper_path.is_absolute() || !state_dir.is_absolute() {
        return Err(HookError::InvalidPath);
    }
    let (mut config, existed) = read_config(config_path)?;
    let original = config.clone();
    let hooks = hooks_object_mut(&mut config)?;

    for spec in EVENT_SPECS {
        let events = match hooks.entry(spec.name.to_owned()) {
            serde_json::map::Entry::Vacant(entry) => entry.insert(Value::Array(Vec::new())),
            serde_json::map::Entry::Occupied(entry) => entry.into_mut(),
        };
        let events = events.as_array_mut().ok_or(HookError::RepairRequired)?;
        merge_event(events, spec, helper_path, state_dir);
    }

    if config == original {
        return Ok(InstallReport {
            changed: false,
            backup_path: None,
        });
    }

    let backup_path = if existed {
        Some(create_backup(config_path)?)
    } else {
        None
    };
    atomic_write_json(config_path, &config)?;
    Ok(InstallReport {
        changed: true,
        backup_path,
    })
}

pub fn remove_hooks(config_path: &Path) -> Result<RemoveReport, HookError> {
    let (mut config, existed) = read_config(config_path)?;
    if !existed {
        return Ok(RemoveReport {
            changed: false,
            removed_handlers: 0,
            backup_path: None,
        });
    }
    if !config.is_object() {
        return Err(HookError::RepairRequired);
    }

    let Some(hooks) = config.get_mut("hooks") else {
        return Ok(RemoveReport {
            changed: false,
            removed_handlers: 0,
            backup_path: None,
        });
    };
    let hooks = hooks.as_object_mut().ok_or(HookError::RepairRequired)?;
    let mut removed_handlers = 0;

    for events in hooks.values_mut() {
        let events = events.as_array_mut().ok_or(HookError::RepairRequired)?;
        for group in &mut *events {
            if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                handlers.retain(|handler| {
                    let owned = is_owned_handler(handler);
                    removed_handlers += usize::from(owned);
                    !owned
                });
            }
        }
        events.retain(|group| {
            let owned = is_owned_handler(group);
            removed_handlers += usize::from(owned);
            !owned
        });
    }

    if removed_handlers == 0 {
        return Ok(RemoveReport {
            changed: false,
            removed_handlers,
            backup_path: None,
        });
    }

    let backup_path = Some(create_backup(config_path)?);
    atomic_write_json(config_path, &config)?;
    Ok(RemoveReport {
        changed: true,
        removed_handlers,
        backup_path,
    })
}

pub fn is_owned_handler(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("command")
        && value
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| command.contains(OWNED_MARKER))
}

fn has_direct_owned_handler(value: &Value) -> bool {
    is_owned_handler(value)
        || value
            .get("hooks")
            .and_then(Value::as_array)
            .is_some_and(|handlers| handlers.iter().any(is_owned_handler))
}

pub fn get_hook_status(config_path: &Path, helper_path: &Path) -> HookStatus {
    if !helper_path.is_absolute() {
        return HookStatus::Invalid;
    }
    let Some(state_dir) = helper_path.parent().map(|parent| parent.join("state")) else {
        return HookStatus::Invalid;
    };
    if !state_dir.is_absolute() {
        return HookStatus::Invalid;
    }
    let Ok((config, existed)) = read_config(config_path) else {
        return if config_path.is_file() {
            HookStatus::Invalid
        } else if helper_path.is_file() {
            HookStatus::PartiallyInstalled
        } else {
            HookStatus::Missing
        };
    };
    if !existed {
        return if helper_path.is_file() {
            HookStatus::PartiallyInstalled
        } else {
            HookStatus::Missing
        };
    }

    if !config.is_object() {
        return HookStatus::Invalid;
    }
    let Some(hooks_value) = config.get("hooks") else {
        return if helper_path.is_file() {
            HookStatus::PartiallyInstalled
        } else {
            HookStatus::Missing
        };
    };
    let Some(hooks) = hooks_value.as_object() else {
        return HookStatus::Invalid;
    };
    let installed_events = EVENT_SPECS
        .iter()
        .filter(|spec| {
            let Some(value) = hooks.get(spec.name) else {
                return false;
            };
            value.as_array().is_some_and(|events| {
                let expected = owned_group(**spec, helper_path, &state_dir);
                events.iter().any(|group| group == &expected)
            })
        })
        .count();
    if hooks.values().any(|events| !events.is_array()) {
        return HookStatus::Invalid;
    }
    if EVENT_SPECS.iter().any(|spec| {
        let expected = owned_group(*spec, helper_path, &state_dir);
        hooks
            .get(spec.name)
            .and_then(Value::as_array)
            .is_some_and(|events| {
                events
                    .iter()
                    .any(|group| has_direct_owned_handler(group) && group != &expected)
            })
    }) {
        return HookStatus::PartiallyInstalled;
    }

    if installed_events == EVENT_SPECS.len() && helper_path.is_file() {
        HookStatus::Installed
    } else if installed_events == 0 && !helper_path.is_file() {
        HookStatus::Missing
    } else {
        HookStatus::PartiallyInstalled
    }
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

fn hooks_object_mut(config: &mut Value) -> Result<&mut Map<String, Value>, HookError> {
    let object = config.as_object_mut().ok_or(HookError::RepairRequired)?;
    match object.entry("hooks".to_owned()) {
        serde_json::map::Entry::Vacant(entry) => {
            entry.insert(Value::Object(Map::new()));
        }
        serde_json::map::Entry::Occupied(entry) if !entry.get().is_object() => {
            return Err(HookError::RepairRequired);
        }
        serde_json::map::Entry::Occupied(_) => {}
    }
    config
        .get_mut("hooks")
        .and_then(Value::as_object_mut)
        .ok_or(HookError::RepairRequired)
}

fn merge_event(events: &mut Vec<Value>, spec: EventSpec, helper_path: &Path, state_dir: &Path) {
    let generated = owned_group(spec, helper_path, state_dir);
    let mut found = false;
    let mut index = 0;

    while index < events.len() {
        let Some(handlers) = events[index].get_mut("hooks").and_then(Value::as_array_mut) else {
            if is_owned_handler(&events[index]) {
                if found {
                    events.remove(index);
                    continue;
                }
                events[index] = generated.clone();
                found = true;
            }
            index += 1;
            continue;
        };

        let owned_indices = handlers
            .iter()
            .enumerate()
            .filter_map(|(handler_index, handler)| {
                is_owned_handler(handler).then_some(handler_index)
            })
            .collect::<Vec<_>>();
        if owned_indices.is_empty() {
            index += 1;
            continue;
        }
        if !found && owned_indices.len() == handlers.len() {
            events[index] = generated.clone();
            found = true;
            index += 1;
            continue;
        }

        for handler_index in owned_indices.into_iter().rev() {
            handlers.remove(handler_index);
        }
        index += 1;
    }

    if !found {
        events.push(generated);
    }
}

fn owned_group(spec: EventSpec, helper_path: &Path, state_dir: &Path) -> Value {
    let mut command = Map::new();
    command.insert("type".to_owned(), Value::String("command".to_owned()));
    command.insert(
        "command".to_owned(),
        Value::String(format!(
            "{} --codex-halo --state-dir {}",
            quote_posix_arg(helper_path),
            quote_posix_arg(state_dir)
        )),
    );
    #[cfg(windows)]
    command.insert(
        "commandWindows".to_owned(),
        Value::String(windows_command(helper_path, state_dir)),
    );
    if spec.asynchronous {
        command.insert("async".to_owned(), Value::Bool(true));
    }
    command.insert(
        "statusMessage".to_owned(),
        Value::String("Codex Halo".to_owned()),
    );

    let mut group = Map::new();
    if let Some(matcher) = spec.matcher {
        group.insert("matcher".to_owned(), Value::String(matcher.to_owned()));
    }
    group.insert(
        "hooks".to_owned(),
        Value::Array(vec![Value::Object(command)]),
    );
    Value::Object(group)
}

fn quote_posix_arg(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn windows_command(helper_path: &Path, state_dir: &Path) -> String {
    let script = format!(
        "$helper = '{}'; $state = '{}'; & $helper '--codex-halo' '--state-dir' $state",
        helper_path.to_string_lossy().replace('\'', "''"),
        state_dir.to_string_lossy().replace('\'', "''")
    );
    format!(
        "powershell.exe -NoProfile -NonInteractive -EncodedCommand {}",
        encode_base64_utf16le(&script)
    )
}

#[cfg_attr(not(windows), allow(dead_code))]
fn encode_base64_utf16le(value: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = value
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(ALPHABET[(first >> 2) as usize] as char);
        encoded.push(ALPHABET[((first & 0x03) << 4 | second >> 4) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            ALPHABET[((second & 0x0f) << 2 | third >> 6) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            ALPHABET[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
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
    let mut destination = match OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination_path)
    {
        Ok(file) => file,
        Err(error) => return Err(error),
    };
    let result = (|| {
        io::copy(&mut source, &mut destination)?;
        destination.flush()?;
        destination.sync_all()
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    const EVENTS: [&str; 8] = [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PermissionRequest",
        "PreCompact",
        "PostCompact",
        "Stop",
        "SessionEnd",
    ];

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

    fn fixture() -> Value {
        json!({
            "hooks": {
                "UserPromptSubmit": [
                    { "hooks": [{ "type": "command", "command": "python3 ./mine.py" }] }
                ]
            }
        })
    }

    fn owned_count(value: &Value) -> usize {
        value
            .get("hooks")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|events| events.values())
            .flat_map(Value::as_array)
            .flat_map(|groups| groups.iter())
            .flat_map(|group| group.get("hooks").and_then(Value::as_array))
            .flatten()
            .filter(|handler| is_owned_handler(handler))
            .count()
    }

    fn write_config(path: &Path, value: &Value) {
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn install_preserves_unrelated_handlers() {
        let root = temp_dir("preserve");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());

        install_hooks(&config, &root.join("codex-halo-hook"), &root.join("state")).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(
            installed["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"],
            "python3 ./mine.py"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn second_install_does_not_duplicate_owned_handlers() {
        let root = temp_dir("idempotent");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());
        let helper = root.join("codex-halo-hook");
        let state = root.join("state");

        install_hooks(&config, &helper, &state).unwrap();
        install_hooks(&config, &helper, &state).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(owned_count(&installed), EVENTS.len());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removal_deletes_only_owned_handlers() {
        let root = temp_dir("remove");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());
        install_hooks(&config, &root.join("codex-halo-hook"), &root.join("state")).unwrap();

        remove_hooks(&config).unwrap();

        let removed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(owned_count(&removed), 0);
        assert_eq!(
            removed["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"],
            "python3 ./mine.py"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_json_is_not_overwritten() {
        let root = temp_dir("invalid");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let original = b"{ invalid";
        fs::write(&config, original).unwrap();

        assert!(install_hooks(&config, &root.join("helper"), &root.join("state")).is_err());
        assert_eq!(fs::read(&config).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_replaces_config_atomically() {
        let root = temp_dir("atomic");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());

        install_hooks(&config, &root.join("helper"), &root.join("state")).unwrap();

        assert!(serde_json::from_slice::<Value>(&fs::read(&config).unwrap()).is_ok());
        assert!(!fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("hooks.json.tmp.")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn first_change_creates_a_timestamped_backup_only_once() {
        let root = temp_dir("backup");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let original = serde_json::to_vec_pretty(&fixture()).unwrap();
        fs::write(&config, &original).unwrap();
        let helper = root.join("helper");
        let state = root.join("state");

        install_hooks(&config, &helper, &state).unwrap();

        let backups = || {
            fs::read_dir(&root)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("hooks.json.bak.")
                })
                .collect::<Vec<_>>()
        };
        let first_backups = backups();
        assert_eq!(first_backups.len(), 1);
        assert_eq!(fs::read(first_backups[0].path()).unwrap(), original);

        install_hooks(&config, &helper, &state).unwrap();
        assert_eq!(backups().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_command_paths_use_the_exe_helper_path() {
        let root = temp_dir("windows-helper");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());
        let helper = root.join("codex-halo-hook.exe");

        install_hooks(&config, &helper, &root.join("state")).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        let command = installed["hooks"]["SessionStart"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(command.contains("codex-halo-hook.exe"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn all_eight_mapped_event_groups_are_present() {
        let root = temp_dir("events");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &fixture());

        install_hooks(&config, &root.join("helper"), &root.join("state")).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        for event in EVENTS {
            assert!(installed["hooks"][event].as_array().is_some(), "{event}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_groups_use_the_required_matchers_and_async_values() {
        let root = temp_dir("shape");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(&config, &Value::Object(Default::default()));

        install_hooks(&config, &root.join("helper"), &root.join("state")).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(
            installed["hooks"]["SessionStart"][0]["matcher"],
            "startup|resume|clear|compact"
        );
        assert_eq!(
            installed["hooks"]["PreCompact"][0]["matcher"],
            "manual|auto"
        );
        assert_eq!(installed["hooks"]["PreToolUse"][0]["matcher"], "");
        assert!(installed["hooks"]["UserPromptSubmit"][0]["matcher"].is_null());
        for event in EVENTS {
            let command = &installed["hooks"][event][0]["hooks"][0];
            assert_eq!(command["type"], "command");
            assert!(command["command"].as_str().unwrap().contains(OWNED_MARKER));
            assert_eq!(command["statusMessage"], "Codex Halo");
            if event == "SessionEnd" {
                assert!(command["async"].is_null());
            } else {
                assert_eq!(command["async"], true);
            }
            #[cfg(windows)]
            assert!(command["commandWindows"].as_str().is_some());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn status_distinguishes_missing_invalid_partial_and_installed() {
        let root = temp_dir("status");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let helper = root.join("helper");
        let state = root.join("state");

        assert_eq!(get_hook_status(&config, &helper), HookStatus::Missing);
        fs::write(&config, b"{ invalid").unwrap();
        assert_eq!(get_hook_status(&config, &helper), HookStatus::Invalid);
        write_config(&config, &fixture());
        fs::write(&helper, b"helper").unwrap();
        assert_eq!(
            get_hook_status(&config, &helper),
            HookStatus::PartiallyInstalled
        );
        install_hooks(&config, &helper, &state).unwrap();
        assert_eq!(get_hook_status(&config, &helper), HookStatus::Installed);
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
            "command": "helper --codex-halo --state-dir state"
        })));
        assert!(!is_owned_handler(&json!({ "note": "--codex-halo" })));
    }

    #[test]
    fn removal_keeps_empty_unrelated_matcher_groups() {
        let root = temp_dir("empty-group");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(
            &config,
            &json!({
                "hooks": {
                    "Stop": [
                        { "matcher": "mine", "hooks": [] }
                    ]
                }
            }),
        );
        install_hooks(&config, &root.join("helper"), &root.join("state")).unwrap();

        remove_hooks(&config).unwrap();

        let removed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(removed["hooks"]["Stop"][0]["matcher"], "mine");
        assert_eq!(removed["hooks"]["Stop"][0]["hooks"], json!([]));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mixed_groups_keep_unrelated_handlers_and_get_separate_matchers() {
        let root = temp_dir("mixed-matchers");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let owned = json!({
            "type": "command",
            "command": "old-helper --codex-halo --state-dir old-state"
        });
        let unrelated = json!({
            "type": "command",
            "command": "python3 ./mine.py"
        });
        write_config(
            &config,
            &json!({
                "hooks": {
                    "SessionStart": [{
                        "matcher": "stale-start",
                        "hooks": [owned.clone(), unrelated.clone()]
                    }],
                    "PreToolUse": [{
                        "matcher": "stale-tool",
                        "hooks": [owned.clone(), unrelated.clone()]
                    }],
                    "PreCompact": [{
                        "matcher": "stale-compact",
                        "hooks": [owned.clone(), unrelated.clone()]
                    }],
                    "UserPromptSubmit": [{
                        "hooks": [owned, unrelated]
                    }]
                }
            }),
        );

        install_hooks(&config, &root.join("helper"), &root.join("state")).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        let cases = [
            ("SessionStart", Some("startup|resume|clear|compact")),
            ("PreToolUse", Some("")),
            ("PreCompact", Some("manual|auto")),
            ("UserPromptSubmit", None),
        ];
        for (event, matcher) in cases {
            let groups = installed["hooks"][event].as_array().unwrap();
            assert!(groups.iter().any(|group| {
                group["hooks"].as_array().unwrap().iter().any(|handler| {
                    handler["command"]
                        .as_str()
                        .is_some_and(|command| command.contains("--codex-halo"))
                }) && match matcher {
                    Some(value) => group["matcher"] == value,
                    None => group.get("matcher").is_none(),
                }
            }));
            assert_eq!(
                groups[0]["hooks"][0]["command"], "python3 ./mine.py",
                "{event}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relative_paths_fail_without_mutating_config() {
        let root = temp_dir("relative-paths");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let original = serde_json::to_vec_pretty(&fixture()).unwrap();
        fs::write(&config, &original).unwrap();

        assert!(install_hooks(&config, Path::new("helper"), &root.join("state")).is_err());
        assert!(install_hooks(&config, &root.join("helper"), Path::new("state")).is_err());
        assert_eq!(fs::read(&config).unwrap(), original);
        assert!(!fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("hooks.json.bak.")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_config_is_rejected_without_changing_link_or_target() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("config-symlink");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.json");
        let link = root.join("hooks.json");
        let original = serde_json::to_vec_pretty(&fixture()).unwrap();
        fs::write(&target, &original).unwrap();
        symlink(&target, &link).unwrap();

        assert!(install_hooks(&link, &root.join("helper"), &root.join("state")).is_err());
        assert!(remove_hooks(&link).is_err());
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&target).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_wrappers_are_not_owned_or_removed() {
        let nested = json!({
            "hooks": [{
                "hooks": [{
                    "type": "command",
                    "command": "nested --codex-halo --state-dir state"
                }]
            }]
        });
        assert!(!is_owned_handler(&nested));

        let root = temp_dir("nested-wrapper");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        write_config(
            &config,
            &json!({
                "hooks": {
                    "Stop": [nested]
                }
            }),
        );
        remove_hooks(&config).unwrap();
        let after: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert!(after["hooks"]["Stop"][0]["hooks"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("--codex-halo"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn posix_commands_quote_paths_with_shell_metacharacters() {
        let root = temp_dir("posix-quoting");
        fs::create_dir_all(&root).unwrap();
        let config = root.join("hooks.json");
        let helper = root.join("helper space/'quote'/$cash/`tick`;&|\\slash");
        let state = root.join("state space/'quote'/$cash/`tick`;&|\\slash");
        write_config(&config, &Value::Object(Default::default()));

        install_hooks(&config, &helper, &state).unwrap();

        let installed: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        let command = installed["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        let quoted_helper = helper.to_string_lossy().replace('\'', "'\"'\"'");
        let quoted_state = state.to_string_lossy().replace('\'', "'\"'\"'");
        assert!(command.starts_with(&format!(
            "'{}' --codex-halo --state-dir '{}'",
            quoted_helper, quoted_state
        )));
        assert!(command.contains("'\"'\"'"));
        assert!(command.contains("$cash"));
        assert!(command.contains("`tick`"));
        fs::remove_dir_all(root).unwrap();
    }

    fn decode_base64_utf16le(value: &str) -> String {
        fn decode_byte(byte: u8) -> u8 {
            match byte {
                b'A'..=b'Z' => byte - b'A',
                b'a'..=b'z' => byte - b'a' + 26,
                b'0'..=b'9' => byte - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => 0,
            }
        }

        let mut bytes = Vec::new();
        for chunk in value.as_bytes().chunks(4) {
            let values = chunk
                .iter()
                .map(|byte| decode_byte(*byte))
                .collect::<Vec<_>>();
            bytes.push((values[0] << 2) | (values[1] >> 4));
            if chunk.len() > 2 && chunk[2] != b'=' {
                bytes.push((values[1] << 4) | (values[2] >> 2));
            }
            if chunk.len() > 3 && chunk[3] != b'=' {
                bytes.push((values[2] << 6) | values[3]);
            }
        }
        String::from_utf16(
            &bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    #[test]
    fn windows_command_avoids_raw_paths_under_cmd_outer_runner() {
        let helper =
            Path::new(r#"C:\Codex Halo\100%!\safe&^$`tick`;=+,[]{}'quote'\codex-halo-hook.exe"#);
        let state = Path::new(r#"C:\Codex Halo\state 100%!\safe&^$`tick`;=+,[]{}'quote'\state"#);
        let command = windows_command(helper, state);
        let outer = format!(r#"cmd.exe /d /s /c "{command}""#);

        assert!(command.starts_with("powershell.exe -NoProfile -NonInteractive -EncodedCommand "));
        assert!(!command.contains('"'));
        for character in ['%', '!', '&', '^', '$', '`'] {
            assert!(
                !command.contains(character),
                "raw shell character: {character}"
            );
        }
        assert!(!outer.contains(helper.to_string_lossy().as_ref()));
        assert!(!outer.contains(state.to_string_lossy().as_ref()));

        let encoded = command.split_once("-EncodedCommand ").unwrap().1;
        let script = decode_base64_utf16le(encoded);
        assert!(script.contains(&helper.to_string_lossy().replace('\'', "''")));
        assert!(script.contains(&state.to_string_lossy().replace('\'', "''")));
        assert!(script.contains("--codex-halo"));
        assert!(script.contains("--state-dir"));
    }

    #[test]
    fn status_rejects_stale_or_malformed_owned_groups() {
        let mutations: [(&str, fn(&mut Value)); 5] = [
            ("wrong-matcher", |config| {
                config["hooks"]["SessionStart"][0]["matcher"] = json!("stale");
            }),
            ("wrong-async", |config| {
                config["hooks"]["Stop"][0]["hooks"][0]["async"] = json!(false);
            }),
            ("relative-helper", |config| {
                config["hooks"]["Stop"][0]["hooks"][0]["command"] =
                    json!("helper --codex-halo --state-dir '/absolute/state'");
            }),
            ("wrong-state", |config| {
                config["hooks"]["Stop"][0]["hooks"][0]["command"] =
                    json!("'/absolute/helper' --codex-halo --state-dir '/wrong/state'");
            }),
            ("missing-marker", |config| {
                config["hooks"]["Stop"][0]["hooks"][0]["command"] =
                    json!("'/absolute/helper' --state-dir '/absolute/state'");
            }),
        ];

        for (name, mutate) in mutations {
            let root = temp_dir(name);
            fs::create_dir_all(&root).unwrap();
            let config_path = root.join("hooks.json");
            let helper = root.join("helper");
            let state = root.join("state");
            write_config(&config_path, &fixture());
            fs::write(&helper, b"helper").unwrap();
            install_hooks(&config_path, &helper, &state).unwrap();
            let mut config: Value =
                serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
            mutate(&mut config);
            write_config(&config_path, &config);

            assert_eq!(
                get_hook_status(&config_path, &helper),
                HookStatus::PartiallyInstalled,
                "{name}"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn status_rejects_an_extra_stale_owned_stop_group() {
        let root = temp_dir("extra-stale-stop");
        fs::create_dir_all(&root).unwrap();
        let config_path = root.join("hooks.json");
        let helper = root.join("helper");
        let state = root.join("state");
        write_config(&config_path, &fixture());
        fs::write(&helper, b"helper").unwrap();
        install_hooks(&config_path, &helper, &state).unwrap();

        let mut config: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
        config["hooks"]["Stop"].as_array_mut().unwrap().push(json!({
            "hooks": [{
                "type": "command",
                "command": "'stale-helper' --codex-halo --state-dir 'stale-state'",
                "async": true,
                "statusMessage": "Codex Halo"
            }]
        }));
        write_config(&config_path, &config);

        assert_eq!(
            get_hook_status(&config_path, &helper),
            HookStatus::PartiallyInstalled
        );
        fs::remove_dir_all(root).unwrap();
    }
}
