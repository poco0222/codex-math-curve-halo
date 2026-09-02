use codex_halo_lib::state::{AppSettings, DisplayState, HaloState, SessionStore, Snapshot};
use codex_halo_lib::{hook_protocol, hooks, platform};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Default)]
struct ReducerRuntimeState {
    store: Mutex<SessionStore>,
    scan_in_progress: AtomicBool,
}

impl ReducerRuntimeState {
    fn try_start_scan(&self) -> bool {
        self.scan_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn finish_scan(&self) {
        self.scan_in_progress.store(false, Ordering::Release);
    }

    fn display_after_scan(
        &self,
        scan: Option<io::Result<Vec<Snapshot>>>,
        now_ms: i64,
    ) -> DisplayState {
        let mut store = self
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(Ok(snapshots)) = scan {
            let mut next = SessionStore::default();
            for snapshot in snapshots {
                next.upsert(snapshot);
            }
            *store = next;
        }

        store.clear_expired(now_ms);
        store.display_state(now_ms)
    }
}

#[tauri::command]
async fn get_display_state(
    app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<DisplayState, String> {
    if !runtime.try_start_scan() {
        return Ok(runtime.display_after_scan(None, now_ms()));
    }

    let scan = match state_dir(&app) {
        Some(state_dir) => tauri::async_runtime::spawn_blocking(move || read_snapshots(&state_dir))
            .await
            .ok(),
        None => None,
    };
    let display = runtime.display_after_scan(scan, now_ms());
    runtime.finish_scan();
    Ok(display)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

fn state_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|path| path.join("state"))
}

fn read_snapshots(path: &Path) -> io::Result<Vec<Snapshot>> {
    let entries = fs::read_dir(path)?.map(|entry| entry.map(|entry| entry.path()));
    read_snapshot_entries(entries, |path| fs::read_to_string(path))
}

fn read_snapshot_entries<I, F>(entries: I, mut read_file: F) -> io::Result<Vec<Snapshot>>
where
    I: IntoIterator<Item = io::Result<PathBuf>>,
    F: FnMut(&Path) -> io::Result<String>,
{
    let mut snapshots = Vec::new();

    for path in entries {
        let path = path?;
        if !hook_protocol::is_snapshot_filename(&path) {
            continue;
        }
        let Ok(contents) = read_file(&path) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_str::<Snapshot>(&contents) else {
            continue;
        };
        snapshots.push(snapshot);
    }

    Ok(snapshots)
}

#[tauri::command]
fn get_settings() -> AppSettings {
    AppSettings::default()
}

#[tauri::command]
fn save_settings(_settings: AppSettings) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn simulate_state(state: HaloState) -> DisplayState {
    DisplayState {
        state,
        ..DisplayState::idle()
    }
}

#[tauri::command]
fn install_hooks(app: AppHandle) -> Result<hooks::InstallReport, String> {
    let (config_path, helper_path, state_dir) = hook_paths(&app)?;
    hooks::install_hooks(&config_path, &helper_path, &state_dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_hooks(app: AppHandle) -> Result<hooks::RemoveReport, String> {
    let (config_path, helper_path, state_dir) = hook_paths(&app)?;
    let report = hooks::remove_hooks(&config_path).map_err(|error| error.to_string())?;
    remove_hook_artifacts(&helper_path, &state_dir).map_err(|error| error.to_string())?;
    Ok(report)
}

#[tauri::command]
fn get_hook_status(app: AppHandle) -> hooks::HookStatus {
    let Ok((config_path, helper_path, _)) = hook_paths(&app) else {
        return hooks::HookStatus::Invalid;
    };
    hooks::get_hook_status(&config_path, &helper_path)
}

fn hook_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let codex_home = hooks::codex_home().map_err(|error| error.to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok((
        codex_home.join("hooks.json"),
        app_data_dir.join(hooks::helper_filename()),
        app_data_dir.join("state"),
    ))
}

fn remove_hook_artifacts(helper_path: &Path, state_dir: &Path) -> io::Result<()> {
    match fs::remove_file(helper_path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    match fs::remove_dir_all(state_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app)
}

fn show_settings(app: &AppHandle) -> Result<(), String> {
    let settings = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window not found".to_owned())?;
    settings.show().map_err(|error| error.to_string())?;
    settings.set_focus().map_err(|error| error.to_string())
}

fn show_settings_or_report(app: &AppHandle) {
    if let Err(error) = show_settings(app) {
        eprintln!("Codex Halo: unable to show settings: {error}");
    }
}

fn helper_setup_best_effort<F>(install: F) -> bool
where
    F: FnOnce() -> Result<(), hook_protocol::HookError>,
{
    if install().is_err() {
        eprintln!("Codex Halo: hook helper unavailable");
    }
    true
}

fn build_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let app_data_dir = app.path().app_data_dir()?;
    helper_setup_best_effort(|| {
        hook_protocol::install_bundled_helper(&app_data_dir).map(|_| ())
    });

    let settings = AppSettings::default();
    let overlay = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Codex Halo")
        .inner_size(112.0, 112.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(true)
        .build()?;
    platform::configure_overlay(&overlay)?;
    if let Err(error) = platform::position_overlay(&overlay, settings.offset_x, settings.offset_y) {
        eprintln!("Codex Halo: unable to position overlay: {error}");
    }

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("Codex Halo Settings")
    .inner_size(420.0, 680.0)
    .visible(false)
    .build()?;

    let open_settings = MenuItem::with_id(app, "open-settings", "Open Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_settings, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-settings" => {
                show_settings_or_report(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(ReducerRuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings_or_report(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            get_display_state,
            get_settings,
            save_settings,
            simulate_state,
            install_hooks,
            remove_hooks,
            get_hook_status,
            open_settings
        ])
        .setup(build_windows);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Codex Halo");
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use std::cell::Cell;
    use std::io;

    fn runtime_with_input_needed(now_ms: i64) -> ReducerRuntimeState {
        let runtime = ReducerRuntimeState::default();
        runtime.display_after_scan(
            Some(Ok(vec![Snapshot::new(
                "old",
                HaloState::InputNeeded,
                now_ms,
            )])),
            now_ms,
        );
        runtime
    }

    #[test]
    fn scan_gate_rejects_overlapping_scans() {
        let runtime = ReducerRuntimeState::default();

        assert!(runtime.try_start_scan());
        assert!(!runtime.try_start_scan());
        runtime.finish_scan();
        assert!(runtime.try_start_scan());
        runtime.finish_scan();
    }

    #[test]
    fn initial_directory_read_failure_preserves_store() {
        let now = 1_000_000;
        let runtime = runtime_with_input_needed(now);
        let missing =
            std::env::temp_dir().join(format!("codex-halo-missing-{}-{now}", std::process::id()));
        let scan = read_snapshots(&missing);

        assert!(scan.is_err());
        let display = runtime.display_after_scan(Some(scan), now);
        assert_eq!(display.state, HaloState::InputNeeded);
        assert_eq!(display.session_count, 1);
    }

    #[test]
    fn mid_iteration_error_preserves_store() {
        let now = 1_000_000;
        let runtime = runtime_with_input_needed(now);
        let reads = Cell::new(0);
        let entries = vec![
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json",
            )),
            Err(io::Error::new(io::ErrorKind::Other, "entry failed")),
            Ok(PathBuf::from(
                "1629ea86a7e4d9c7cc074bbc86dde1871ab8a9a2abfaf3c8a73acdb97ace9f06.json",
            )),
        ];
        let scan = read_snapshot_entries(entries, |_| {
            reads.set(reads.get() + 1);
            Ok(r#"{"session_key":"new","state":"thinking","updated_at_ms":999900}"#.to_owned())
        });

        assert!(scan.is_err());
        assert_eq!(reads.get(), 1);
        let display = runtime.display_after_scan(Some(scan), now);
        assert_eq!(display.state, HaloState::InputNeeded);
        assert_eq!(display.session_count, 1);
    }

    #[test]
    fn mixed_valid_and_corrupt_files_keep_valid_snapshots() {
        let entries = vec![
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json",
            )),
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.corrupt.json",
            )),
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.unreadable.json",
            )),
        ];
        let snapshots = read_snapshot_entries(entries, |path| match path.to_str().unwrap() {
            "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json" => Ok(
                r#"{"session_key":"valid","state":"executing","updated_at_ms":999900}"#.to_owned(),
            ),
            "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.corrupt.json" => {
                Ok("{".to_owned())
            }
            "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.unreadable.json" => {
                Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
            }
            _ => Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied")),
        })
        .unwrap();

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].session_key, "valid");
        assert_eq!(snapshots[0].state, HaloState::Executing);
    }

    #[test]
    fn reader_accepts_only_exact_lowercase_sha256_json_names() {
        let valid =
            PathBuf::from("e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json");
        let entries = vec![
            Ok(valid.clone()),
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json.tmp",
            )),
            Ok(PathBuf::from(
                "e3091fe2986effba7b815449e32060814fed909a796454920df65f816a3a5889.json.tmp.crash",
            )),
            Ok(PathBuf::from(
                "E3091FE2986EFFBA7B815449E32060814FED909A796454920DF65F816A3A5889.json",
            )),
            Ok(PathBuf::from("short.json")),
        ];

        let snapshots = read_snapshot_entries(entries, |path| {
            assert_eq!(path, valid.as_path());
            Ok(r#"{"session_key":"valid","state":"executing","updated_at_ms":999900}"#.to_owned())
        })
        .unwrap();

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].session_key, "valid");
    }

    #[test]
    fn successful_scan_replaces_entire_store() {
        let now = 1_000_000;
        let runtime = runtime_with_input_needed(now);
        let display = runtime.display_after_scan(
            Some(Ok(vec![
                Snapshot::new("a", HaloState::Thinking, now - 200),
                Snapshot::new("b", HaloState::Executing, now - 100),
            ])),
            now,
        );

        assert_eq!(display.state, HaloState::Executing);
        assert_eq!(display.session_count, 2);
        assert_eq!(display.updated_at_ms, now - 100);
    }

    #[test]
    fn helper_copy_failure_does_not_propagate_from_setup() {
        assert!(helper_setup_best_effort(|| {
            Err(hook_protocol::HookError::InvalidInput)
        }));
    }

    #[test]
    fn removes_hook_artifacts_without_failing_for_missing_paths() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-artifacts-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let helper = root.join("helper");
        let state_dir = root.join("state");
        fs::create_dir_all(&state_dir).unwrap();
        fs::write(&helper, b"helper").unwrap();

        remove_hook_artifacts(&helper, &state_dir).unwrap();

        assert!(!helper.exists());
        assert!(!state_dir.exists());
        remove_hook_artifacts(&helper, &state_dir).unwrap();
        assert!(root.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
