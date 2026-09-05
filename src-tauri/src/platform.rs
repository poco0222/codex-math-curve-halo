use std::fmt;
#[cfg(not(windows))]
use std::fs;
use std::io;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Command;
use tauri::{AppHandle, PhysicalPosition, Position, Runtime, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::ManagerExt;

#[cfg(test)]
pub(crate) static PROCESS_COMMAND_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    LifecyclePermission,
    LifecycleLaunchAgent,
    LifecycleRegistry,
    LifecycleUnsupported,
}

pub fn quote_windows_run_path(path: &Path) -> String {
    format!("\"{}\"", path.to_string_lossy().replace('"', "\\\""))
}

pub fn lifecycle_windows_command(watcher: &Path, config: &Path) -> String {
    format!(
        "{} --config {}",
        quote_windows_run_path(watcher),
        quote_windows_run_path(config)
    )
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn lifecycle_plist(watcher: &Path, config: &Path) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n\
<dict>\n\
<key>Label</key>\n\
<string>com.codex-halo.lifecycle</string>\n\
<key>ProgramArguments</key>\n\
<array>\n\
<string>{}</string>\n\
<string>--config</string>\n\
<string>{}</string>\n\
</array>\n\
<key>RunAtLoad</key>\n\
<true/>\n\
</dict>\n\
</plist>\n",
        escape_xml(&watcher.to_string_lossy()),
        escape_xml(&config.to_string_lossy())
    )
}

impl fmt::Display for AutostartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Permission => "start-at-login:permission",
            Self::LaunchAgent => "start-at-login:launch-agent",
            Self::Registry => "start-at-login:registry",
            Self::Unsupported => "start-at-login:unsupported",
            Self::LifecyclePermission => "codex-lifecycle:permission",
            Self::LifecycleLaunchAgent => "codex-lifecycle:launch-agent",
            Self::LifecycleRegistry => "codex-lifecycle:registry",
            Self::LifecycleUnsupported => "codex-lifecycle:unsupported",
        })
    }
}

pub fn codex_processes_present() -> io::Result<bool> {
    Ok(process_present_from_listing(
        &process_listing()?,
        &crate::lifecycle::CODEX_PROCESS_NAMES,
    ))
}

pub fn halo_process_present() -> io::Result<bool> {
    Ok(process_present_from_listing(
        &process_listing()?,
        &crate::lifecycle::HALO_PROCESS_NAMES,
    ))
}

fn process_present_from_listing(listing: &str, names: &[&str]) -> bool {
    crate::lifecycle::process_present_from_listing(listing, names)
}

#[cfg(target_os = "macos")]
fn mac_process_listing() -> io::Result<String> {
    let output = Command::new("ps").args(["-axo", "comm="]).output()?;
    if !output.status.success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "process list command failed",
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn windows_process_listing() -> io::Result<String> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()?;
    if !output.status.success() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "process list command failed",
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub(crate) fn process_listing() -> io::Result<String> {
    #[cfg(target_os = "macos")]
    {
        return mac_process_listing();
    }

    #[cfg(target_os = "windows")]
    {
        return windows_process_listing();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "process listing unsupported",
        ))
    }
}

