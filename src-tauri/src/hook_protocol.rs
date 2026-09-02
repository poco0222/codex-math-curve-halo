use crate::state::{HaloState, Snapshot};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[cfg(windows)]
const HELPER_FILENAME: &str = "codex-halo-hook.exe";
#[cfg(not(windows))]
const HELPER_FILENAME: &str = "codex-halo-hook";

#[derive(Debug, Deserialize)]
pub struct HookInput {
    session_id: String,
    hook_event_name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HookAction {
    Set(HaloState),
    Remove,
}

#[derive(Debug)]
pub enum HookError {
    InvalidInput,
    Json(serde_json::Error),
    Io(io::Error),
}

impl fmt::Display for HookError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidInput => "invalid hook input",
            Self::Json(_) => "invalid hook JSON",
            Self::Io(_) => "hook I/O failed",
        })
    }
}

impl std::error::Error for HookError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::InvalidInput => None,
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

pub fn parse_hook_input(bytes: &[u8]) -> Result<HookInput, HookError> {
    let input: HookInput = serde_json::from_slice(bytes)?;
    if input.session_id.trim().is_empty() || input.hook_event_name.trim().is_empty() {
        return Err(HookError::InvalidInput);
    }
    Ok(input)
}

pub fn map_event(input: &HookInput) -> Option<HookAction> {
    match input.hook_event_name.as_str() {
        "SessionStart" => Some(HookAction::Set(HaloState::Idle)),
        "UserPromptSubmit" => Some(HookAction::Set(HaloState::Thinking)),
        "PreToolUse" => Some(HookAction::Set(HaloState::Executing)),
        "PermissionRequest" => Some(HookAction::Set(HaloState::InputNeeded)),
        "PreCompact" => Some(HookAction::Set(HaloState::Compacting)),
        "PostCompact" => Some(HookAction::Set(HaloState::Thinking)),
        "Stop" => Some(HookAction::Set(HaloState::Completed)),
        "SessionEnd" => Some(HookAction::Remove),
        _ => None,
    }
}

