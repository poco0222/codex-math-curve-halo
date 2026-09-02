use codex_halo_lib::state::{AppSettings, DisplayState, HaloState, SessionStore, Snapshot};
use codex_halo_lib::{hook_protocol, hooks, platform};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

const SETTINGS_FILENAME: &str = "settings.json";
const SETTINGS_INVALID_LIMIT: u32 = 64;
const SIMULATION_SESSION_KEY: &str = "__codex_halo_simulation__";
static SETTINGS_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct ReducerRuntimeState {
    store: Mutex<SessionStore>,
    simulation: Mutex<Option<Snapshot>>,
    scan_in_progress: AtomicBool,
    scan_epoch: AtomicU64,
    settings_transaction: Mutex<()>,
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

    fn scan_epoch(&self) -> u64 {
        self.scan_epoch.load(Ordering::Acquire)
    }

    fn display_after_scan(
        &self,
        scan: Option<io::Result<Vec<Snapshot>>>,
        now_ms: i64,
    ) -> DisplayState {
        self.display_after_scan_at_epoch(scan, now_ms, self.scan_epoch())
    }

    fn display_after_scan_at_epoch(
        &self,
        scan: Option<io::Result<Vec<Snapshot>>>,
        now_ms: i64,
        scan_epoch: u64,
    ) -> DisplayState {
        let mut store = self
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut simulation = self
            .simulation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if scan_epoch == self.scan_epoch() {
            if let Some(Ok(snapshots)) = scan {
                if simulation.as_ref().is_some_and(|simulated| {
                    snapshots
                        .iter()
                        .any(|snapshot| snapshot.updated_at_ms > simulated.updated_at_ms)
                }) {
                    *simulation = None;
                }
                let mut next = SessionStore::default();
                for snapshot in snapshots {
                    next.upsert(snapshot);
                }
                *store = next;
            }
        }

        store.clear_expired(now_ms);
        store.display_state_with_override(simulation.as_ref(), now_ms)
    }

    fn simulate_state(&self, state: HaloState, now_ms: i64) -> DisplayState {
        let mut store = self
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut simulation = self
            .simulation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *simulation = Some(Snapshot::new(SIMULATION_SESSION_KEY, state, now_ms));
        store.clear_expired(now_ms);
        store.display_state_with_override(simulation.as_ref(), now_ms)
    }

    fn clear_real_sessions(&self) {
        self.scan_epoch.fetch_add(1, Ordering::AcqRel);
        let mut store = self
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *store = SessionStore::default();
    }
}

#[tauri::command]
async fn get_display_state(
    _app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<DisplayState, String> {
    if !runtime.try_start_scan() {
        return Ok(runtime.display_after_scan(None, now_ms()));
    }
    let scan_epoch = runtime.scan_epoch();

    let scan = match state_dir() {
        Some(state_dir) => tauri::async_runtime::spawn_blocking(move || read_snapshots(&state_dir))
            .await
            .ok(),
        None => None,
    };
    let display = runtime.display_after_scan_at_epoch(scan, now_ms(), scan_epoch);
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

fn state_dir() -> Option<PathBuf> {
    hooks::runtime_state_dir().ok()
}

fn app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SETTINGS_FILENAME))
        .map_err(|_| "Codex Halo settings path is unavailable".to_owned())
}

fn settings_temp_path(path: &Path, sequence: u64) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| "Codex Halo settings path is invalid".to_owned())?
        .to_string_lossy();
    Ok(parent.join(format!("{name}.tmp.{}.{}", std::process::id(), sequence)))
}

fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|_| "Codex Halo settings could not be saved".to_owned())?;

    for _ in 0..SETTINGS_INVALID_LIMIT {
        let sequence = SETTINGS_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = settings_temp_path(path, sequence)?;
        let file = OpenOptions::new().create_new(true).write(true).open(&temp);
        let Ok(mut file) = file else {
            continue;
        };

        let result = (|| {
            serde_json::to_writer_pretty(&mut file, settings)
                .map_err(|_| "Codex Halo settings could not be saved".to_owned())?;
            file.write_all(b"\n")
                .map_err(|_| "Codex Halo settings could not be saved".to_owned())?;
            file.flush()
                .map_err(|_| "Codex Halo settings could not be saved".to_owned())?;
            file.sync_all()
                .map_err(|_| "Codex Halo settings could not be saved".to_owned())?;
            platform::atomic_replace(&temp, path)
                .map_err(|_| "Codex Halo settings could not be saved".to_owned())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        return result;
    }

    Err("Codex Halo settings could not be saved".to_owned())
}

fn quarantine_settings_file(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| "Codex Halo settings path is invalid".to_owned())?
        .to_string_lossy();
    let timestamp = now_ms();

    for sequence in 0..SETTINGS_INVALID_LIMIT {
        let invalid = parent.join(format!("{name}.{timestamp}.{sequence}.invalid"));
        match fs::rename(path, invalid) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Codex Halo settings could not be repaired".to_owned()),
        }
    }

    Err("Codex Halo settings could not be repaired".to_owned())
}

fn recover_settings_file(path: &Path) -> Result<AppSettings, String> {
    quarantine_settings_file(path)?;
    let settings = AppSettings::default();
    write_settings_file(path, &settings)?;
    Ok(settings)
}

fn load_settings_file(path: &Path) -> Result<AppSettings, String> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let settings = AppSettings::default();
            write_settings_file(path, &settings)?;
            return Ok(settings);
        }
        Err(_) => return Err("Codex Halo settings could not be read".to_owned()),
    };

    let parsed = match serde_json::from_slice::<AppSettings>(&contents) {
        Ok(settings) => settings,
        Err(_) => return recover_settings_file(path),
    };
    let normalized = match parsed.clone().normalize() {
        Ok(settings) => settings,
        Err(_) => return recover_settings_file(path),
    };
    if parsed != normalized {
        write_settings_file(path, &normalized)?;
    }
    Ok(normalized)
}

fn load_app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    load_settings_file(&app_config_path(app)?)
}

fn apply_settings_to_overlay(app: &AppHandle, settings: &AppSettings) {
    if let Some(overlay) = app.get_webview_window("main") {
        if platform::position_overlay(&overlay, settings.offset_x, settings.offset_y).is_err() {
            eprintln!("Codex Halo: unable to apply overlay position");
        }
        if platform::set_overlay_visibility(&overlay, settings.enabled).is_err() {
            eprintln!("Codex Halo: unable to apply overlay visibility");
        }
    }
    for target in ["main", "settings"] {
        let _ = app.emit_to(target, "settings-changed", settings.clone());
    }
}

