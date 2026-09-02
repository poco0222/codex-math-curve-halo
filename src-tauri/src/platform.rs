use tauri::WebviewWindow;

pub fn configure_overlay(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_ignore_cursor_events(true)
}
