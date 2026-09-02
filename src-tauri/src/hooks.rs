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
            if group.get("hooks").is_some() {
                return true;
            }
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
    if value.get("type").and_then(Value::as_str) == Some("command") {
        return value
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| command.contains(OWNED_MARKER));
    }
    value
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|handlers| handlers.iter().any(is_owned_handler))
}

pub fn get_hook_status(config_path: &Path, helper_path: &Path) -> HookStatus {
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
            value
                .as_array()
                .is_some_and(|events| events.iter().any(is_owned_handler))
        })
        .count();
    if hooks.values().any(|events| !events.is_array()) {
        return HookStatus::Invalid;
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
    let generated_handler = generated["hooks"][0].clone();
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
            if !found {
                handlers[handler_index] = generated_handler.clone();
                found = true;
            } else {
                handlers.remove(handler_index);
            }
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
            "\"{}\" --codex-halo --state-dir \"{}\"",
            helper_path.to_string_lossy(),
            state_dir.to_string_lossy()
        )),
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
}