pub fn set_codex_lifecycle_at_login(
    watcher: &Path,
    config: &Path,
    enabled: bool,
) -> Result<(), AutostartError> {
    #[cfg(target_os = "macos")]
    {
        return set_macos_codex_lifecycle_at_login(watcher, config, enabled);
    }

    #[cfg(target_os = "windows")]
    {
        return set_windows_codex_lifecycle_at_login(watcher, config, enabled);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (watcher, config, enabled);
        Err(AutostartError::LifecycleUnsupported)
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LaunchctlFailure {
    EntryAbsent,
    Permission,
    LaunchAgent,
}

#[cfg(target_os = "macos")]
fn set_macos_codex_lifecycle_at_login(
    watcher: &Path,
    config: &Path,
    enabled: bool,
) -> Result<(), AutostartError> {
    let home = std::env::var_os("HOME").ok_or(AutostartError::LifecycleLaunchAgent)?;
    let launch_agents = PathBuf::from(home).join("Library/LaunchAgents");
    let plist_path = launch_agents.join("com.codex-halo.lifecycle.plist");
    let domain = launchctl_domain()?;

    if enabled {
        fs::create_dir_all(&launch_agents).map_err(map_lifecycle_io_error)?;
        fs::write(&plist_path, lifecycle_plist(watcher, config)).map_err(map_lifecycle_io_error)?;
        bootout_launch_agent(&domain, &plist_path)?;
        run_launchctl("bootstrap", &domain, &plist_path).map_err(map_launchctl_failure)
    } else {
        bootout_launch_agent(&domain, &plist_path)?;
        match fs::remove_file(&plist_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(map_lifecycle_io_error(error)),
        }
    }
}

#[cfg(target_os = "macos")]
fn launchctl_domain() -> Result<String, AutostartError> {
    let output = Command::new("id")
        .arg("-u")
        .output()
        .map_err(|_| AutostartError::LifecycleLaunchAgent)?;
    if !output.status.success() {
        return Err(AutostartError::LifecycleLaunchAgent);
    }
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if uid.is_empty() {
        return Err(AutostartError::LifecycleLaunchAgent);
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(target_os = "macos")]
fn run_launchctl(action: &str, domain: &str, plist_path: &Path) -> Result<(), LaunchctlFailure> {
    let output = Command::new("launchctl")
        .arg(action)
        .arg(domain)
        .arg(plist_path)
        .output()
        .map_err(|_| LaunchctlFailure::LaunchAgent)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(classify_launchctl_failure(action, &output.stderr))
    }
}

#[cfg(target_os = "macos")]
fn bootout_launch_agent(domain: &str, plist_path: &Path) -> Result<(), AutostartError> {
    match run_launchctl("bootout", domain, plist_path) {
        Ok(()) | Err(LaunchctlFailure::EntryAbsent) => Ok(()),
        Err(error) => Err(map_launchctl_failure(error)),
    }
}

#[cfg(target_os = "macos")]
fn classify_launchctl_failure(action: &str, stderr: &[u8]) -> LaunchctlFailure {
    let detail = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if detail.contains("permission denied")
        || detail.contains("operation not permitted")
        || detail.contains("not permitted")
    {
        LaunchctlFailure::Permission
    } else if detail.contains("could not find service")
        || detail.contains("service is not loaded")
        || detail.contains("no such process")
        || (action == "bootout" && detail.contains("input/output error"))
    {
        LaunchctlFailure::EntryAbsent
    } else {
        LaunchctlFailure::LaunchAgent
    }
}

#[cfg(target_os = "macos")]
fn map_launchctl_failure(error: LaunchctlFailure) -> AutostartError {
    match error {
        LaunchctlFailure::Permission => AutostartError::LifecyclePermission,
        LaunchctlFailure::EntryAbsent | LaunchctlFailure::LaunchAgent => {
            AutostartError::LifecycleLaunchAgent
        }
    }
}

#[cfg(target_os = "macos")]
fn map_lifecycle_io_error(error: io::Error) -> AutostartError {
    if error.kind() == io::ErrorKind::PermissionDenied {
        AutostartError::LifecyclePermission
    } else {
        AutostartError::LifecycleLaunchAgent
    }
}

#[cfg(target_os = "windows")]
fn set_windows_codex_lifecycle_at_login(
    watcher: &Path,
    config: &Path,
    enabled: bool,
) -> Result<(), AutostartError> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_SET_VALUE, REG_SZ,
    };

    const RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
    const RUN_VALUE: &str = "Codex Halo Lifecycle";
    let key_name = RUN_KEY.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let value_name = RUN_VALUE.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut key: HKEY = null_mut();
    let open_result = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            key_name.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if open_result != ERROR_SUCCESS {
        return if !enabled && open_result == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(map_registry_error(open_result).lifecycle())
        };
    }

    let result = if enabled {
        let command = lifecycle_windows_command(watcher, config);
        let data = command.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        unsafe {
            RegSetValueExW(
                key,
                value_name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr() as *const u8,
                (data.len() * std::mem::size_of::<u16>()) as u32,
            )
        }
    } else {
        let result = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
        if result == ERROR_FILE_NOT_FOUND {
            ERROR_SUCCESS
        } else {
            result
        }
    };
    let close_result = unsafe { RegCloseKey(key) };
    if result != ERROR_SUCCESS {
        Err(map_registry_error(result).lifecycle())
    } else if close_result != ERROR_SUCCESS {
        Err(map_registry_error(close_result).lifecycle())
    } else {
        Ok(())
    }
}

impl AutostartError {
    #[cfg(target_os = "windows")]
    fn lifecycle(self) -> Self {
        match self {
            Self::Permission => Self::LifecyclePermission,
            Self::Registry => Self::LifecycleRegistry,
            other => other,
        }
    }
}

#[cfg(target_os = "macos")]
fn autostart_error<E: fmt::Display>(error: E) -> AutostartError {
    let detail = error.to_string().to_ascii_lowercase();
    if detail.contains("permission denied") || detail.contains("access is denied") {
        return AutostartError::Permission;
    }

    #[cfg(target_os = "macos")]
    {
        AutostartError::LaunchAgent
    }
}

pub fn set_start_at_login<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), AutostartError> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        return set_windows_start_at_login(enabled);
    }

    #[cfg(target_os = "macos")]
    {
        return set_macos_start_at_login(app, enabled);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, enabled);
        Err(AutostartError::Unsupported)
    }
}