pub fn write_snapshot(
    state_dir: &Path,
    input: &HookInput,
    state: HaloState,
    now_ms: i64,
) -> Result<(), HookError> {
    prepare_private_dir(state_dir)?;
    let session_key = session_key(input);
    let path = state_dir.join(format!("{session_key}.json"));
    let temp_path = state_dir.join(format!("{session_key}.json.tmp"));
    let mut file = private_new_file(&temp_path)?;
    let result = (|| {
        serde_json::to_writer(&mut file, &Snapshot::new(session_key, state, now_ms))?;
        file.flush()?;
        fs::rename(&temp_path, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

pub fn remove_snapshot(state_dir: &Path, input: &HookInput) -> Result<(), HookError> {
    let path = snapshot_path(state_dir, input);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn install_helper(source: &Path, app_data_dir: &Path) -> Result<PathBuf, HookError> {
    prepare_private_dir(app_data_dir)?;
    let destination = app_data_dir.join(HELPER_FILENAME);
    let temp_path = app_data_dir.join(format!("{HELPER_FILENAME}.tmp"));
    let result = (|| {
        let mut source = fs::File::open(source)?;
        let mut target = private_file(&temp_path)?;
        io::copy(&mut source, &mut target)?;
        target.flush()?;
        fs::rename(&temp_path, &destination)?;
        set_private_permissions(&destination, 0o700)?;
        Ok(destination.clone())
    })();

    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

pub fn install_bundled_helper(app_data_dir: &Path) -> Result<PathBuf, HookError> {
    let source = std::env::current_exe()?.with_file_name(HELPER_FILENAME);
    install_helper(&source, app_data_dir)
}

fn snapshot_path(state_dir: &Path, input: &HookInput) -> PathBuf {
    state_dir.join(format!("{}.json", session_key(input)))
}

fn session_key(input: &HookInput) -> String {
    format!("{:x}", Sha256::digest(input.session_id.as_bytes()))
}

fn prepare_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    set_private_permissions(path, 0o700)
}

fn private_file(path: &Path) -> io::Result<fs::File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    set_private_permissions(path, 0o600)?;
    Ok(file)
}

fn private_new_file(path: &Path) -> io::Result<fs::File> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    set_private_permissions(path, 0o600)?;
    Ok(file)
}

#[cfg(unix)]
fn set_private_permissions(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::HaloState;
    use serde_json::Value;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(event: &str) -> Vec<u8> {
        format!(
            r#"{{
                "session_id": "thr_123",
                "hook_event_name": "{event}",
                "tool_name": "Bash",
                "prompt": "must not be persisted",
                "cwd": "/private/project",
                "transcript_path": "/private/transcript.jsonl",
                "tool_input": {{"command": "secret"}},
                "tool_response": "secret response",
                "model": "private-model"
            }}"#
        )
        .into_bytes()
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codex-halo-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn maps_only_the_eight_codex_lifecycle_events() {
        let cases = [
            ("SessionStart", HookAction::Set(HaloState::Idle)),
            ("UserPromptSubmit", HookAction::Set(HaloState::Thinking)),
            ("PreToolUse", HookAction::Set(HaloState::Executing)),
            ("PermissionRequest", HookAction::Set(HaloState::InputNeeded)),
            ("PreCompact", HookAction::Set(HaloState::Compacting)),
            ("PostCompact", HookAction::Set(HaloState::Thinking)),
            ("Stop", HookAction::Set(HaloState::Completed)),
            ("SessionEnd", HookAction::Remove),
        ];

        for (event, expected) in cases {
            let input = parse_hook_input(&fixture(event)).unwrap();
            assert_eq!(map_event(&input), Some(expected), "{event}");
        }
    }

    #[test]
    fn accepts_extra_codex_fields_but_keeps_only_identity_and_event() {
        let input = parse_hook_input(&fixture("PreToolUse")).unwrap();

        assert_eq!(input.session_id, "thr_123");
        assert_eq!(input.hook_event_name, "PreToolUse");
    }

    #[test]
    fn rejects_malformed_or_empty_required_fields() {
        let cases = [
            b"{".as_slice(),
            br#"{"hook_event_name":"Stop"}"#,
            br#"{"session_id":"thr_123"}"#,
            br#"{"session_id":"","hook_event_name":"Stop"}"#,
            br#"{"session_id":"thr_123","hook_event_name":"   "}"#,
        ];

        for raw in cases {
            assert!(parse_hook_input(raw).is_err());
        }
    }

    #[test]
    fn ignores_unknown_events() {
        let input = parse_hook_input(&fixture("PostToolUse")).unwrap();

        assert_eq!(map_event(&input), None);
    }

    #[test]
    fn writes_one_atomic_hashed_content_free_snapshot() {
        let state_dir = temp_path("snapshot");
        let input = parse_hook_input(&fixture("PreToolUse")).unwrap();

        write_snapshot(&state_dir, &input, HaloState::Executing, 1_234_567).unwrap();

        let expected_key = "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889";
        let snapshot_path = state_dir.join(format!("{expected_key}.json"));
        let contents = fs::read_to_string(&snapshot_path).unwrap();
        let value: Value = serde_json::from_str(&contents).unwrap();
        let object = value.as_object().unwrap();

        assert_eq!(object.len(), 3);
        assert_eq!(object["session_key"], expected_key);
        assert_eq!(object["state"], "executing");
        assert_eq!(object["updated_at_ms"], 1_234_567);
        assert!(!contents.contains("thr_123"));
        assert!(!contents.contains("must not be persisted"));
        assert!(!contents.contains("Bash"));
        assert!(!contents.contains("private"));
        assert!(!state_dir.join(format!("{expected_key}.json.tmp")).exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&state_dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }

        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn removes_only_the_hashed_session_snapshot() {
        let state_dir = temp_path("remove");
        let input = parse_hook_input(&fixture("SessionEnd")).unwrap();
        write_snapshot(&state_dir, &input, HaloState::Thinking, 100).unwrap();
        let unrelated = state_dir.join("unrelated.json");
        fs::write(&unrelated, "{}").unwrap();

        remove_snapshot(&state_dir, &input).unwrap();

        assert_eq!(fs::read_dir(&state_dir).unwrap().count(), 1);
        assert!(unrelated.exists());
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn does_not_truncate_an_in_progress_snapshot_temp_file() {
        let state_dir = temp_path("temp-race");
        fs::create_dir_all(&state_dir).unwrap();
        let input = parse_hook_input(&fixture("PreToolUse")).unwrap();
        let key = "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889";
        let temp_path = state_dir.join(format!("{key}.json.tmp"));
        fs::write(&temp_path, b"in-progress").unwrap();

        assert!(write_snapshot(&state_dir, &input, HaloState::Executing, 100).is_err());
        assert_eq!(fs::read(&temp_path).unwrap(), b"in-progress");
        assert!(!state_dir.join(format!("{key}.json")).exists());
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn installs_the_bundled_helper_at_a_stable_private_path() {
        let root = temp_path("helper");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("bundled-helper");
        let app_data_dir = root.join("app-data");
        fs::write(&source, b"helper-v1").unwrap();

        let installed = install_helper(&source, &app_data_dir).unwrap();

        #[cfg(windows)]
        assert_eq!(installed, app_data_dir.join("codex-halo-hook.exe"));
        #[cfg(not(windows))]
        assert_eq!(installed, app_data_dir.join("codex-halo-hook"));
        assert_eq!(fs::read(&installed).unwrap(), b"helper-v1");
        assert!(!app_data_dir.join(format!("{HELPER_FILENAME}.tmp")).exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&installed).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }

        fs::remove_dir_all(root).unwrap();
    }
}
