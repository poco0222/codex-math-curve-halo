use codex_halo_lib::hook_protocol::is_snapshot_filename;
use codex_halo_lib::hooks::{self, get_hook_status, install_hooks, remove_hooks, HookStatus};
use codex_halo_lib::state::{reduce_snapshots, HaloState, Snapshot};
use serde_json::{json, Value};
use std::fs;
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
    std::env::temp_dir().join(format!("codex-halo-task7-{}-{nonce}", std::process::id()))
}

fn write_json(path: &Path, value: &Value) {
    fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

fn snapshots(state_dir: &Path) -> Vec<Snapshot> {
    let mut snapshots = fs::read_dir(state_dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_snapshot_filename(path))
        .map(|path| {
            let bytes = fs::read(path).unwrap();
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            let object = value.as_object().unwrap();
            assert_eq!(
                object.keys().collect::<Vec<_>>(),
                vec!["session_key", "state", "updated_at_ms"]
            );
            serde_json::from_value(value).unwrap()
        })
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

fn run_hook_with_input(helper: &Path, state_dir: &Path, session_id: &str, event: &str) {
    let input = json!({
        "session_id": session_id,
        "hook_event_name": event,
    });
    let mut child = Command::new(helper)
        .args(["--codex-halo", "--state-dir"])
        .arg(state_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|error| panic!("helper failed to start for {event}: {error}"));
    use std::io::Write;
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

fn helper_source() -> PathBuf {
    std::env::var_os("TASK7_HELPER")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_codex-halo-hook")))
}

fn display(state_dir: &Path, now_ms: i64) -> (HaloState, usize, i64) {
    let snapshots = snapshots(state_dir);
    let display = reduce_snapshots(&snapshots, now_ms);
    (display.state, display.session_count, display.updated_at_ms)
}

#[test]
fn task7_installs_twice_preserves_unrelated_hooks_and_reduces_helper_events() {
    let root = temp_root();
    let codex_home = root.join("codex-home");
    let app_data = root.join("app-data");
    let config = codex_home.join("hooks.json");
    let helper = app_data.join("codex-halo-hook");
    let state_dir = app_data.join("state");
    fs::create_dir_all(&codex_home).unwrap();
    fs::create_dir_all(&app_data).unwrap();
    let previous_codex_home = std::env::var_os("CODEX_HOME");
    std::env::set_var("CODEX_HOME", &codex_home);
    assert_eq!(hooks::codex_home().unwrap(), codex_home);
    fs::copy(helper_source(), &helper).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
    }

    let original = json!({
        "hooks": {
            "UserPromptSubmit": [{
                "hooks": [{
                    "type": "command",
                    "command": "python3 ./mine.py"
                }]
            }]
        }
    });
    write_json(&config, &original);
    let original_unrelated = original["hooks"]["UserPromptSubmit"].clone();

    install_hooks(&config, &helper, &state_dir).unwrap();
    let after_first: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    install_hooks(&config, &helper, &state_dir).unwrap();
    let after_second: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();

    assert_eq!(
        after_second["hooks"]["UserPromptSubmit"][0]["hooks"][0],
        original_unrelated[0]["hooks"][0]
    );
    assert_eq!(
        after_second["hooks"]["UserPromptSubmit"][0]["hooks"][0],
        after_first["hooks"]["UserPromptSubmit"][0]["hooks"][0]
    );

    for event in [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PermissionRequest",
        "PreCompact",
        "PostCompact",
        "Stop",
        "SessionEnd",
    ] {
        let command = after_second["hooks"][event]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|group| group["hooks"].as_array().into_iter().flatten())
            .find_map(|handler| {
                handler["command"]
                    .as_str()
                    .filter(|command| command.contains("--codex-halo"))
            })
            .unwrap();
        assert!(command.contains("--codex-halo"), "marker for {event}");
        assert!(
            command.contains(&helper.to_string_lossy().to_string()),
            "helper for {event}"
        );
        assert!(
            command.contains(&state_dir.to_string_lossy().to_string()),
            "state dir for {event}"
        );
    }

    assert_eq!(get_hook_status(&config, &helper), HookStatus::Installed);

    let session_a = "task7-session-a";
    for (event, expected) in EVENTS[..7].iter().copied() {
        run_hook_with_input(&helper, &state_dir, session_a, event);
        let (state, session_count, updated_at_ms) = display(&state_dir, now_ms());
        assert_eq!(state, expected, "state after {event}");
        assert_eq!(session_count, 1);
        assert!(updated_at_ms > 0 && updated_at_ms <= now_ms());
    }

    assert_eq!(get_hook_status(&config, &helper), HookStatus::Installed);
    run_hook_with_input(&helper, &state_dir, "task7-session-b", "SessionStart");
    run_hook_with_input(&helper, &state_dir, "task7-session-b", "UserPromptSubmit");
    let (state, session_count, updated_at_ms) = display(&state_dir, now_ms());
    assert_eq!(state, HaloState::Thinking);
    assert_eq!(session_count, 2);
    assert!(updated_at_ms > 0 && updated_at_ms <= now_ms());

    run_hook_with_input(&helper, &state_dir, "task7-session-b", "SessionEnd");
    let (state, session_count, updated_at_ms) = display(&state_dir, now_ms());
    assert_eq!(state, HaloState::Completed);
    assert_eq!(session_count, 1);
    assert!(updated_at_ms > 0 && updated_at_ms <= now_ms());

    run_hook_with_input(&helper, &state_dir, session_a, "SessionEnd");
    let (state, session_count, updated_at_ms) = display(&state_dir, now_ms());
    assert_eq!(state, HaloState::Idle);
    assert_eq!(session_count, 0);
    assert_eq!(updated_at_ms, 0);

    let removed = remove_hooks(&config).unwrap();
    assert!(removed.changed);
    let after_remove: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    assert_eq!(
        after_remove["hooks"]["UserPromptSubmit"][0]["hooks"][0],
        original_unrelated[0]["hooks"][0]
    );

    fs::remove_file(&helper).unwrap();
    fs::remove_dir_all(&state_dir).ok();
    assert_eq!(get_hook_status(&config, &helper), HookStatus::Missing);

    match previous_codex_home {
        Some(path) => std::env::set_var("CODEX_HOME", path),
        None => std::env::remove_var("CODEX_HOME"),
    }
    println!(
        "task7 metadata: platform={}-{} hook_file={}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        config.display()
    );
    fs::remove_dir_all(root).unwrap();
}
