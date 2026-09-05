use codex_halo_lib::state::{
    AppSettings, DisplayState, HaloState, OverlayPosition, SessionStore, Snapshot,
};
use codex_halo_lib::{hook_protocol, hooks, lifecycle, platform, plugin, positioning};
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
const STATE_COLOR_SETTING_KEYS: [&str; 7] = [
    "idle_color",
    "thinking_color",
    "executing_color",
    "input_needed_color",
    "completed_color",
    "interrupted_color",
    "compacting_color",
];
static SETTINGS_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct ReducerRuntimeState {
    store: Mutex<SessionStore>,
    simulation: Mutex<Option<Snapshot>>,
    scan_in_progress: AtomicBool,
    settings_transaction: Mutex<()>,
    tray_menu: Mutex<Option<TrayMenuItems>>,
}

#[derive(Clone)]
struct TrayMenuItems {
    open_settings: MenuItem<tauri::Wry>,
    toggle_overlay: MenuItem<tauri::Wry>,
    install_plugin: MenuItem<tauri::Wry>,
    uninstall_plugin: MenuItem<tauri::Wry>,
    simulate_idle: MenuItem<tauri::Wry>,
    simulate_thinking: MenuItem<tauri::Wry>,
    simulate_executing: MenuItem<tauri::Wry>,
    simulate_input_needed: MenuItem<tauri::Wry>,
    simulate_completed: MenuItem<tauri::Wry>,
    simulate_interrupted: MenuItem<tauri::Wry>,
    simulate_compacting: MenuItem<tauri::Wry>,
    reset_position: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
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
        let mut simulation = self
            .simulation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

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
}

