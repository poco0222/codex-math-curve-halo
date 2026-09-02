use std::fmt;
use std::fs;
use std::io;
use std::path::Path;
use tauri::{AppHandle, PhysicalPosition, Position, Runtime, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;

pub fn configure_overlay(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_ignore_cursor_events(true)
}

pub fn set_overlay_visibility(window: &WebviewWindow, visible: bool) -> tauri::Result<()> {
    if visible {
        window.show()
    } else {
        window.hide()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AutostartError {
    Permission,
    LaunchAgent,
    Registry,
    Unsupported,
}

impl fmt::Display for AutostartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Permission => "start-at-login:permission",
            Self::LaunchAgent => "start-at-login:launch-agent",
            Self::Registry => "start-at-login:registry",
            Self::Unsupported => "start-at-login:unsupported",
        })
    }
}

fn autostart_error<E: fmt::Display>(error: E) -> AutostartError {
    let detail = error.to_string().to_ascii_lowercase();
    if detail.contains("permission denied") || detail.contains("access is denied") {
        return AutostartError::Permission;
    }

    #[cfg(target_os = "macos")]
    {
        AutostartError::LaunchAgent
    }
    #[cfg(target_os = "windows")]
    {
        AutostartError::Registry
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        AutostartError::Unsupported
    }
}

pub fn set_start_at_login<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), AutostartError> {
    if !enabled {
        match app.autolaunch().is_enabled() {
            Ok(false) => return Ok(()),
            Err(error) => return Err(autostart_error(error)),
            Ok(true) => {}
        }
    }

    if enabled {
        app.autolaunch().enable().map_err(autostart_error)
    } else {
        app.autolaunch().disable().map_err(autostart_error)
    }
}

pub fn atomic_replace(source: &Path, target: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source = source
            .as_os_str()
            .encode_wide()
            .chain(once(0))
            .collect::<Vec<_>>();
        let target = target
            .as_os_str()
            .encode_wide()
            .chain(once(0))
            .collect::<Vec<_>>();
        let result = unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        return if result == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        };
    }

    #[cfg(not(windows))]
    fs::rename(source, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_errors_have_stable_redacted_categories() {
        assert_eq!(
            AutostartError::Permission.to_string(),
            "start-at-login:permission"
        );
        assert_eq!(
            AutostartError::LaunchAgent.to_string(),
            "start-at-login:launch-agent"
        );
        assert_eq!(
            AutostartError::Registry.to_string(),
            "start-at-login:registry"
        );
    }
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
    let x =
        monitor.position().x + monitor.size().width as i32 - window_size.width as i32 - offset_x;
    let y =
        monitor.position().y + monitor.size().height as i32 - window_size.height as i32 - offset_y;

    window.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
    Ok(())
}
