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
            Self::ConfigMissing | Self::InvalidConfig | Self::Unsupported => None,
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

    loop {
        let config = match read_config(&config_path) {
            Ok(config) => config,
            Err(LifecycleError::ConfigMissing) => {
                stop_owned_child(&mut owned_child)?;
                return Ok(());
            }
            Err(error) => {
                report(&error);
                let _ = stop_owned_child(&mut owned_child);
                return Err(error);
            }
        };

        if !config.enabled {
            stop_owned_child(&mut owned_child)?;
            return Ok(());
        }

        reap_owned_child(&mut owned_child)?;
        let listing = match process_listing() {
            Ok(listing) => listing,
            Err(error) => {
                report(&error);
                let _ = stop_owned_child(&mut owned_child);
                return Err(error);
            }
        };
        let codex_active = codex_processes_present_from_listing(&listing);
        let halo_exists = listing
            .lines()
            .any(|line| process_name_matches(listing_process_name(line), &HALO_PROCESS_NAMES));

        if !codex_active {
            stop_owned_child(&mut owned_child)?;
        } else if should_spawn_halo(codex_active, halo_exists, owned_child.is_some()) {
            match Command::new(&config.halo_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
                Ok(child) => owned_child = Some(child),
                Err(error) => report(&LifecycleError::Spawn(error)),
            }
        }

        thread::sleep(POLL_INTERVAL);
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

fn stop_owned_child(child: &mut Option<Child>) -> Result<(), LifecycleError> {
    let Some(child_process) = child.as_mut() else {
        return Ok(());
    };

    match child_process.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => {
            if let Err(error) = child_process.kill() {
                if error.kind() != io::ErrorKind::NotFound {
                    return Err(LifecycleError::Child(error));
                }
            }
            child_process.wait().map_err(LifecycleError::Child)?;
        }
        Err(error) => return Err(LifecycleError::Child(error)),
    }
    *child = None;
    Ok(())
}

fn reap_owned_child(child: &mut Option<Child>) -> Result<(), LifecycleError> {
    let Some(child_process) = child.as_mut() else {
        return Ok(());
    };
    if child_process
        .try_wait()
        .map_err(LifecycleError::Child)?
        .is_some()
    {
        *child = None;
    }
    Ok(())
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
    eprintln!("Codex Halo watcher: {error}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::path::PathBuf;

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
    fn spawn_only_when_codex_is_active_and_no_halo_exists() {
        assert!(should_spawn_halo(true, false, false));
        assert!(!should_spawn_halo(false, false, false));
        assert!(!should_spawn_halo(true, true, false));
        assert!(!should_spawn_halo(true, false, true));
    }
}
