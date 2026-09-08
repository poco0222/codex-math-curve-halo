use codex_halo_lib::hook_protocol::is_snapshot_filename;
use codex_halo_lib::state::{reduce_snapshots, HaloState, Snapshot};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const EVENTS: [(&str, HaloState); 10] = [
    ("SessionStart", HaloState::Idle),
    ("UserPromptSubmit", HaloState::Thinking),
    ("PreToolUse", HaloState::Executing),
    ("PostToolUse", HaloState::Thinking),
    ("PermissionRequest", HaloState::InputNeeded),
    ("PreCompact", HaloState::Compacting),
    ("PostCompact", HaloState::Thinking),
    ("Interrupt", HaloState::Interrupted),
    ("Stop", HaloState::Completed),
    ("SessionEnd", HaloState::Idle),
];

fn temp_root() -> PathBuf {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "codex-halo-plugin-{}-{nonce}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
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

    for (event, expected) in EVENTS[..9].iter().copied() {
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

#[cfg(unix)]
fn run_packaged_hook(codex_home: &Path, input: Value) {
    let plugin_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/codex-halo");
    let manifest: Value =
        serde_json::from_slice(&fs::read(plugin_root.join("hooks/hooks.json")).unwrap()).unwrap();
    let event = input["hook_event_name"].as_str().unwrap();
    let command = manifest["hooks"][event][0]["hooks"][0]["command"]
        .as_str()
        .unwrap_or_else(|| panic!("plugin must register {event}"));
    let mut child = Command::new("sh")
        .args(["-c", command])
        .env("CODEX_HOME", codex_home)
        .env("PLUGIN_ROOT", &plugin_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, b"{}\n");
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(unix)]
#[test]
fn packaged_subagent_hooks_feed_one_family_and_remove_only_that_family() {
    let root = temp_root();
    let codex_home = root.join("codex home");
    let runtime = codex_home.join("codex-halo");
    let state_dir = runtime.join("state");
    fs::create_dir_all(&runtime).unwrap();
    fs::copy(helper_source(), runtime.join("codex-halo-hook")).unwrap();
    for (session_id, event, agent_id) in [
        ("private-parent", "UserPromptSubmit", None),
        ("private-other", "UserPromptSubmit", None),
        ("private-parent", "SubagentStart", Some("private-child-a")),
        ("private-parent", "SubagentStart", Some("private-child-b")),
        ("private-parent", "SubagentStart", Some("private-child-a")),
        ("private-parent", "Stop", None),
    ] {
        run_packaged_hook(
            &codex_home,
            json!({"session_id":session_id,
            "hook_event_name":event, "agent_id":agent_id, "prompt":"secret-prompt"}),
        );
    }
    let records = snapshots(&state_dir);
    assert_eq!(records.len(), 4);
    assert_eq!(
        reduce_snapshots(&records, now_ms() + 10_000).session_count,
        2
    );
    assert_eq!(
        reduce_snapshots(&records, now_ms() + 10_000).sessions.len(),
        4
    );
    let children = records
        .iter()
        .filter(|s| s.parent_session_key.is_some())
        .collect::<Vec<_>>();
    assert_eq!(children.len(), 2);
    assert_eq!(
        children[0].parent_session_key,
        children[1].parent_session_key
    );
    assert!(children.iter().all(|s| s.state == HaloState::Thinking));
    let parent_key = children[0].parent_session_key.as_ref().unwrap().clone();
    let serialized = serde_json::to_string(&records).unwrap();
    assert!(!serialized.contains("private-"));
    assert!(!serialized.contains("secret-prompt"));

    run_packaged_hook(
        &codex_home,
        json!({"session_id":"private-parent",
        "hook_event_name":"SubagentStop", "agent_id":"private-child-a"}),
    );
    let records = snapshots(&state_dir);
    assert_eq!(
        records
            .iter()
            .filter(|s| s.parent_session_key.is_some() && s.state == HaloState::Completed)
            .count(),
        1
    );
    let later = reduce_snapshots(&records, now_ms() + 3_001);
    assert_eq!(later.sessions.len(), 3);
    assert!(later
        .sessions
        .iter()
        .any(|s| s.session_key == parent_key && s.state == HaloState::Completed));

    run_packaged_hook(
        &codex_home,
        json!({"session_id":"private-parent", "hook_event_name":"SessionEnd"}),
    );
    let remaining = snapshots(&state_dir);
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].state, HaloState::Thinking);
    assert_ne!(remaining[0].session_key, parent_key);
    assert!(remaining[0].parent_session_key.is_none());
    assert!(!codex_home.join("hooks.json").exists());
    fs::remove_dir_all(root).unwrap();
}
