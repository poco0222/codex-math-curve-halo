use crate::platform;
use serde::Deserialize;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
pub(crate) const CODEX_PROCESS_NAMES: [&str; 4] = ["codex", "codex.exe", "chatgpt", "chatgpt.exe"];
pub(crate) const HALO_PROCESS_NAMES: [&str; 2] = ["codex-halo", "codex-halo.exe"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProcessPresence {
    codex_active: bool,
    halo_exists: bool,
}

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
    process_present_from_listing(listing, &CODEX_PROCESS_NAMES)
}

pub(crate) fn process_present_from_listing(listing: &str, names: &[&str]) -> bool {
    listing
        .lines()
        .any(|line| process_name_matches(listing_process_name(line), names))
}

pub fn should_spawn_halo(codex_active: bool, halo_exists: bool, owned_child_exists: bool) -> bool {
    codex_active && !halo_exists && !owned_child_exists
}

pub fn run(config_path: PathBuf) -> Result<(), LifecycleError> {
    let mut owned_child = None;
    run_with(
        &config_path,
        &mut owned_child,
        read_config,
        process_listing,
        || thread::sleep(POLL_INTERVAL),
        |_| false,
        spawn_halo,
        report,
    )
}

fn run_with<C, RC, PL, SL, ST, SP, RP>(
    config_path: &Path,
    owned_child: &mut Option<C>,
    mut read_config: RC,
    mut process_listing: PL,
    mut sleep: SL,
    mut should_stop: ST,
    mut spawn: SP,
    mut report_error: RP,
) -> Result<(), LifecycleError>
where
    C: ManagedChild,
    RC: FnMut(&Path) -> Result<LifecycleConfig, LifecycleError>,
    PL: FnMut() -> Result<ProcessPresence, LifecycleError>,
    SL: FnMut(),
    ST: FnMut(usize) -> bool,
    SP: FnMut(&Path) -> Result<C, LifecycleError>,
    RP: FnMut(&LifecycleError),
{
    let result = run_loop(
        config_path,
        owned_child,
        &mut read_config,
        &mut process_listing,
        &mut sleep,
        &mut should_stop,
        &mut spawn,
    );
    let result = finish_run(result, owned_child);
    if let Err(error) = &result {
        report_error(error);
    }
    result
}

