use serde::Deserialize;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const CODEX_PROCESS_NAMES: [&str; 4] = ["codex", "codex.exe", "chatgpt", "chatgpt.exe"];
const HALO_PROCESS_NAMES: [&str; 2] = ["codex-halo", "codex-halo.exe"];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(default)]
pub struct LifecycleConfig {
    pub enabled: bool,
    pub halo_path: PathBuf,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            halo_path: PathBuf::new(),
        }
    }
}

#[derive(Debug)]
pub enum LifecycleError {
    ConfigMissing,
    InvalidConfig,
    Json(serde_json::Error),
    ConfigIo(io::Error),
    ProcessList(io::Error),
    Child(io::Error),
    Spawn(io::Error),
    Cleanup {
        primary: Box<LifecycleError>,
        cleanup: Box<LifecycleError>,
    },
    Unsupported,
}

impl fmt::Display for LifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::ConfigMissing => "codex-lifecycle:config-missing",
            Self::InvalidConfig | Self::Json(_) => "codex-lifecycle:config",
            Self::ConfigIo(_) => "codex-lifecycle:config-io",
            Self::ProcessList(_) => "codex-lifecycle:process-list",
            Self::Child(_) => "codex-lifecycle:child",
            Self::Spawn(_) => "codex-lifecycle:spawn",
            Self::Cleanup { .. } => "codex-lifecycle:cleanup",
            Self::Unsupported => "codex-lifecycle:unsupported",
        })
    }
}

impl std::error::Error for LifecycleError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            Self::ConfigIo(error)
            | Self::ProcessList(error)
            | Self::Child(error)
            | Self::Spawn(error) => Some(error),
            Self::Cleanup { .. }
            | Self::ConfigMissing
            | Self::InvalidConfig
            | Self::Unsupported => None,
        }
    }
}

impl From<serde_json::Error> for LifecycleError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub fn parse_config(bytes: &[u8]) -> Result<LifecycleConfig, LifecycleError> {
    let config: LifecycleConfig = serde_json::from_slice(bytes)?;
    if config.halo_path.to_string_lossy().trim().is_empty() {
        return Err(LifecycleError::InvalidConfig);
    }
    Ok(config)
}

pub fn parse_config_path(args: impl IntoIterator<Item = std::ffi::OsString>) -> Option<PathBuf> {
    let mut args = args.into_iter();
    let marker = args.next()?;
    let path = args.next()?;
    if args.next().is_some() || marker != "--config" || path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

pub fn process_name_matches(value: &str, names: &[&str]) -> bool {
    let value = normalize_process_name(value);
    value.is_some_and(|value| {
        names
            .iter()
            .filter_map(|name| normalize_process_name(name))
            .any(|name| name == value)
    })
}

pub fn codex_processes_present_from_listing(listing: &str) -> bool {
    listing
        .lines()
        .any(|line| process_name_matches(listing_process_name(line), &CODEX_PROCESS_NAMES))
}

pub fn should_spawn_halo(codex_active: bool, halo_exists: bool, owned_child_exists: bool) -> bool {
    codex_active && !halo_exists && !owned_child_exists
}

pub fn run(config_path: PathBuf) -> Result<(), LifecycleError> {
    let mut owned_child = None;
    let result = finish_run(run_loop(&config_path, &mut owned_child), &mut owned_child);
    if let Err(error) = &result {
        report(error);
    }
    result
}

fn run_loop(config_path: &Path, owned_child: &mut Option<Child>) -> Result<(), LifecycleError> {
    loop {
        let config = match read_config(&config_path) {
            Ok(config) => config,
            Err(LifecycleError::ConfigMissing) => {
                stop_owned_child(owned_child)?;
                return Ok(());
            }
            Err(error) => {
                return Err(error);
            }
        };

        if !config.enabled {
            watch_iteration(false, "", owned_child, || spawn_halo(&config.halo_path))?;
            return Ok(());
        }

        let listing = process_listing()?;
        watch_iteration(true, &listing, owned_child, || {
            spawn_halo(&config.halo_path)
        })?;

        thread::sleep(POLL_INTERVAL);
    }
}

fn finish_run<C: ManagedChild>(
    result: Result<(), LifecycleError>,
    owned_child: &mut Option<C>,
) -> Result<(), LifecycleError> {
    let Err(primary) = result else {
        return Ok(());
    };

    match stop_owned_child(owned_child) {
        Ok(()) => Err(primary),
        Err(cleanup) => Err(LifecycleError::Cleanup {
            primary: Box::new(primary),
            cleanup: Box::new(cleanup),
        }),
    }
}

fn read_config(path: &Path) -> Result<LifecycleConfig, LifecycleError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(LifecycleError::ConfigMissing);
        }
        Err(error) => return Err(LifecycleError::ConfigIo(error)),
    };
    parse_config(&bytes)
}