fn save_settings_transaction<F, G>(
    current: &AppSettings,
    next: &AppSettings,
    mut write_settings: F,
    mut set_autostart: G,
) -> Result<(), String>
where
    F: FnMut(&AppSettings) -> Result<(), String>,
    G: FnMut(bool) -> Result<(), String>,
{
    if current.start_at_login == next.start_at_login {
        return write_settings(next);
    }

    if let Err(error) = set_autostart(next.start_at_login) {
        if set_autostart(current.start_at_login).is_err() {
            return Err("start-at-login:reconciliation".to_owned());
        }
        return Err(error);
    }
    if let Err(error) = write_settings(next) {
        if set_autostart(current.start_at_login).is_err() {
            return Err("start-at-login:reconciliation".to_owned());
        }
        return Err(error);
    }
    Ok(())
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
fn get_settings(
    app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<AppSettings, String> {
    let _guard = runtime
        .settings_transaction
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    load_app_settings(&app)
}

fn save_settings_unlocked(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let settings = settings.normalize()?;
    let path = app_config_path(&app)?;
    let current = load_settings_file(&path)?;

    save_settings_transaction(
        &current,
        &settings,
        |value| write_settings_file(&path, value),
        |enabled| platform::set_start_at_login(&app, enabled).map_err(|error| error.to_string()),
    )?;
    apply_settings_to_overlay(&app, &settings);
    Ok(())
}

fn save_settings_inner(
    app: AppHandle,
    settings: AppSettings,
    runtime: &ReducerRuntimeState,
) -> Result<(), String> {
    let _guard = runtime
        .settings_transaction
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    save_settings_unlocked(app, settings)
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    settings: AppSettings,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<(), String> {
    save_settings_inner(app, settings, &runtime)
}

#[tauri::command]
fn simulate_state(
    app: AppHandle,
    state: HaloState,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<DisplayState, String> {
    Ok(simulate_state_inner(&app, state, &runtime))
}

#[tauri::command]
fn install_hooks(app: AppHandle) -> Result<hooks::InstallReport, String> {
    let (config_path, helper_path, state_dir) = hook_paths(&app)?;
    hooks::install_hooks(&config_path, &helper_path, &state_dir)
        .map_err(|_| "Codex Halo hooks could not be installed".to_owned())
}

fn remove_hooks_inner(
    app: &AppHandle,
    runtime: &ReducerRuntimeState,
) -> Result<hooks::RemoveReport, String> {
    let (config_path, helper_path, state_dir) = hook_paths(app)?;
    let report = hooks::remove_hooks(&config_path)
        .map_err(|_| "Codex Halo hooks could not be removed".to_owned())?;
    remove_hook_artifacts(&helper_path, &state_dir)
        .map_err(|_| "Codex Halo hook artifacts could not be removed".to_owned())?;
    runtime.clear_real_sessions();
    Ok(report)
}

#[tauri::command]
fn remove_hooks(
    app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<hooks::RemoveReport, String> {
    remove_hooks_inner(&app, &runtime)
}

#[tauri::command]
fn get_hook_status(app: AppHandle) -> Result<hooks::HookStatus, String> {
    let (config_path, helper_path, _) = hook_paths(&app)?;
    Ok(hooks::get_hook_status(&config_path, &helper_path))
}

fn hook_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let codex_home =
        hooks::codex_home().map_err(|_| "Codex Halo hooks path is unavailable".to_owned())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Codex Halo hook data path is unavailable".to_owned())?;
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

#[tauri::command]
fn set_overlay_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let overlay = app
        .get_webview_window("main")
        .ok_or_else(|| "Codex Halo overlay window not found".to_owned())?;
    platform::set_overlay_visibility(&overlay, visible)
        .map_err(|_| "Codex Halo overlay visibility could not be changed".to_owned())
}

fn reset_position_inner(
    app: AppHandle,
    runtime: &ReducerRuntimeState,
) -> Result<AppSettings, String> {
    let _guard = runtime
        .settings_transaction
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = load_app_settings(&app)?;
    settings.offset_x = AppSettings::default().offset_x;
    settings.offset_y = AppSettings::default().offset_y;
    save_settings_unlocked(app, settings.clone())?;
    Ok(settings)
}

#[tauri::command]
fn reset_position(
    app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<AppSettings, String> {
    reset_position_inner(app, &runtime)
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

fn toggle_overlay_inner(
    app: AppHandle,
    runtime: &ReducerRuntimeState,
) -> Result<AppSettings, String> {
    let _guard = runtime
        .settings_transaction
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = load_app_settings(&app)?;
    settings.enabled = !settings.enabled;
    save_settings_unlocked(app, settings.clone())?;
    Ok(settings)
}

fn simulate_state_inner(
    app: &AppHandle,
    state: HaloState,
    runtime: &ReducerRuntimeState,
) -> DisplayState {
    let display = runtime.simulate_state(state, now_ms());
    let _ = app.emit_to("main", "simulated-display-state", display.clone());
    display
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

fn build_tray(app: &mut tauri::App, _enabled: bool) -> Result<(), Box<dyn std::error::Error>> {
    let open_settings =
        MenuItem::with_id(app, "open-settings", "Open Settings", true, None::<&str>)?;
    let toggle_overlay_item = MenuItem::with_id(
        app,
        "toggle-overlay",
        "Enable/disable overlay",
        true,
        None::<&str>,
    )?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let install_hooks_item = MenuItem::with_id(
        app,
        "install-hooks",
        "Install/repair Codex hooks",
        true,
        None::<&str>,
    )?;
    let remove_hooks_item = MenuItem::with_id(
        app,
        "remove-hooks",
        "Remove Codex Halo hooks",
        true,
        None::<&str>,
    )?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let simulate_idle =
        MenuItem::with_id(app, "simulate-idle", "Simulate Idle", true, None::<&str>)?;
    let simulate_thinking = MenuItem::with_id(
        app,
        "simulate-thinking",
        "Simulate Thinking",
        true,
        None::<&str>,
    )?;
    let simulate_executing = MenuItem::with_id(
        app,
        "simulate-executing",
        "Simulate Executing",
        true,
        None::<&str>,
    )?;
    let simulate_input = MenuItem::with_id(
        app,
        "simulate-input-needed",
        "Simulate Input needed",
        true,
        None::<&str>,
    )?;
    let simulate_completed = MenuItem::with_id(
        app,
        "simulate-completed",
        "Simulate Completed",
        true,
        None::<&str>,
    )?;
    let simulate_compacting = MenuItem::with_id(
        app,
        "simulate-compacting",
        "Simulate Compacting",
        true,
        None::<&str>,
    )?;
    let reset = MenuItem::with_id(app, "reset-position", "Reset position", true, None::<&str>)?;
    let separator_three = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_settings,
            &toggle_overlay_item,
            &separator_one,
            &install_hooks_item,
            &remove_hooks_item,
            &separator_two,
            &simulate_idle,
            &simulate_thinking,
            &simulate_executing,
            &simulate_input,
            &simulate_completed,
            &simulate_compacting,
            &reset,
            &separator_three,
            &quit,
        ],
    )?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?.to_owned();
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("Codex Halo");
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);
    tray.on_menu_event(move |app, event| match event.id.as_ref() {
        "open-settings" => show_settings_or_report(app),
        "toggle-overlay" => {
            let runtime = app.state::<ReducerRuntimeState>();
            if toggle_overlay_inner(app.clone(), &runtime).is_err() {
                eprintln!("Codex Halo: unable to change overlay setting");
            }
        }
        "install-hooks" => {
            if install_hooks(app.clone()).is_err() {
                eprintln!("Codex Halo: unable to install hooks");
            }
            show_settings_or_report(app);
        }
        "remove-hooks" => {
            let runtime = app.state::<ReducerRuntimeState>();
            if remove_hooks_inner(app, &runtime).is_err() {
                eprintln!("Codex Halo: unable to remove hooks");
            }
            show_settings_or_report(app);
        }
        "reset-position" => {
            let runtime = app.state::<ReducerRuntimeState>();
            if reset_position_inner(app.clone(), &runtime).is_err() {
                eprintln!("Codex Halo: unable to reset position");
            }
        }
        "simulate-idle" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Idle, &runtime);
        }
        "simulate-thinking" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Thinking, &runtime);
        }
        "simulate-executing" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Executing, &runtime);
        }
        "simulate-input-needed" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::InputNeeded, &runtime);
        }
        "simulate-completed" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Completed, &runtime);
        }
        "simulate-compacting" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Compacting, &runtime);
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    Ok(())
}

