use crate::state::{HaloState, Snapshot};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(windows)]
const HELPER_FILENAME: &str = "codex-halo-hook.exe";
#[cfg(not(windows))]
const HELPER_FILENAME: &str = "codex-halo-hook";

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
pub struct HookInput {
    session_id: String,
    hook_event_name: String,
    #[serde(default)]
    source: Option<String>,
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
        "SessionStart" => Some(HookAction::Set(
            if input.source.as_deref() == Some("compact") {
                HaloState::Thinking
            } else {
                HaloState::Idle
            },
        )),
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
    let (temp_path, mut file) = private_temp_file(state_dir, &format!("{session_key}.json"))?;
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
    let remove_result = match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    };
    remove_result.and(cleanup_session_temps(state_dir, input))
}

pub fn install_helper(source: &Path, runtime_root: &Path) -> Result<PathBuf, HookError> {
    prepare_private_dir(runtime_root)?;
    let destination = runtime_root.join(HELPER_FILENAME);
    let (temp_path, mut target) = private_temp_file(runtime_root, HELPER_FILENAME)?;
    let result = (|| {
        let mut source = fs::File::open(source)?;
        io::copy(&mut source, &mut target)?;
        target.flush()?;
        set_private_permissions(&temp_path, 0o700)?;
        fs::rename(&temp_path, &destination)?;
        Ok(destination.clone())
    })();

    if result.is_err() {
        let _ = fs::remove_file(temp_path);
    }
    result
}

pub fn install_bundled_helper(runtime_root: &Path) -> Result<PathBuf, HookError> {
    let source = std::env::current_exe()?.with_file_name(HELPER_FILENAME);
    install_helper(&source, runtime_root)
}

#[cfg_attr(not(test), allow(dead_code))]
fn windows_private_acl_descriptor(is_directory: bool) -> &'static str {
    if is_directory {
        "D:P(A;OICI;FA;;;OW)"
    } else {
        "D:P(A;;FA;;;OW)"
    }
}

pub fn is_snapshot_filename(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(key) = name.strip_suffix(".json") else {
        return false;
    };
    key.len() == 64
        && key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn snapshot_path(state_dir: &Path, input: &HookInput) -> PathBuf {
    state_dir.join(format!("{}.json", session_key(input)))
}

fn session_key(input: &HookInput) -> String {
    format!("{:x}", Sha256::digest(input.session_id.as_bytes()))
}

fn cleanup_session_temps(state_dir: &Path, input: &HookInput) -> Result<(), HookError> {
    let prefix = format!("{}.json.tmp", session_key(input));
    let entries = match fs::read_dir(state_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_str().is_some_and(|name| name.starts_with(&prefix)) {
            match fs::remove_file(entry.path()) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

fn prepare_private_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    set_private_permissions(path, 0o700)
}

fn private_new_file(path: &Path) -> io::Result<fs::File> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    if let Err(error) = set_private_permissions(path, 0o600) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(file)
}

fn private_temp_file(dir: &Path, stem: &str) -> io::Result<(PathBuf, fs::File)> {
    for _ in 0..64 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!("{stem}.tmp.{}.{}", std::process::id(), sequence));
        match private_new_file(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "unable to allocate a private temp file",
    ))
}

