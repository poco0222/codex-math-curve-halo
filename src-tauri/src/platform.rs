use tauri::{PhysicalPosition, Position, WebviewWindow};

pub fn configure_overlay(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_ignore_cursor_events(true)
}

pub fn position_overlay(
    window: &WebviewWindow,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    let monitor = window
        .primary_monitor()?
        .ok_or("primary monitor is unavailable")?;
    let window_size = window.inner_size()?;
    let scale_factor = monitor.scale_factor();
    let offset_x = (f64::from(offset_x) * scale_factor).round() as i32;
    let offset_y = (f64::from(offset_y) * scale_factor).round() as i32;
    let x = monitor.position().x + monitor.size().width as i32 - window_size.width as i32 - offset_x;
    let y = monitor.position().y + monitor.size().height as i32 - window_size.height as i32 - offset_y;

    window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    Ok(())
}