fn build_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    if let Ok(runtime_root) = hooks::runtime_root() {
        helper_setup_best_effort(|| {
            hook_protocol::install_bundled_helper(&runtime_root).map(|_| ())
        });
    } else {
        eprintln!("Codex Halo: hook helper unavailable");
    }

    let settings = load_app_settings(app.handle()).unwrap_or_else(|_| {
        eprintln!("Codex Halo: using default settings");
        AppSettings::default()
    });
    let overlay = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Codex Halo")
        .inner_size(112.0, 112.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .build()?;
    platform::configure_overlay(&overlay)?;
    if let Err(error) = platform::position_overlay(&overlay, settings.offset_x, settings.offset_y) {
        eprintln!("Codex Halo: unable to position overlay: {error}");
    }

    let settings_window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title("Codex Halo Settings")
            .inner_size(420.0, 680.0)
            .visible(false)
            .build()?;
    settings_window.on_window_event({
        let settings_window = settings_window.clone();
        move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = settings_window.hide();
            }
        }
    });

    build_tray(app, settings.enabled)?;

    Ok(())
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(ReducerRuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_settings_or_report(app);
        }));
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        MacosLauncher::LaunchAgent,
        None,
    ));
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            get_display_state,
            get_settings,
            save_settings,
            simulate_state,
            install_hooks,
            remove_hooks,
            get_hook_status,
            open_settings,
            reset_position,
            set_overlay_visible
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
    fn runtime_scan_state_dir_uses_plugin_runtime_path() {
        let previous_codex_home = std::env::var_os("CODEX_HOME");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("CODEX_HOME", "/tmp/codex-home");

        assert_eq!(
            state_dir(),
            Some(PathBuf::from("/tmp/codex-home/codex-halo/state"))
        );

        match previous_codex_home {
            Some(path) => std::env::set_var("CODEX_HOME", path),
            None => std::env::remove_var("CODEX_HOME"),
        }
        match previous_home {
            Some(path) => std::env::set_var("HOME", path),
            None => std::env::remove_var("HOME"),
        }
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
    fn simulation_overrides_display_without_inflating_real_session_count() {
        let now = 1_000_000;
        let runtime = ReducerRuntimeState::default();
        runtime.display_after_scan(
            Some(Ok(vec![Snapshot::new("real", HaloState::Executing, now)])),
            now,
        );

        let display = runtime.simulate_state(HaloState::Completed, now + 1);

        assert_eq!(display.state, HaloState::Completed);
        assert_eq!(display.session_count, 1);
        assert_eq!(display.updated_at_ms, now + 1);
    }

    #[test]
    fn newer_real_scan_supersedes_simulation() {
        let now = 1_000_000;
        let runtime = ReducerRuntimeState::default();
        runtime.simulate_state(HaloState::Completed, now);

        let display = runtime.display_after_scan_at_epoch(
            Some(Ok(vec![Snapshot::new(
                "real",
                HaloState::Thinking,
                now + 1,
            )])),
            now + 1,
            runtime.scan_epoch(),
        );

        assert_eq!(display.state, HaloState::Thinking);
        assert_eq!(display.session_count, 1);
    }

    #[test]
    fn clearing_real_sessions_blocks_an_in_flight_scan_but_keeps_simulation() {
        let now = 1_000_000;
        let runtime = ReducerRuntimeState::default();
        runtime.display_after_scan(
            Some(Ok(vec![Snapshot::new("real", HaloState::Executing, now)])),
            now,
        );
        runtime.simulate_state(HaloState::InputNeeded, now + 1);
        let stale_epoch = runtime.scan_epoch();
        runtime.clear_real_sessions();

        let display = runtime.display_after_scan_at_epoch(
            Some(Ok(vec![Snapshot::new(
                "stale",
                HaloState::Executing,
                now + 2,
            )])),
            now + 2,
            stale_epoch,
        );

        assert_eq!(display.state, HaloState::InputNeeded);
        assert_eq!(display.session_count, 0);
    }

    #[test]
    fn simulation_expiry_matches_completed_and_input_needed_rules() {
        let now = 1_000_000;
        let runtime = ReducerRuntimeState::default();

        assert_eq!(
            runtime.simulate_state(HaloState::Completed, now).state,
            HaloState::Completed
        );
        assert_eq!(
            runtime.display_after_scan(None, now + 3_001).state,
            HaloState::Idle
        );

        assert_eq!(
            runtime.simulate_state(HaloState::InputNeeded, now).state,
            HaloState::InputNeeded
        );
        assert_eq!(
            runtime.display_after_scan(None, now + 86_400_000).state,
            HaloState::InputNeeded
        );

        let runtime = ReducerRuntimeState::default();
        assert_eq!(
            runtime.simulate_state(HaloState::Idle, now).updated_at_ms,
            now
        );
        assert_eq!(
            runtime.display_after_scan(None, now + 60_000).updated_at_ms,
            now
        );
        assert_eq!(
            runtime.display_after_scan(None, now + 60_001).updated_at_ms,
            0
        );
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

    #[test]
    fn corrupt_settings_are_quarantined_and_replaced_with_defaults() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-settings-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let path = root.join("settings.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, br#"{"prompt":"must not be shown"}"#).unwrap();

        let settings = load_settings_file(&path).unwrap();

        assert_eq!(settings, AppSettings::default());
        assert!(path.exists());
        assert!(fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "invalid")));
        assert!(!fs::read_to_string(&path).unwrap().contains("prompt"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn settings_transaction_rolls_back_autostart_when_settings_write_fails() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.start_at_login = true;
        let mut autostart_changes = Vec::new();

        let result = save_settings_transaction(
            &current,
            &next,
            |_| Err("settings write failed".to_owned()),
            |enabled| {
                autostart_changes.push(enabled);
                Ok(())
            },
        );

        assert_eq!(result, Err("settings write failed".to_owned()));
        assert_eq!(autostart_changes, [true, false]);
    }

    #[test]
    fn settings_transaction_reports_reconciliation_failure() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.start_at_login = true;
        let mut autostart_changes = Vec::new();

        let result = save_settings_transaction(
            &current,
            &next,
            |_| Err("settings write failed".to_owned()),
            |enabled| {
                autostart_changes.push(enabled);
                if enabled {
                    Ok(())
                } else {
                    Err("rollback failed".to_owned())
                }
            },
        );

        assert_eq!(result, Err("start-at-login:reconciliation".to_owned()));
        assert_eq!(autostart_changes, [true, false]);
    }

    #[test]
    fn settings_transaction_reconciles_autostart_error_before_writing_settings() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.start_at_login = true;
        let mut native_autostart = current.start_at_login;
        let mut autostart_changes = Vec::new();
        let mut settings_committed = false;
        let mut attempts = 0;

        let result = save_settings_transaction(
            &current,
            &next,
            |_| {
                settings_committed = true;
                Ok(())
            },
            |enabled| {
                native_autostart = enabled;
                autostart_changes.push(enabled);
                attempts += 1;
                if attempts == 1 {
                    Err("start-at-login:registry".to_owned())
                } else {
                    Ok(())
                }
            },
        );

        assert_eq!(result, Err("start-at-login:registry".to_owned()));
        assert_eq!(native_autostart, current.start_at_login);
        assert_eq!(autostart_changes, [true, false]);
        assert!(!settings_committed);
    }

    #[test]
    fn settings_transaction_reports_initial_autostart_reconciliation_failure() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.start_at_login = true;
        let mut native_autostart = current.start_at_login;
        let mut settings_committed = false;
        let mut attempts = 0;

        let result = save_settings_transaction(
            &current,
            &next,
            |_| {
                settings_committed = true;
                Ok(())
            },
            |enabled| {
                native_autostart = enabled;
                attempts += 1;
                Err(if attempts == 1 {
                    "start-at-login:registry"
                } else {
                    "start-at-login:reconciliation"
                }
                .to_owned())
            },
        );

        assert_eq!(result, Err("start-at-login:reconciliation".to_owned()));
        assert_eq!(native_autostart, current.start_at_login);
        assert!(!settings_committed);
    }
}
