use codex_halo_lib::hook_protocol::{
    map_event, parse_hook_input, remove_snapshot, write_snapshot, HookAction,
};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    run(
        std::env::args_os().skip(1),
        std::io::stdin().lock(),
        std::io::stdout().lock(),
        std::io::stderr().lock(),
    );
}

fn run(
    args: impl IntoIterator<Item = OsString>,
    mut stdin: impl Read,
    mut stdout: impl Write,
    mut stderr: impl Write,
) {
    let Some(state_dir) = parse_state_dir(args) else {
        let _ = writeln!(stderr, "Codex Halo hook: invalid arguments");
        let _ = writeln!(stdout, "{{}}");
        return;
    };

    let mut bytes = Vec::new();
    if stdin.read_to_end(&mut bytes).is_err() {
        let _ = writeln!(stderr, "Codex Halo hook: input read failed");
        let _ = writeln!(stdout, "{{}}");
        return;
    }

    match parse_hook_input(&bytes) {
        Ok(input) => match map_event(&input) {
            Some(HookAction::Set(state)) => {
                if write_snapshot(&state_dir, &input, state, now_ms()).is_err() {
                    let _ = writeln!(stderr, "Codex Halo hook: state update failed");
                }
            }
            Some(HookAction::Remove) => {
                if remove_snapshot(&state_dir, &input).is_err() {
                    let _ = writeln!(stderr, "Codex Halo hook: state removal failed");
                }
            }
            None => {
                let _ = writeln!(stderr, "Codex Halo hook: unknown event ignored");
            }
        },
        Err(_) => {
            let _ = writeln!(stderr, "Codex Halo hook: invalid input ignored");
        }
    }

    let _ = writeln!(stdout, "{{}}");
}

fn parse_state_dir(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let mut args = args.into_iter();
    let mut state_dir = None;
    let mut marker_seen = false;

    while let Some(arg) = args.next() {
        if arg == "--codex-halo" && !marker_seen {
            marker_seen = true;
            continue;
        }
        if arg == "--state-dir" && state_dir.is_none() {
            let value = args.next()?;
            if value.to_str().is_some_and(|value| value.starts_with('-')) {
                return None;
            }
            state_dir = Some(PathBuf::from(value));
            continue;
        }
        return None;
    }

    state_dir
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "codex-halo-cli-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn stop_writes_a_snapshot_and_predictable_stdout() {
        let state_dir = temp_path("stop");
        let input = br#"{
            "session_id":"thr_test",
            "hook_event_name":"Stop",
            "prompt":"must not leak",
            "tool_name":"Bash"
        }"#;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        run(
            [
                "--codex-halo".into(),
                "--state-dir".into(),
                state_dir.clone().into_os_string(),
            ],
            input.as_slice(),
            &mut stdout,
            &mut stderr,
        );

        assert_eq!(stdout, b"{}\n");
        assert!(stderr.is_empty());
        let path = fs::read_dir(&state_dir)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let contents = fs::read_to_string(path).unwrap();
        assert!(contents.contains(r#""state":"completed""#));
        assert!(!contents.contains("thr_test"));
        assert!(!contents.contains("must not leak"));
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn malformed_and_unknown_input_are_redacted_best_effort_noops() {
        for input in [
            br#"{"session_id":"private-id","prompt":"secret"}"#.as_slice(),
            br#"{"session_id":"private-id","hook_event_name":"Unknown","prompt":"secret"}"#,
        ] {
            let state_dir = temp_path("noop");
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();

            run(
                ["--state-dir".into(), state_dir.clone().into_os_string()],
                input,
                &mut stdout,
                &mut stderr,
            );

            assert_eq!(stdout, b"{}\n");
            assert!(!stderr.is_empty());
            assert!(!String::from_utf8(stderr).unwrap().contains("secret"));
            assert!(!state_dir.exists());
        }
    }

    #[test]
    fn session_end_removes_the_matching_snapshot() {
        let state_dir = temp_path("end");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        run(
            ["--state-dir".into(), state_dir.clone().into_os_string()],
            br#"{"session_id":"thr_test","hook_event_name":"Stop"}"#.as_slice(),
            &mut stdout,
            &mut stderr,
        );
        assert_eq!(fs::read_dir(&state_dir).unwrap().count(), 1);

        stdout.clear();
        run(
            ["--state-dir".into(), state_dir.clone().into_os_string()],
            br#"{"session_id":"thr_test","hook_event_name":"SessionEnd"}"#.as_slice(),
            &mut stdout,
            &mut stderr,
        );

        assert_eq!(stdout, b"{}\n");
        assert!(stderr.is_empty());
        assert_eq!(fs::read_dir(&state_dir).unwrap().count(), 0);
        fs::remove_dir_all(state_dir).unwrap();
    }

    #[test]
    fn rejects_ambiguous_or_unknown_command_line_arguments() {
        let cases = [
            vec!["--state-dir".into(), "--codex-halo".into()],
            vec![
                "--state-dir".into(),
                "/tmp/state".into(),
                "--state-dir".into(),
                "/tmp/other".into(),
            ],
            vec![
                "--state-dir".into(),
                "/tmp/state".into(),
                "--unknown".into(),
            ],
            vec!["--codex-halo".into()],
            vec![
                "--codex-halo".into(),
                "--codex-halo".into(),
                "--state-dir".into(),
                "/tmp/state".into(),
            ],
            Vec::new(),
        ];

        for args in cases {
            assert!(parse_state_dir(args).is_none());
        }
    }

    #[test]
    fn invalid_arguments_are_exit_zero_no_side_effects() {
        let state_dir = temp_path("invalid-args");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        run(
            ["--state-dir".into(), "--codex-halo".into()],
            br#"{"session_id":"private-id","prompt":"secret"}"#.as_slice(),
            &mut stdout,
            &mut stderr,
        );

        assert_eq!(stdout, b"{}\n");
        assert!(!String::from_utf8(stderr).unwrap().contains("secret"));
        assert!(!state_dir.exists());
    }
}