#[tauri::command]
async fn get_display_state(
    app: AppHandle,
    runtime: State<'_, ReducerRuntimeState>,
) -> Result<DisplayState, String> {
    if !runtime.try_start_scan() {
        return Ok(runtime.display_after_scan(None, now_ms()));
    }
    let scan_now_ms = now_ms();

    let scan = match scan_state_dir(&app) {
        Some(state_dir) => tauri::async_runtime::spawn_blocking(move || {
            read_runtime_snapshots(&state_dir, scan_now_ms)
        })
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

fn scan_state_dir(_app: &AppHandle) -> Option<PathBuf> {
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

fn settings_file_has_complete_state_colors(contents: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(contents) else {
        return false;
    };
    let Some(object) = value.as_object() else {
        return false;
    };
    STATE_COLOR_SETTING_KEYS
        .iter()
        .all(|key| object.contains_key(*key))
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
    if parsed != normalized || !settings_file_has_complete_state_colors(&contents) {
        write_settings_file(path, &normalized)?;
    }
    Ok(normalized)
}

fn load_app_settings(app: &AppHandle) -> Result<AppSettings, String> {
    load_settings_file(&app_config_path(app)?)
}

fn apply_settings_to_overlay(app: &AppHandle, settings: &AppSettings) {
    if let Some(overlay) = app.get_webview_window("main") {
        if platform::set_overlay_visibility(&overlay, settings.enabled).is_err() {
            eprintln!("Codex Halo: unable to apply overlay visibility");
        }
    }
    let tray_menu = app
        .state::<ReducerRuntimeState>()
        .tray_menu
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(items) = tray_menu.as_ref() {
        update_tray_menu(items, settings);
    }
    if let Some(settings_window) = app.get_webview_window("settings") {
        if let Err(error) = settings_window.set_title(settings_window_title(&settings.language)) {
            eprintln!("Codex Halo: unable to update settings window title: {error}");
        }
    }
    for target in ["main", "settings"] {
        let _ = app.emit_to(target, "settings-changed", settings.clone());
    }
}

fn rollback_settings_side_effects<G, H>(
    current: &AppSettings,
    restore_lifecycle: bool,
    restore_autostart: bool,
    set_autostart: &mut G,
    set_lifecycle: &mut H,
) -> bool
where
    G: FnMut(bool) -> Result<(), String>,
    H: FnMut(bool) -> Result<(), String>,
{
    let lifecycle_failed =
        restore_lifecycle && set_lifecycle(current.follow_codex_lifecycle).is_err();
    let autostart_failed = restore_autostart && set_autostart(current.start_at_login).is_err();
    lifecycle_failed || autostart_failed
}

fn save_settings_transaction<F, G, H>(
    current: &AppSettings,
    next: &AppSettings,
    mut write_settings: F,
    mut set_autostart: G,
    mut set_lifecycle: H,
) -> Result<(), String>
where
    F: FnMut(&AppSettings) -> Result<(), String>,
    G: FnMut(bool) -> Result<(), String>,
    H: FnMut(bool) -> Result<(), String>,
{
    let autostart_changed = current.start_at_login != next.start_at_login;
    let lifecycle_changed = current.follow_codex_lifecycle != next.follow_codex_lifecycle;

    if autostart_changed {
        if let Err(error) = set_autostart(next.start_at_login) {
            if rollback_settings_side_effects(
                current,
                false,
                true,
                &mut set_autostart,
                &mut set_lifecycle,
            ) {
                return Err("start-at-login:reconciliation".to_owned());
            }
            return Err(error);
        }
    }

    if lifecycle_changed {
        if let Err(error) = set_lifecycle(next.follow_codex_lifecycle) {
            if rollback_settings_side_effects(
                current,
                true,
                autostart_changed,
                &mut set_autostart,
                &mut set_lifecycle,
            ) {
                return Err("start-at-login:reconciliation".to_owned());
            }
            return Err(error);
        }
    }

    if let Err(error) = write_settings(next) {
        if rollback_settings_side_effects(
            current,
            lifecycle_changed,
            autostart_changed,
            &mut set_autostart,
            &mut set_lifecycle,
        ) {
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

fn read_runtime_snapshots(path: &Path, cutoff_ms: i64) -> io::Result<Vec<Snapshot>> {
    let snapshots = match read_snapshots(path) {
        Ok(snapshots) => snapshots,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    Ok(snapshots
        .into_iter()
        .filter(|snapshot| snapshot.updated_at_ms <= cutoff_ms)
        .collect())
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
    let path = app_config_path(&app)?;
    let current = load_settings_file(&path)?;
    let settings = positioning::preserve_position(&current, settings).normalize()?;

    save_settings_transaction(
        &current,
        &settings,
        |value| write_settings_file(&path, value),
        |enabled| platform::set_start_at_login(&app, enabled).map_err(|error| error.to_string()),
        |enabled| lifecycle::sync_app(&app, enabled),
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
fn begin_overlay_drag(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    positioning::begin(window, x, y, width, height)
}

fn save_overlay_position(app: &AppHandle, position: OverlayPosition) -> Result<(), String> {
    let runtime = app.state::<ReducerRuntimeState>();
    let _guard = runtime
        .settings_transaction
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = app_config_path(app)?;
    let mut settings = load_settings_file(&path)?;
    settings.overlay_position = Some(position);
    let settings = settings.normalize()?;
    write_settings_file(&path, &settings)?;
    for target in ["main", "settings"] {
        let _ = app.emit_to(target, "settings-changed", settings.clone());
    }
    let _ = app.emit_to("settings", "position-saved", ());
    Ok(())
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
async fn install_plugin(app: AppHandle) -> Result<(), String> {
    let marketplace_root = plugin_marketplace_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugin::install(&marketplace_root))
        .await
        .map_err(|_| "Codex Halo Plugin operation failed".to_owned())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn uninstall_plugin(app: AppHandle) -> Result<(), String> {
    let marketplace_root = plugin_marketplace_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || plugin::uninstall(&marketplace_root))
        .await
        .map_err(|_| "Codex Halo Plugin operation failed".to_owned())?
        .map_err(|error| error.to_string())
}

fn plugin_marketplace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::with_capacity(2);
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(plugin::RESOURCE_ROOT));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));

    find_marketplace_root(candidates)
        .ok_or_else(|| "Codex Halo Plugin package is unavailable".to_owned())
}

fn find_marketplace_root(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|root| root.join(".agents/plugins/marketplace.json").is_file())
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
    let previous = settings.clone();
    settings.offset_x = AppSettings::default().offset_x;
    settings.offset_y = AppSettings::default().offset_y;
    settings.overlay_position = None;
    let overlay = app
        .get_webview_window("main")
        .ok_or("Codex Halo overlay window not found")?;
    positioning::cancel(&overlay);
    settings.overlay_position = Some(positioning::restore(&overlay, &settings)?);
    if let Err(error) = write_settings_file(&app_config_path(&app)?, &settings) {
        let _ = positioning::restore(&overlay, &previous);
        return Err(error);
    }
    apply_settings_to_overlay(&app, &settings);
    let _ = app.emit_to("settings", "position-saved", ());
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

fn handle_single_instance(app: &AppHandle, args: Vec<String>) {
    if lifecycle::has_lifecycle_stop_marker(args.iter().cloned()) {
        if lifecycle::lifecycle_stop_targets(
            args,
            std::process::id(),
            lifecycle::current_managed_token(),
        ) {
            app.exit(0);
        }
        return;
    }
    show_settings_or_report(app);
}

fn install_plugin_inner(app: &AppHandle) -> Result<(), String> {
    let marketplace_root = plugin_marketplace_root(app)?;
    plugin::install(&marketplace_root).map_err(|error| error.to_string())
}

fn uninstall_plugin_inner(app: &AppHandle) -> Result<(), String> {
    let marketplace_root = plugin_marketplace_root(app)?;
    plugin::uninstall(&marketplace_root).map_err(|error| error.to_string())
}

fn spawn_tray_plugin_action(app: &AppHandle, install: bool) {
    let app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let result = if install {
            install_plugin_inner(&app)
        } else {
            uninstall_plugin_inner(&app)
        };
        if result.is_err() {
            eprintln!(
                "Codex Halo: unable to {} Plugin",
                if install { "install" } else { "uninstall" }
            );
        }
        show_settings_or_report(&app);
        let status = if result.is_ok() {
            if install {
                "installed"
            } else {
                "uninstalled"
            }
        } else {
            "failed"
        };
        let _ = app.emit_to("settings", "plugin-operation", status);
    });
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

fn helper_setup_best_effort<F>(component: &str, install: F) -> bool
where
    F: FnOnce() -> Result<(), hook_protocol::HookError>,
{
    if install().is_err() {
        eprintln!("Codex Halo: {component} setup failed");
    }
    true
}

#[cfg(test)]
mod tray_tests {
    use super::*;

    #[test]
    fn tray_labels_are_complete_in_english() {
        let mut settings = AppSettings::default();
        settings.enabled = true;

        assert_eq!(
            tray_labels(&settings),
            [
                "Open Settings",
                "Disable overlay",
                "Install Plugin",
                "Uninstall Plugin",
                "Simulate Idle",
                "Simulate Thinking",
                "Simulate Executing",
                "Simulate Input needed",
                "Simulate Completed",
                "Simulate Interrupted",
                "Simulate Compacting",
                "Reset position",
                "Quit",
            ]
        );
    }

    #[test]
    fn tray_labels_are_complete_in_simplified_chinese() {
        let mut settings = AppSettings::default();
        settings.language = "zh-CN".to_owned();
        settings.enabled = true;

        assert_eq!(
            tray_labels(&settings),
            [
                "打开设置",
                "禁用叠加层",
                "安装 Plugin",
                "卸载 Plugin",
                "模拟空闲",
                "模拟思考",
                "模拟执行",
                "模拟需要输入",
                "模拟已完成",
                "模拟已中断",
                "模拟压缩",
                "重置位置",
                "退出",
            ]
        );
    }

    #[test]
    fn tray_labels_select_enable_for_disabled_overlay() {
        let mut settings = AppSettings::default();
        settings.enabled = false;
        assert_eq!(tray_labels(&settings)[1], "Enable overlay");

        settings.language = "zh-CN".to_owned();
        assert_eq!(tray_labels(&settings)[1], "启用叠加层");
    }

    #[test]
    fn settings_window_title_localizes_supported_languages_and_falls_back() {
        assert_eq!(settings_window_title("en"), "Codex Halo Settings");
        assert_eq!(settings_window_title("zh-CN"), "Codex Halo 设置");
        assert_eq!(settings_window_title("fr"), "Codex Halo Settings");
    }
}

fn is_simplified_chinese(language: &str) -> bool {
    language == "zh-CN"
}

fn tray_labels(settings: &AppSettings) -> [&'static str; 13] {
    let chinese = is_simplified_chinese(&settings.language);
    let toggle_overlay = match (chinese, settings.enabled) {
        (true, true) => "禁用叠加层",
        (true, false) => "启用叠加层",
        (false, true) => "Disable overlay",
        (false, false) => "Enable overlay",
    };
    [
        if chinese {
            "打开设置"
        } else {
            "Open Settings"
        },
        toggle_overlay,
        if chinese {
            "安装 Plugin"
        } else {
            "Install Plugin"
        },
        if chinese {
            "卸载 Plugin"
        } else {
            "Uninstall Plugin"
        },
        if chinese {
            "模拟空闲"
        } else {
            "Simulate Idle"
        },
        if chinese {
            "模拟思考"
        } else {
            "Simulate Thinking"
        },
        if chinese {
            "模拟执行"
        } else {
            "Simulate Executing"
        },
        if chinese {
            "模拟需要输入"
        } else {
            "Simulate Input needed"
        },
        if chinese {
            "模拟已完成"
        } else {
            "Simulate Completed"
        },
        if chinese {
            "模拟已中断"
        } else {
            "Simulate Interrupted"
        },
        if chinese {
            "模拟压缩"
        } else {
            "Simulate Compacting"
        },
        if chinese {
            "重置位置"
        } else {
            "Reset position"
        },
        if chinese { "退出" } else { "Quit" },
    ]
}

fn settings_window_title(language: &str) -> &'static str {
    if is_simplified_chinese(language) {
        "Codex Halo 设置"
    } else {
        "Codex Halo Settings"
    }
}

fn update_tray_menu(items: &TrayMenuItems, settings: &AppSettings) {
    let handles = [
        &items.open_settings,
        &items.toggle_overlay,
        &items.install_plugin,
        &items.uninstall_plugin,
        &items.simulate_idle,
        &items.simulate_thinking,
        &items.simulate_executing,
        &items.simulate_input_needed,
        &items.simulate_completed,
        &items.simulate_interrupted,
        &items.simulate_compacting,
        &items.reset_position,
        &items.quit,
    ];
    for (item, label) in handles.into_iter().zip(tray_labels(settings)) {
        if let Err(error) = item.set_text(label) {
            eprintln!("Codex Halo: unable to update tray menu item: {error}");
        }
    }
}

fn build_tray(
    app: &mut tauri::App,
    settings: &AppSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    let items = TrayMenuItems {
        open_settings: MenuItem::with_id(
            app,
            "open-settings",
            "Open Settings",
            true,
            None::<&str>,
        )?,
        toggle_overlay: MenuItem::with_id(
            app,
            "toggle-overlay",
            "Enable overlay",
            true,
            None::<&str>,
        )?,
        install_plugin: MenuItem::with_id(
            app,
            "install-plugin",
            "Install Plugin",
            true,
            None::<&str>,
        )?,
        uninstall_plugin: MenuItem::with_id(
            app,
            "uninstall-plugin",
            "Uninstall Plugin",
            true,
            None::<&str>,
        )?,
        simulate_idle: MenuItem::with_id(
            app,
            "simulate-idle",
            "Simulate Idle",
            true,
            None::<&str>,
        )?,
        simulate_thinking: MenuItem::with_id(
            app,
            "simulate-thinking",
            "Simulate Thinking",
            true,
            None::<&str>,
        )?,
        simulate_executing: MenuItem::with_id(
            app,
            "simulate-executing",
            "Simulate Executing",
            true,
            None::<&str>,
        )?,
        simulate_input_needed: MenuItem::with_id(
            app,
            "simulate-input-needed",
            "Simulate Input needed",
            true,
            None::<&str>,
        )?,
        simulate_completed: MenuItem::with_id(
            app,
            "simulate-completed",
            "Simulate Completed",
            true,
            None::<&str>,
        )?,
        simulate_interrupted: MenuItem::with_id(
            app,
            "simulate-interrupted",
            "Simulate Interrupted",
            true,
            None::<&str>,
        )?,
        simulate_compacting: MenuItem::with_id(
            app,
            "simulate-compacting",
            "Simulate Compacting",
            true,
            None::<&str>,
        )?,
        reset_position: MenuItem::with_id(
            app,
            "reset-position",
            "Reset position",
            true,
            None::<&str>,
        )?,
        quit: MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
    };
    update_tray_menu(&items, settings);

    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let separator_three = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &items.open_settings,
            &items.toggle_overlay,
            &separator_one,
            &items.install_plugin,
            &items.uninstall_plugin,
            &separator_two,
            &items.simulate_idle,
            &items.simulate_thinking,
            &items.simulate_executing,
            &items.simulate_input_needed,
            &items.simulate_completed,
            &items.simulate_interrupted,
            &items.simulate_compacting,
            &items.reset_position,
            &separator_three,
            &items.quit,
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
        "install-plugin" => {
            spawn_tray_plugin_action(app, true);
        }
        "uninstall-plugin" => {
            spawn_tray_plugin_action(app, false);
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
        "simulate-interrupted" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Interrupted, &runtime);
        }
        "simulate-compacting" => {
            let runtime = app.state::<ReducerRuntimeState>();
            let _ = simulate_state_inner(app, HaloState::Compacting, &runtime);
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    let runtime = app.state::<ReducerRuntimeState>();
    *runtime
        .tray_menu
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(items.clone());
    Ok(())
}

fn build_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    if let Some(helper_dir) = hooks::runtime_root().ok() {
        helper_setup_best_effort("hook helper", || {
            hook_protocol::install_bundled_helper(&helper_dir).map(|_| ())
        });
        helper_setup_best_effort("lifecycle watcher", || {
            hook_protocol::install_bundled_watcher(&helper_dir).map(|_| ())
        });
    }

    let settings = load_app_settings(app.handle()).unwrap_or_else(|_| {
        eprintln!("Codex Halo: using default settings");
        AppSettings::default()
    });
    if let Err(error) = lifecycle::sync_app(app.handle(), settings.follow_codex_lifecycle) {
        eprintln!("Codex Halo: codex lifecycle setup failed ({error})");
    }
    let overlay = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Codex Halo")
        .inner_size(112.0, 112.0)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focusable(false)
        .focused(false)
        .accept_first_mouse(true)
        .initialization_script(r#"
            document.addEventListener('pointerdown', (event) => {
                if (event.button !== 0 || !(navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey)) return;
                event.preventDefault();
                window.__TAURI__.core.invoke('begin_overlay_drag', {
                    x: event.clientX, y: event.clientY, width: innerWidth, height: innerHeight
                }).catch((error) => console.error('Codex Halo drag:', error));
            }, { capture: true });
        "#)
        .visible(false)
        .build()?;
    platform::configure_overlay(&overlay)?;
    if let Err(error) = positioning::restore(&overlay, &settings) {
        eprintln!("Codex Halo: unable to position overlay: {error}");
    }
    let handle = app.handle().clone();
    positioning::install(&overlay, move |position| {
        if let Err(error) = save_overlay_position(&handle, position) {
            eprintln!("Codex Halo: {error}");
            let _ = handle.emit_to("settings", "position-save-failed", error);
        }
    });

    let settings_window =
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title(settings_window_title(&settings.language))
            .inner_size(1130.0, 890.0)
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

    build_tray(app, &settings)?;

    Ok(())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if lifecycle::has_lifecycle_stop_marker(std::env::args().skip(1)) {
        app.handle().exit(0);
        return Ok(());
    }
    build_windows(app)
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(ReducerRuntimeState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_single_instance(app, args);
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
            begin_overlay_drag,
            simulate_state,
            install_plugin,
            uninstall_plugin,
            open_settings,
            reset_position,
            set_overlay_visible
        ])
        .setup(setup_app);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Codex Halo");
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::io;
    use std::rc::Rc;

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

    fn write_scan_snapshot(directory: &Path, id: u8, snapshot: Snapshot) {
        fs::create_dir_all(directory).unwrap();
        let filename = format!("{id:064x}.json");
        fs::write(
            directory.join(filename),
            serde_json::to_vec(&snapshot).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn scan_reads_runtime_state_dir_and_ignores_missing_dirs() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-dual-scan-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let runtime = root.join("runtime/state");
        let missing = root.join("missing/state");
        write_scan_snapshot(
            &runtime,
            1,
            Snapshot::new("runtime-session", HaloState::Executing, 10),
        );
        let snapshots = read_runtime_snapshots(&runtime, 25).unwrap();

        assert_eq!(snapshots.len(), 1);
        assert!(snapshots.iter().any(|snapshot| {
            snapshot.session_key == "runtime-session" && snapshot.updated_at_ms == 10
        }));
        assert!(read_runtime_snapshots(&missing, 25).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_installs_helper_at_the_runtime_directory() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-helper-destinations-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let source = root.join("bundled-helper");
        let runtime = root.join("codex-home/codex-halo");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source, b"helper-round-2").unwrap();

        let installed = hook_protocol::install_helper(&source, &runtime).unwrap();
        assert_eq!(fs::read(installed).unwrap(), b"helper-round-2");

        assert!(runtime.join(hooks::helper_filename()).is_file());
        fs::remove_dir_all(root).unwrap();
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
        assert!(helper_setup_best_effort("hook helper", || {
            Err(hook_protocol::HookError::InvalidInput)
        }));
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
    fn legacy_settings_are_backfilled_with_state_colors() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-legacy-settings-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let path = root.join("settings.json");
        fs::create_dir_all(&root).unwrap();

        let mut legacy = serde_json::to_value(AppSettings::default()).unwrap();
        let object = legacy.as_object_mut().unwrap();
        for key in [
            "idle_color",
            "thinking_color",
            "executing_color",
            "input_needed_color",
            "completed_color",
            "interrupted_color",
            "compacting_color",
        ] {
            object.remove(key);
        }
        fs::write(&path, serde_json::to_vec_pretty(&legacy).unwrap()).unwrap();

        let settings = load_settings_file(&path).unwrap();
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();

        assert_eq!(settings, AppSettings::default());
        for key in [
            "idle_color",
            "thinking_color",
            "executing_color",
            "input_needed_color",
            "completed_color",
            "interrupted_color",
            "compacting_color",
        ] {
            assert!(persisted.get(key).is_some(), "missing {key}");
        }
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
            |_| Ok(()),
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
            |_| Ok(()),
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
            |_| Ok(()),
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
            |_| Ok(()),
        );

        assert_eq!(result, Err("start-at-login:reconciliation".to_owned()));
        assert_eq!(native_autostart, current.start_at_login);
        assert!(!settings_committed);
    }

    #[test]
    fn settings_transaction_rolls_back_lifecycle_when_write_fails() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.follow_codex_lifecycle = true;
        let calls = Rc::new(RefCell::new(Vec::new()));
        let login_calls = calls.clone();
        let lifecycle_calls = calls.clone();

        let result = save_settings_transaction(
            &current,
            &next,
            |_settings| Err("write failed".to_owned()),
            |enabled| {
                login_calls.borrow_mut().push(format!("login:{enabled}"));
                Ok(())
            },
            |enabled| {
                lifecycle_calls
                    .borrow_mut()
                    .push(format!("lifecycle:{enabled}"));
                Ok(())
            },
        );

        assert_eq!(result, Err("write failed".to_owned()));
        assert_eq!(
            calls.borrow().as_slice(),
            ["lifecycle:true", "lifecycle:false"]
        );
    }

    #[test]
    fn settings_transaction_does_not_write_when_lifecycle_setup_fails() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.follow_codex_lifecycle = true;
        let mut wrote = false;
        let mut lifecycle_state = current.follow_codex_lifecycle;
        let mut lifecycle_calls = Vec::new();

        let result = save_settings_transaction(
            &current,
            &next,
            |_settings| {
                wrote = true;
                Ok(())
            },
            |_enabled| Ok(()),
            |enabled| {
                lifecycle_state = enabled;
                lifecycle_calls.push(enabled);
                if enabled {
                    Err("codex-lifecycle:registry".to_owned())
                } else {
                    Ok(())
                }
            },
        );

        assert_eq!(result, Err("codex-lifecycle:registry".to_owned()));
        assert!(!wrote);
        assert_eq!(lifecycle_state, current.follow_codex_lifecycle);
        assert_eq!(lifecycle_calls, [true, false]);
    }

    #[test]
    fn settings_transaction_reconciles_lifecycle_when_disabling_setup_fails() {
        let mut current = AppSettings::default();
        current.follow_codex_lifecycle = true;
        let mut next = current.clone();
        next.follow_codex_lifecycle = false;
        let mut wrote = false;
        let mut lifecycle_state = current.follow_codex_lifecycle;
        let mut lifecycle_calls = Vec::new();

        let result = save_settings_transaction(
            &current,
            &next,
            |_settings| {
                wrote = true;
                Ok(())
            },
            |_enabled| Ok(()),
            |enabled| {
                lifecycle_state = enabled;
                lifecycle_calls.push(enabled);
                if !enabled {
                    Err("codex-lifecycle:registry".to_owned())
                } else {
                    Ok(())
                }
            },
        );

        assert_eq!(result, Err("codex-lifecycle:registry".to_owned()));
        assert!(!wrote);
        assert_eq!(lifecycle_state, current.follow_codex_lifecycle);
        assert_eq!(lifecycle_calls, [false, true]);
    }

    #[test]
    fn settings_transaction_restores_both_side_effects_after_write_failure() {
        let current = AppSettings::default();
        let mut next = current.clone();
        next.start_at_login = true;
        next.follow_codex_lifecycle = true;
        let calls = Rc::new(RefCell::new(Vec::new()));
        let login_calls = calls.clone();
        let lifecycle_calls = calls.clone();

        let result = save_settings_transaction(
            &current,
            &next,
            |_settings| Err("write failed".to_owned()),
            |enabled| {
                login_calls.borrow_mut().push(format!("login:{enabled}"));
                Ok(())
            },
            |enabled| {
                lifecycle_calls
                    .borrow_mut()
                    .push(format!("lifecycle:{enabled}"));
                Ok(())
            },
        );

        assert_eq!(result, Err("write failed".to_owned()));
        assert_eq!(
            calls.borrow().as_slice(),
            [
                "login:true",
                "lifecycle:true",
                "lifecycle:false",
                "login:false"
            ]
        );
    }
}

#[cfg(test)]
mod plugin_tests {
    use super::*;

    #[test]
    fn bundled_marketplace_resolution_uses_the_first_valid_root() {
        let root = std::env::temp_dir().join(format!(
            "codex-halo-marketplace-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let invalid = root.join("invalid");
        let valid = root.join("valid");
        fs::create_dir_all(valid.join(".agents/plugins")).unwrap();
        fs::write(valid.join(".agents/plugins/marketplace.json"), b"{}").unwrap();

        assert_eq!(find_marketplace_root([invalid, valid.clone()]), Some(valid));
        fs::remove_dir_all(root).unwrap();
    }
}