fn run_loop<C, RC, PL, SL, ST, SP>(
    config_path: &Path,
    owned_child: &mut Option<C>,
    read_config: &mut RC,
    process_listing: &mut PL,
    sleep: &mut SL,
    should_stop: &mut ST,
    spawn: &mut SP,
) -> Result<(), LifecycleError>
where
    C: ManagedChild,
    RC: FnMut(&Path) -> Result<LifecycleConfig, LifecycleError>,
    PL: FnMut() -> Result<ProcessPresence, LifecycleError>,
    SL: FnMut(),
    ST: FnMut(usize) -> bool,
    SP: FnMut(&Path) -> Result<C, LifecycleError>,
{
    let mut iteration = 0;

    loop {
        let config = match read_config(config_path) {
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
            watch_iteration(
                false,
                ProcessPresence {
                    codex_active: false,
                    halo_exists: false,
                },
                owned_child,
                || spawn(&config.halo_path),
            )?;
            return Ok(());
        }

        let processes = process_listing()?;
        watch_iteration(true, processes, owned_child, || spawn(&config.halo_path))?;

        iteration += 1;
        sleep();
        if should_stop(iteration) {
            return Ok(());
        }
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
    processes: ProcessPresence,
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
    let codex_active = processes.codex_active;
    let halo_exists = processes.halo_exists;

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

fn process_list_error(error: io::Error) -> LifecycleError {
    if error.kind() == io::ErrorKind::Unsupported {
        LifecycleError::Unsupported
    } else {
        LifecycleError::ProcessList(error)
    }
}

fn process_listing() -> Result<ProcessPresence, LifecycleError> {
    process_listing_with(platform::process_listing)
}

fn process_listing_with<F>(mut listing: F) -> Result<ProcessPresence, LifecycleError>
where
    F: FnMut() -> io::Result<String>,
{
    let listing = listing().map_err(process_list_error)?;
    Ok(ProcessPresence {
        codex_active: process_present_from_listing(&listing, &CODEX_PROCESS_NAMES),
        halo_exists: process_present_from_listing(&listing, &HALO_PROCESS_NAMES),
    })
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
    use std::cell::{Cell, RefCell};
    #[cfg(target_os = "macos")]
    use std::env;
    use std::ffi::OsString;
    #[cfg(target_os = "macos")]
    use std::fs;
    use std::io;
    #[cfg(target_os = "macos")]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::rc::Rc;
    #[cfg(target_os = "macos")]
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[cfg(target_os = "macos")]
    #[test]
    fn process_listing_reads_one_snapshot_for_both_process_checks() {
        let _lock = crate::platform::PROCESS_COMMAND_ENV_LOCK.lock().unwrap();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = env::temp_dir().join(format!("codex-halo-ps-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let counter = directory.join("count");
        let ps = directory.join("ps");
        fs::write(
            &ps,
            format!(
                "#!/bin/sh\ncount=0\nif [ -f '{}' ]; then count=$(cat '{}'); fi\nprintf '%s' $((count + 1)) > '{}'\nprintf 'codex\\ncodex-halo\\n'\n",
                counter.display(),
                counter.display(),
                counter.display(),
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&ps).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&ps, permissions).unwrap();

        let previous_path = env::var_os("PATH");
        let path = previous_path.as_ref().map_or_else(
            || directory.display().to_string(),
            |value| format!("{}:{}", directory.display(), value.to_string_lossy()),
        );
        env::set_var("PATH", path);
        let processes = process_listing().unwrap();
        match previous_path {
            Some(value) => env::set_var("PATH", value),
            None => env::remove_var("PATH"),
        }

        assert_eq!(
            processes,
            ProcessPresence {
                codex_active: true,
                halo_exists: true
            }
        );
        assert_eq!(fs::read_to_string(counter).unwrap(), "1");
        fs::remove_dir_all(directory).unwrap();
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
        shared_exited: Option<Rc<Cell<bool>>>,
        fail_stop: bool,
        events: Rc<RefCell<Vec<&'static str>>>,
    }

    impl ManagedChild for FakeChild {
        fn has_exited(&mut self) -> io::Result<bool> {
            self.events.borrow_mut().push("try_wait");
            Ok(self
                .shared_exited
                .as_ref()
                .map_or(self.exited, |exited| exited.get()))
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
            let processes = ProcessPresence {
                codex_active: codex_processes_present_from_listing(listing),
                halo_exists: process_present_from_listing(listing, &HALO_PROCESS_NAMES),
            };
            watch_iteration(config.enabled, processes, &mut child, || {
                spawn_count += 1;
                event_log.borrow_mut().push("spawn");
                Ok(FakeChild {
                    exited: false,
                    shared_exited: None,
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
    fn loop_runner_harness_wires_config_listing_sleep_and_child_lifecycle() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let child_exited = Rc::new(Cell::new(false));
        let config_reads = Cell::new(0);
        let listing_reads = Cell::new(0);
        let sleep_calls = Cell::new(0);
        let spawn_count = Cell::new(0);
        let config = LifecycleConfig {
            enabled: true,
            halo_path: PathBuf::from("test-halo"),
        };
        let mut child: Option<FakeChild> = None;

        let result = run_with(
            Path::new("lifecycle.json"),
            &mut child,
            |path| {
                assert_eq!(path, Path::new("lifecycle.json"));
                config_reads.set(config_reads.get() + 1);
                Ok(config.clone())
            },
            || {
                let read = listing_reads.get();
                listing_reads.set(read + 1);
                if read == 0 {
                    child_exited.set(false);
                    Ok(ProcessPresence {
                        codex_active: true,
                        halo_exists: false,
                    })
                } else if read == 1 {
                    child_exited.set(true);
                    Ok(ProcessPresence {
                        codex_active: true,
                        halo_exists: false,
                    })
                } else {
                    child_exited.set(false);
                    Ok(ProcessPresence {
                        codex_active: false,
                        halo_exists: false,
                    })
                }
            },
            || sleep_calls.set(sleep_calls.get() + 1),
            |iteration| iteration == 3,
            |path| {
                assert_eq!(path, Path::new("test-halo"));
                spawn_count.set(spawn_count.get() + 1);
                events.borrow_mut().push("spawn");
                Ok(FakeChild {
                    exited: false,
                    shared_exited: Some(child_exited.clone()),
                    fail_stop: false,
                    events: events.clone(),
                })
            },
            |_| {},
        );

        assert!(result.is_ok());
        assert_eq!(config_reads.get(), 3);
        assert_eq!(listing_reads.get(), 3);
        assert_eq!(sleep_calls.get(), 3);
        assert_eq!(spawn_count.get(), 2);
        assert!(child.is_none());
        assert_eq!(
            events.borrow().as_slice(),
            ["spawn", "try_wait", "spawn", "try_wait", "stop"]
        );
    }

    #[test]
    fn loop_runner_reports_process_error_after_cleanup() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let reports = Rc::new(RefCell::new(Vec::new()));
        let mut child = Some(FakeChild {
            exited: false,
            shared_exited: None,
            fail_stop: false,
            events: events.clone(),
        });
        let report_log = reports.clone();

        let result = run_with(
            Path::new("lifecycle.json"),
            &mut child,
            |_| {
                Ok(LifecycleConfig {
                    enabled: true,
                    halo_path: PathBuf::from("test-halo"),
                })
            },
            || {
                Err(LifecycleError::ProcessList(io::Error::new(
                    io::ErrorKind::Other,
                    "private process detail",
                )))
            },
            || panic!("sleep must not run after an error"),
            |_| false,
            |_| panic!("spawn must not run before a listing"),
            move |error| report_log.borrow_mut().push(error.to_string()),
        );

        assert_eq!(
            result.unwrap_err().to_string(),
            "codex-lifecycle:process-list"
        );
        assert!(child.is_none());
        assert_eq!(
            reports.borrow().as_slice(),
            ["codex-lifecycle:process-list"]
        );
        assert_eq!(events.borrow().as_slice(), ["stop"]);
    }

    #[test]
    fn run_error_preserves_cleanup_failure_as_a_fixed_category() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let mut child = Some(FakeChild {
            exited: false,
            shared_exited: None,
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
