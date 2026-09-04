use crate::hooks;
use serde::Deserialize;
use std::env;
use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

pub const MARKETPLACE_NAME: &str = "codex-halo";
pub const PLUGIN_ID: &str = "codex-halo@codex-halo";
const LEGACY_PLUGIN_ID: &str = "codex-halo@personal";
pub const RESOURCE_ROOT: &str = "codex-halo-marketplace";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(50);
static OPERATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Step {
    AddMarketplace,
    AddPlugin,
    ListMarketplaces,
    RemovePlugin,
    RemoveMarketplace,
}

impl Step {
    fn error(self) -> PluginError {
        match self {
            Self::AddMarketplace => PluginError::MarketplaceInstall,
            Self::AddPlugin => PluginError::PluginInstall,
            Self::ListMarketplaces => PluginError::MarketplaceQuery,
            Self::RemovePlugin => PluginError::PluginRemove,
            Self::RemoveMarketplace => PluginError::MarketplaceRemove,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::AddMarketplace => "marketplace registration",
            Self::AddPlugin => "plugin installation",
            Self::ListMarketplaces => "marketplace inspection",
            Self::RemovePlugin => "plugin removal",
            Self::RemoveMarketplace => "marketplace removal",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PluginError {
    CodexUnavailable,
    CodexTimeout,
    MarketplaceInstall,
    MarketplaceQuery,
    MarketplaceConflict,
    MarketplaceNotOwned,
    PluginInstall,
    LegacyCleanup,
    PartialInstall,
    PluginRemove,
    PartialUninstall,
    MarketplaceRemove,
}

impl fmt::Display for PluginError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::CodexUnavailable => "Codex CLI is unavailable",
            Self::CodexTimeout => "Codex CLI timed out",
            Self::MarketplaceInstall => "Codex marketplace could not be registered",
            Self::MarketplaceQuery => "Codex marketplace could not be inspected",
            Self::MarketplaceConflict => {
                "A different Codex marketplace already uses the Codex Halo name"
            }
            Self::MarketplaceNotOwned => "Codex Halo marketplace is not owned by this app",
            Self::PluginInstall => "Codex Halo Plugin could not be installed",
            Self::LegacyCleanup => "Codex Halo legacy hooks could not be migrated",
            Self::PartialInstall => "Codex Halo Plugin installation is incomplete",
            Self::PluginRemove => "Codex Halo Plugin could not be uninstalled",
            Self::PartialUninstall => "Codex Halo Plugin uninstall is incomplete",
            Self::MarketplaceRemove => "Codex marketplace could not be removed",
        })
    }
}

impl std::error::Error for PluginError {}

pub fn install(marketplace_root: &Path) -> Result<(), PluginError> {
    // ponytail: one global lock is enough for user-triggered CLI mutations.
    let _guard = OPERATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let marketplace_state = inspect_marketplace(marketplace_root)?;
    if marketplace_state == MarketplaceState::Conflict {
        return Err(PluginError::MarketplaceConflict);
    }

    hooks::cleanup_legacy_entries().map_err(|_| PluginError::LegacyCleanup)?;
    let [marketplace_args, plugin_args] = install_args(marketplace_root);
    let marketplace_added = if marketplace_state == MarketplaceState::Missing {
        run_step(Step::AddMarketplace, &marketplace_args)?;
        true
    } else {
        false
    };

    if let Err(error) = run_step(Step::AddPlugin, &plugin_args) {
        if marketplace_added {
            let rollback_args = uninstall_args();
            if run_step(Step::RemoveMarketplace, &rollback_args[2]).is_err() {
                return Err(PluginError::PartialInstall);
            }
        }
        return Err(error);
    }
    Ok(())
}

pub fn uninstall(marketplace_root: &Path) -> Result<(), PluginError> {
    let _guard = OPERATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match inspect_marketplace(marketplace_root)? {
        MarketplaceState::Conflict => return Err(PluginError::MarketplaceNotOwned),
        MarketplaceState::Missing | MarketplaceState::Owned => {}
    }
    let [plugin_args, legacy_plugin_args, marketplace_args] = uninstall_args();
    let plugin_result = run_step(Step::RemovePlugin, &plugin_args);
    let legacy_plugin_result = run_step(Step::RemovePlugin, &legacy_plugin_args);
    let marketplace_result = run_step(Step::RemoveMarketplace, &marketplace_args);
    let plugin_error = [plugin_result, legacy_plugin_result]
        .into_iter()
        .find_map(Result::err);
    match (plugin_error, marketplace_result) {
        (None, result) => result,
        (Some(error), Ok(())) => Err(error),
        (Some(_), Err(_)) => Err(PluginError::PartialUninstall),
    }
}

#[derive(Debug, Deserialize)]
struct MarketplaceList {
    marketplaces: Vec<Marketplace>,
}

