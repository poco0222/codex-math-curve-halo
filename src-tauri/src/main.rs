use codex_halo_lib::platform;
use codex_halo_lib::state::{AppSettings, DisplayState, HaloState};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn get_display_state() -> DisplayState {
    DisplayState::idle()
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
fn install_hooks() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn remove_hooks() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn get_hook_status() -> bool {
    false
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

fn build_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