trait ManagedChild {
    fn has_exited(&mut self) -> io::Result<bool>;
    fn stop(&mut self) -> io::Result<()>;
}

impl ManagedChild for Child {
    fn has_exited(&mut self) -> io::Result<bool> {
        Ok(self.try_wait()?.is_some())
    }

    fn stop(&mut self) -> io::Result<()> {
        if self.has_exited()? {
            return Ok(());
        }
        if let Err(error) = self.kill() {
            if error.kind() != io::ErrorKind::NotFound {
                return Err(error);
            }
        }
        self.wait().map(|_| ())
    }
}

fn stop_owned_child<C: ManagedChild>(child: &mut Option<C>) -> Result<(), LifecycleError> {
    let Some(child_process) = child.as_mut() else {
        return Ok(());
    };

    child_process.stop().map_err(LifecycleError::Child)?;
    *child = None;
    Ok(())
}

fn reap_owned_child<C: ManagedChild>(child: &mut Option<C>) -> Result<(), LifecycleError> {
    let Some(child_process) = child.as_mut() else {
        return Ok(());
    };
    if child_process.has_exited().map_err(LifecycleError::Child)? {
        *child = None;
    }
    Ok(())
}

fn watch_iteration<C, F>(
    enabled: bool,
    listing: &str,
    owned_child: &mut Option<C>,
    mut spawn: F,
) -> Result<(), LifecycleError>
where
    C: ManagedChild,
    F: FnMut() -> Result<C, LifecycleError>,
{
    if !enabled {
        stop_owned_child(owned_child)?;
        return Ok(());
    }

    reap_owned_child(owned_child)?;
    let codex_active = codex_processes_present_from_listing(listing);
    let halo_exists = listing
        .lines()
        .any(|line| process_name_matches(listing_process_name(line), &HALO_PROCESS_NAMES));

    if !codex_active {
        stop_owned_child(owned_child)?;
    } else if should_spawn_halo(codex_active, halo_exists, owned_child.is_some()) {
        match spawn() {
            Ok(child) => *owned_child = Some(child),
            Err(error) => report(&error),
        }
    }
    Ok(())
}