#[cfg(unix)]
pub(crate) fn set_private_permissions(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(all(not(unix), not(windows)))]
pub(crate) fn set_private_permissions(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(windows)]
pub(crate) fn set_private_permissions(path: &Path, _mode: u32) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR,
    };

    let descriptor = windows_private_acl_descriptor(path.is_dir())
        .encode_utf16()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let filename = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut security_descriptor: PSECURITY_DESCRIPTOR = null_mut();
    let mut descriptor_size = 0;

    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor.as_ptr(),
            SDDL_REVISION_1,
            &mut security_descriptor,
            &mut descriptor_size,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }

        let result = SetFileSecurityW(
            filename.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            security_descriptor,
        );
        let error = if result == 0 {
            Some(io::Error::last_os_error())
        } else {
            None
        };
        let _ = LocalFree(security_descriptor);
        error.map_or(Ok(()), Err)
    }
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
    fn compact_session_start_enters_thinking_without_persisting_source() {
        let input = parse_hook_input(
            br#"{"session_id":"thr_123","hook_event_name":"SessionStart","source":"compact","prompt":"secret","cwd":"/private/project"}"#,
        )
        .unwrap();

        assert_eq!(
            map_event(&input),
            Some(HookAction::Set(HaloState::Thinking))
        );
        let state_dir = temp_path("compact-source");
        write_snapshot(&state_dir, &input, HaloState::Thinking, 1_234_567).unwrap();
        let contents = fs::read_to_string(
            state_dir.join("e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json"),
        )
        .unwrap();
        assert!(!contents.contains("source"));
        assert!(!contents.contains("prompt"));
        assert!(!contents.contains("cwd"));
        fs::remove_dir_all(state_dir).unwrap();
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
        let key = "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889";
        let fixed_temp = state_dir.join(format!("{key}.json.tmp"));
        let crash_temp = state_dir.join(format!("{key}.json.tmp.crash-residue"));
        fs::write(&unrelated, "{}").unwrap();
        fs::write(&fixed_temp, "{}").unwrap();
        fs::write(&crash_temp, "{}").unwrap();

        remove_snapshot(&state_dir, &input).unwrap();

        assert_eq!(fs::read_dir(&state_dir).unwrap().count(), 1);
        assert!(unrelated.exists());
        assert!(!fixed_temp.exists());
        assert!(!crash_temp.exists());
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn fixed_crash_residue_does_not_block_a_unique_snapshot_temp() {
        let state_dir = temp_path("temp-race");
        fs::create_dir_all(&state_dir).unwrap();
        let input = parse_hook_input(&fixture("PreToolUse")).unwrap();
        let key = "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889";
        let temp_path = state_dir.join(format!("{key}.json.tmp"));
        fs::write(&temp_path, b"in-progress").unwrap();

        write_snapshot(&state_dir, &input, HaloState::Executing, 100).unwrap();
        assert_eq!(fs::read(&temp_path).unwrap(), b"in-progress");
        assert!(state_dir.join(format!("{key}.json")).exists());
        remove_snapshot(&state_dir, &input).unwrap();
        assert!(!temp_path.exists());
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn installs_the_bundled_helper_at_a_stable_private_path() {
        let root = temp_path("helper");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("bundled-helper");
        let runtime_root = root.join("runtime");
        fs::write(&source, b"helper-v1").unwrap();

        let installed = install_helper(&source, &runtime_root).unwrap();

        #[cfg(windows)]
        assert_eq!(installed, runtime_root.join("codex-halo-hook.exe"));
        #[cfg(not(windows))]
        assert_eq!(installed, runtime_root.join("codex-halo-hook"));
        assert_eq!(fs::read(&installed).unwrap(), b"helper-v1");
        assert!(!runtime_root.join(format!("{HELPER_FILENAME}.tmp")).exists());

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

    #[cfg(unix)]
    #[test]
    fn helper_install_does_not_follow_a_preexisting_temp_symlink() {
        use std::os::unix::fs::symlink;

        let root = temp_path("helper-symlink");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("bundled-helper");
        let runtime_root = root.join("runtime");
        let outside = root.join("outside");
        fs::write(&source, b"helper-v2").unwrap();
        fs::write(&outside, b"must-remain").unwrap();
        fs::create_dir_all(&runtime_root).unwrap();
        symlink(
            &outside,
            runtime_root.join(format!("{HELPER_FILENAME}.tmp")),
        )
        .unwrap();

        let installed = install_helper(&source, &runtime_root).unwrap();

        assert_eq!(fs::read(&outside).unwrap(), b"must-remain");
        assert_eq!(fs::read(&installed).unwrap(), b"helper-v2");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_private_descriptors_allow_only_the_owner() {
        assert_eq!(windows_private_acl_descriptor(true), "D:P(A;OICI;FA;;;OW)");
        assert_eq!(windows_private_acl_descriptor(false), "D:P(A;;FA;;;OW)");
    }
}
