use codex_halo_lib::hook_protocol::is_snapshot_filename;
use codex_halo_lib::state::{reduce_snapshots, HaloState, Snapshot};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const EVENTS: [(&str, HaloState); 8] = [
    ("SessionStart", HaloState::Idle),
    ("UserPromptSubmit", HaloState::Thinking),
    ("PreToolUse", HaloState::Executing),
    ("PermissionRequest", HaloState::InputNeeded),
    ("PreCompact", HaloState::Compacting),
    ("PostCompact", HaloState::Thinking),
    ("Stop", HaloState::Completed),
    ("SessionEnd", HaloState::Idle),
];

fn temp_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("codex-halo-plugin-{nonce}"))
}

fn snapshots(state_dir: &Path) -> Vec<Snapshot> {
    let mut snapshots = fs::read_dir(state_dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_snapshot_filename(path))
        .map(|path| serde_json::from_slice(&fs::read(path).unwrap()).unwrap())
        .collect::<Vec<Snapshot>>();
    snapshots.sort_by(|left, right| left.session_key.cmp(&right.session_key));
    snapshots
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn helper_source() -> PathBuf {
    std::env::var_os("TASK7_HELPER")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_codex-halo-hook")))
}

fn run_plugin_hook(helper: &Path, codex_home: &Path, session_id: &str, event: &str) {
    let input = json!({
        "session_id": session_id,
        "hook_event_name": event,
    });
    let mut child = Command::new(helper)
        .args(["--codex-halo"])
        .env("CODEX_HOME", codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("helper failed to start for {event}: {error}"));
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "helper failed for {event}");
    assert_eq!(output.stdout, b"{}\n", "helper stdout for {event}");
    assert!(output.stderr.is_empty(), "helper stderr for {event}");
}

#[test]
fn plugin_helper_updates_only_the_runtime_state_directory() {
    let root = temp_root();
    let codex_home = root.join("codex-home");
    let state_dir = codex_home.join("codex-halo/state");
    let helper = helper_source();
    fs::create_dir_all(&codex_home).unwrap();

    for (event, expected) in EVENTS[..7].iter().copied() {
        run_plugin_hook(&helper, &codex_home, "plugin-session", event);
        let snapshots = snapshots(&state_dir);
        let display = reduce_snapshots(&snapshots, now_ms());
        assert_eq!(display.state, expected, "state after {event}");
        assert_eq!(display.session_count, 1, "session count after {event}");
    }

    run_plugin_hook(&helper, &codex_home, "plugin-session", "SessionEnd");
    assert!(!state_dir.join("missing").exists());
    assert!(snapshots(&state_dir).is_empty());
    assert!(!codex_home.join("hooks.json").exists());

    let state_files = fs::read_dir(&state_dir).unwrap().collect::<Vec<_>>();
    assert!(state_files.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn plugin_helper_keeps_snapshot_payload_content_free() {
    let root = temp_root();
    let codex_home = root.join("codex-home");
    let state_dir = codex_home.join("codex-halo/state");
    fs::create_dir_all(&codex_home).unwrap();

    let input = json!({
        "session_id": "private-id",
        "hook_event_name": "Stop",
        "prompt": "secret",
        "transcript": "secret",
        "model": "private-model",
    });
    let mut child = Command::new(helper_source())
        .args(["--codex-halo"])
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    assert!(child.wait_with_output().unwrap().status.success());

    let snapshot_path = fs::read_dir(&state_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let snapshot: Value = serde_json::from_slice(&fs::read(snapshot_path).unwrap()).unwrap();
    assert_eq!(
        snapshot.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["session_key", "state", "updated_at_ms"]
    );
    fs::remove_dir_all(root).unwrap();
}