#[cfg(target_os = "macos")]
fn set_macos_start_at_login<R: Runtime>(
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

#[cfg(target_os = "windows")]
fn set_windows_start_at_login(enabled: bool) -> Result<(), AutostartError> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_SET_VALUE, REG_SZ,
    };

    const RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
    const RUN_VALUE: &str = "Codex Halo";
    let key_name = RUN_KEY.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let value_name = RUN_VALUE.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut key: HKEY = null_mut();
    let open_result = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            key_name.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if open_result != ERROR_SUCCESS {
        return if !enabled && open_result == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(map_registry_error(open_result))
        };
    }

    let result = if enabled {
        let path = std::env::current_exe().map_err(|_| AutostartError::Registry)?;
        let quoted = quote_windows_run_path(&path);
        let data = quoted.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        unsafe {
            RegSetValueExW(
                key,
                value_name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr() as *const u8,
                (data.len() * std::mem::size_of::<u16>()) as u32,
            )
        }
    } else {
        let result = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
        if result == ERROR_FILE_NOT_FOUND {
            ERROR_SUCCESS
        } else {
            result
        }
    };
    let close_result = unsafe { RegCloseKey(key) };
    if result != ERROR_SUCCESS {
        Err(map_registry_error(result))
    } else if close_result != ERROR_SUCCESS {
        Err(map_registry_error(close_result))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn map_registry_error(code: u32) -> AutostartError {
    use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;

    if code == ERROR_ACCESS_DENIED {
        AutostartError::Permission
    } else {
        AutostartError::Registry
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
    #[cfg(target_os = "macos")]
    use std::env;
    #[cfg(target_os = "macos")]
    use std::fs;
    #[cfg(target_os = "macos")]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(target_os = "macos")]
    use std::time::{SystemTime, UNIX_EPOCH};

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

    #[test]
    fn quotes_windows_run_paths_with_spaces() {
        assert_eq!(
            quote_windows_run_path(Path::new(r#"C:\Program Files\Codex Halo\Codex Halo.exe"#)),
            r#""C:\Program Files\Codex Halo\Codex Halo.exe""#
        );
    }

    #[test]
    fn lifecycle_windows_command_quotes_watcher_and_config() {
        assert_eq!(
            lifecycle_windows_command(
                Path::new(r#"C:\Program Files\Codex Halo\codex-halo-watch.exe"#),
                Path::new(r#"C:\Users\User Name\.codex\codex-halo\lifecycle.json"#),
            ),
            r#""C:\Program Files\Codex Halo\codex-halo-watch.exe" --config "C:\Users\User Name\.codex\codex-halo\lifecycle.json""#,
        );
    }

    #[test]
    fn lifecycle_plist_escapes_xml_values() {
        let plist = lifecycle_plist(Path::new("/tmp/a&b"), Path::new("/tmp/c<d"));
        assert!(plist.contains("/tmp/a&amp;b"));
        assert!(plist.contains("/tmp/c&lt;d"));
    }

    #[test]
    fn lifecycle_errors_use_a_separate_safe_prefix() {
        assert_eq!(
            AutostartError::LifecyclePermission.to_string(),
            "codex-lifecycle:permission"
        );
        assert_eq!(
            AutostartError::LifecycleLaunchAgent.to_string(),
            "codex-lifecycle:launch-agent"
        );
    }

    #[cfg(target_os = "macos")]
    fn bootout_with_fake_launchctl(stderr: &str) -> Result<(), AutostartError> {
        let _lock = PROCESS_COMMAND_ENV_LOCK.lock().unwrap();
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = env::temp_dir().join(format!("codex-halo-launchctl-{suffix}"));
        fs::create_dir_all(&directory).unwrap();
        let launchctl = directory.join("launchctl");
        fs::write(
            &launchctl,
            format!("#!/bin/sh\nprintf '%s' '{stderr}' >&2\nexit 1\n"),
        )
        .unwrap();
        let mut permissions = fs::metadata(&launchctl).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&launchctl, permissions).unwrap();

        let previous_path = env::var_os("PATH");
        let path = previous_path.as_ref().map_or_else(
            || directory.display().to_string(),
            |value| format!("{}:{}", directory.display(), value.to_string_lossy()),
        );
        env::set_var("PATH", path);
        let result = bootout_launch_agent("gui/123", &directory.join("entry.plist"));
        match previous_path {
            Some(value) => env::set_var("PATH", value),
            None => env::remove_var("PATH"),
        }
        fs::remove_dir_all(directory).unwrap();
        result
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn bootout_ignores_only_explicit_absent_entry() {
        assert_eq!(
            bootout_with_fake_launchctl("Could not find service"),
            Ok(())
        );
        assert_eq!(
            bootout_with_fake_launchctl("Boot-out failed: 5: Input/output error"),
            Ok(())
        );
        assert_eq!(
            bootout_with_fake_launchctl("Operation not permitted"),
            Err(AutostartError::LifecyclePermission)
        );
        assert_eq!(
            bootout_with_fake_launchctl("invalid domain"),
            Err(AutostartError::LifecycleLaunchAgent)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn bootout_reports_launchctl_start_failure() {
        let _lock = PROCESS_COMMAND_ENV_LOCK.lock().unwrap();
        let previous_path = env::var_os("PATH");
        env::set_var("PATH", env::temp_dir());
        let result = bootout_launch_agent("gui/123", Path::new("/tmp/entry.plist"));
        match previous_path {
            Some(value) => env::set_var("PATH", value),
            None => env::remove_var("PATH"),
        }
        assert_eq!(result, Err(AutostartError::LifecycleLaunchAgent));
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