#[derive(Debug, Deserialize)]
struct Marketplace {
    name: String,
    root: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MarketplaceState {
    Missing,
    Owned,
    Conflict,
}

fn inspect_marketplace(expected_root: &Path) -> Result<MarketplaceState, PluginError> {
    let args = ["plugin", "marketplace", "list", "--json"]
        .into_iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let output = run_codex(&args)?;
    if !output.status.success() {
        eprintln!("Codex Halo: {} failed", Step::ListMarketplaces.label());
        return Err(Step::ListMarketplaces.error());
    }
    let list = serde_json::from_slice::<MarketplaceList>(&output.stdout)
        .map_err(|_| PluginError::MarketplaceQuery)?;
    Ok(marketplace_state(list, expected_root))
}

fn marketplace_state(list: MarketplaceList, expected_root: &Path) -> MarketplaceState {
    let mut found = false;
    for marketplace in list.marketplaces {
        if marketplace.name != MARKETPLACE_NAME {
            continue;
        }
        found = true;
        if same_path(&marketplace.root, expected_root) {
            return MarketplaceState::Owned;
        }
    }
    if found {
        MarketplaceState::Conflict
    } else {
        MarketplaceState::Missing
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left)
        .ok()
        .zip(fs::canonicalize(right).ok())
        .is_some_and(|(left, right)| left == right)
}

fn install_args(marketplace_root: &Path) -> [Vec<OsString>; 2] {
    [
        vec![
            "plugin".into(),
            "marketplace".into(),
            "add".into(),
            marketplace_root.as_os_str().to_owned(),
            "--json".into(),
        ],
        vec![
            "plugin".into(),
            "add".into(),
            PLUGIN_ID.into(),
            "--json".into(),
        ],
    ]
}

fn uninstall_args() -> [Vec<OsString>; 3] {
    [
        vec![
            "plugin".into(),
            "remove".into(),
            PLUGIN_ID.into(),
            "--json".into(),
        ],
        vec![
            "plugin".into(),
            "remove".into(),
            LEGACY_PLUGIN_ID.into(),
            "--json".into(),
        ],
        vec![
            "plugin".into(),
            "marketplace".into(),
            "remove".into(),
            MARKETPLACE_NAME.into(),
            "--json".into(),
        ],
    ]
}

fn run_step(step: Step, args: &[OsString]) -> Result<(), PluginError> {
    let output = run_codex(args)?;
    if output.status.success() {
        return Ok(());
    }
    if is_missing_removal(step, &output.stderr) {
        return Ok(());
    }
    eprintln!("Codex Halo: {} failed", step.label());
    Err(step.error())
}

fn is_missing_removal(step: Step, stderr: &[u8]) -> bool {
    let stderr = String::from_utf8_lossy(stderr);
    match step {
        Step::RemovePlugin => {
            stderr.contains("not installed")
                || stderr.contains("not configured or installed")
                || stderr.contains("not found")
        }
        Step::RemoveMarketplace => stderr.contains("not configured or installed"),
        _ => false,
    }
}

fn run_codex(args: &[OsString]) -> Result<Output, PluginError> {
    for candidate in codex_candidates() {
        let mut child = match Command::new(&candidate)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(PluginError::CodexUnavailable),
        };
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    return child
                        .wait_with_output()
                        .map_err(|_| PluginError::CodexUnavailable);
                }
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(PluginError::CodexTimeout);
                }
                Ok(None) => thread::sleep(COMMAND_POLL_INTERVAL),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(PluginError::CodexUnavailable);
                }
            }
        }
    }
    Err(PluginError::CodexUnavailable)
}

fn codex_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("CODEX_BIN").filter(|path| !path.is_empty()) {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(PathBuf::from("codex"));
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/ChatGPT.app/Contents/Resources/codex",
        ));
        candidates.push(PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        ));
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn install_args_register_and_enable_the_bundled_plugin() {
        let [marketplace, plugin] = install_args(Path::new("/tmp/codex-halo-marketplace"));

        assert_eq!(
            strings(&marketplace),
            [
                "plugin",
                "marketplace",
                "add",
                "/tmp/codex-halo-marketplace",
                "--json"
            ]
        );
        assert_eq!(
            strings(&plugin),
            ["plugin", "add", "codex-halo@codex-halo", "--json"]
        );
    }

    #[test]
    fn uninstall_args_remove_current_and_legacy_codex_halo() {
        let [plugin, legacy_plugin, marketplace] = uninstall_args();

        assert_eq!(
            strings(&plugin),
            ["plugin", "remove", "codex-halo@codex-halo", "--json"]
        );
        assert_eq!(
            strings(&legacy_plugin),
            ["plugin", "remove", "codex-halo@personal", "--json"]
        );
        assert_eq!(
            strings(&marketplace),
            ["plugin", "marketplace", "remove", "codex-halo", "--json"]
        );
    }

    #[test]
    fn marketplace_ownership_requires_the_bundled_root() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-marketplace-state-{}-{}",
            std::process::id(),
            std::process::id()
        ));
        let owned = root.join("owned");
        let other = root.join("other");
        fs::create_dir_all(&owned).unwrap();
        fs::create_dir_all(&other).unwrap();

        let state = |path: PathBuf| MarketplaceList {
            marketplaces: vec![Marketplace {
                name: MARKETPLACE_NAME.to_owned(),
                root: path,
            }],
        };
        assert_eq!(
            marketplace_state(state(owned.clone()), &owned),
            MarketplaceState::Owned
        );
        assert_eq!(
            marketplace_state(state(other), &owned),
            MarketplaceState::Conflict
        );
        assert_eq!(
            marketplace_state(
                MarketplaceList {
                    marketplaces: vec![]
                },
                &owned
            ),
            MarketplaceState::Missing
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removal_treats_missing_resources_as_idempotent() {
        assert!(is_missing_removal(
            Step::RemovePlugin,
            b"plugin is not installed"
        ));
        assert!(is_missing_removal(
            Step::RemoveMarketplace,
            b"marketplace `codex-halo` is not configured or installed"
        ));
        assert!(!is_missing_removal(
            Step::RemovePlugin,
            b"permission denied"
        ));
    }
}