fn spawn_halo(path: &Path) -> Result<Child, LifecycleError> {
    Command::new(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(LifecycleError::Spawn)
}

fn normalize_process_name(value: &str) -> Option<String> {
    let basename = value
        .trim()
        .rsplit(|character| character == '/' || character == '\\')
        .next()?;
    let mut name = basename.trim().to_ascii_lowercase();
    if name.ends_with(".exe") {
        name.truncate(name.len() - 4);
    }
    (!name.is_empty()).then_some(name)
}

fn listing_process_name(line: &str) -> &str {
    let line = line.trim();
    if let Some(line) = line.strip_prefix('"') {
        return line.split_once("\",").map_or(line, |(name, _)| name);
    }
    line
}

#[cfg(target_os = "macos")]
fn process_listing() -> Result<String, LifecycleError> {
    let output = Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .map_err(LifecycleError::ProcessList)?;
    if !output.status.success() {
        return Err(LifecycleError::ProcessList(io::Error::new(
            io::ErrorKind::Other,
            "process list command failed",
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn process_listing() -> Result<String, LifecycleError> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map_err(LifecycleError::ProcessList)?;
    if !output.status.success() {
        return Err(LifecycleError::ProcessList(io::Error::new(
            io::ErrorKind::Other,
            "process list command failed",
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn process_listing() -> Result<String, LifecycleError> {
    Err(LifecycleError::Unsupported)
}

fn report(error: &LifecycleError) {
    if let LifecycleError::Cleanup { primary, cleanup } = error {
        report(primary);
        report(cleanup);
    } else {
        eprintln!("Codex Halo watcher: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::ffi::OsString;
    use std::io;
    use std::path::PathBuf;
    use std::rc::Rc;

    #[test]
    fn missing_enabled_field_defaults_to_disabled() {
        let config = parse_config(br#"{"halo_path":"/tmp/codex-halo"}"#).unwrap();
        assert!(!config.enabled);
    }

    #[test]
    fn config_requires_an_object_and_nonempty_halo_path() {
        assert!(parse_config(br#"[]"#).is_err());
        assert!(parse_config(br#"{"enabled":true}"#).is_err());
        assert!(parse_config(br#"{"halo_path":"  "}"#).is_err());
    }

    #[test]
    fn watcher_accepts_only_config_pair() {
        let path = PathBuf::from("/tmp/lifecycle.json");
        assert_eq!(
            parse_config_path(["--config", "/tmp/lifecycle.json"].map(OsString::from)),
            Some(path)
        );
        assert_eq!(parse_config_path(["--config"].map(OsString::from)), None);
        assert_eq!(
            parse_config_path(["--other", "/tmp/lifecycle.json"].map(OsString::from)),
            None
        );
    }

    #[test]
    fn process_matching_is_exact_and_case_insensitive() {
        assert!(process_name_matches(
            "/Applications/Codex.app/Contents/MacOS/Codex",
            &["codex"]
        ));
        assert!(process_name_matches("CHATGPT.EXE", &["chatgpt.exe"]));
        assert!(process_name_matches(
            r#"C:\\Program Files\\Codex\\Codex.exe"#,
            &["codex"]
        ));
        assert!(!process_name_matches(
            "codex-halo-watch",
            &["codex", "codex.exe"]
        ));
    }

    #[test]
    fn process_listing_requires_a_codex_name() {
        assert!(codex_processes_present_from_listing("/usr/bin/codex\n"));
        assert!(codex_processes_present_from_listing("ChatGPT\n"));
        assert!(!codex_processes_present_from_listing(
            "codex-halo\ncodex-halo-watch\n"
        ));
    }

    #[test]
    fn windows_csv_listing_uses_only_the_process_name_column() {
        assert!(codex_processes_present_from_listing(
            "\"ChatGPT.exe\",\"123\",\"Console\",\"1\",\"12,345 K\"\n"
        ));
        assert!(!codex_processes_present_from_listing(
            "\"other.exe\",\"123\",\"Console\",\"1\",\"codex\"\n"
        ));
        assert!(!codex_processes_present_from_listing(
            "\"codex-halo.exe\",\"123\",\"Console\",\"1\",\"12,345 K\"\n"
        ));
    }

    struct FakeChild {
        exited: bool,
        fail_stop: bool,
        events: Rc<RefCell<Vec<&'static str>>>,
    }

    impl ManagedChild for FakeChild {
        fn has_exited(&mut self) -> io::Result<bool> {
            self.events.borrow_mut().push("try_wait");
            Ok(self.exited)
        }

        fn stop(&mut self) -> io::Result<()> {
            self.events.borrow_mut().push("stop");
            if self.fail_stop {
                return Err(io::Error::new(io::ErrorKind::Other, "private child detail"));
            }
            self.exited = true;
            Ok(())
        }
    }

    #[test]
    fn watcher_loop_harness_spawns_restarts_and_stops_owned_child() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let config = LifecycleConfig {
            enabled: true,
            halo_path: PathBuf::from("test-halo"),
        };
        let frames = [
            ("codex\n", false),
            ("codex\n", false),
            ("codex\n", true),
            ("codex\ncodex-halo\n", false),
            ("codex-halo\ncodex-halo-watch\n", false),
        ];
        let mut child: Option<FakeChild> = None;
        let mut spawn_count = 0;

        for (listing, exited_before) in frames {
            if let Some(child) = child.as_mut() {
                child.exited = exited_before;
            }
            let event_log = events.clone();
            watch_iteration(config.enabled, listing, &mut child, || {
                spawn_count += 1;
                event_log.borrow_mut().push("spawn");
                Ok(FakeChild {
                    exited: false,
                    fail_stop: false,
                    events: event_log.clone(),
                })
            })
            .unwrap();
        }

        assert_eq!(spawn_count, 2);
        assert!(child.is_none());
        assert_eq!(
            events.borrow().as_slice(),
            ["spawn", "try_wait", "try_wait", "spawn", "try_wait", "try_wait", "stop"]
        );
    }

    #[test]
    fn run_error_preserves_cleanup_failure_as_a_fixed_category() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let mut child = Some(FakeChild {
            exited: false,
            fail_stop: true,
            events,
        });
        let result = finish_run(
            Err(LifecycleError::ProcessList(io::Error::new(
                io::ErrorKind::Other,
                "private process detail",
            ))),
            &mut child,
        )
        .unwrap_err();

        assert!(matches!(result, LifecycleError::Cleanup { .. }));
        assert_eq!(result.to_string(), "codex-lifecycle:cleanup");
        assert!(child.is_some());
    }

    #[test]
    fn cleanup_error_display_is_a_fixed_category() {
        let error = LifecycleError::Cleanup {
            primary: Box::new(LifecycleError::ProcessList(io::Error::new(
                io::ErrorKind::Other,
                "private process detail",
            ))),
            cleanup: Box::new(LifecycleError::Child(io::Error::new(
                io::ErrorKind::Other,
                "private child detail",
            ))),
        };

        assert_eq!(error.to_string(), "codex-lifecycle:cleanup");
        assert!(!error.to_string().contains("private"));
    }

    #[test]
    fn spawn_only_when_codex_is_active_and_no_halo_exists() {
        assert!(should_spawn_halo(true, false, false));
        assert!(!should_spawn_halo(false, false, false));
        assert!(!should_spawn_halo(true, true, false));
        assert!(!should_spawn_halo(true, false, true));
    }
}
