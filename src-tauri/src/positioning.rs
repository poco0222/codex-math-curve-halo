use crate::state::{AppSettings, OverlayPosition};
use std::cell::RefCell;
use tauri::{Emitter, WebviewWindow, WindowEvent};

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn contains(self, point: OverlayPosition) -> bool {
        point.x >= self.x
            && point.y >= self.y
            && point.x < self.x + self.width
            && point.y < self.y + self.height
    }
}

#[derive(Default)]
struct Gesture {
    grab: Option<OverlayPosition>,
}

impl Gesture {
    fn begin(&mut self, modifier: bool, point: OverlayPosition, frame: Rect) -> bool {
        if !modifier || !frame.contains(point) || self.grab.is_some() {
            return false;
        }
        self.grab = Some(OverlayPosition {
            x: (point.x - frame.x) / frame.width,
            y: (point.y - frame.y) / frame.height,
        });
        true
    }

    fn position(&self, point: OverlayPosition, width: f64, height: f64) -> Option<OverlayPosition> {
        self.grab.map(|grab| OverlayPosition {
            x: point.x - grab.x * width,
            y: point.y - grab.y * height,
        })
    }
}

fn reachable(position: OverlayPosition, width: f64, height: f64, screens: &[Rect]) -> bool {
    // Keep at least a 16-point/pixel square available to grab again.
    screens.iter().any(|screen| {
        (position.x + width).min(screen.x + screen.width) - position.x.max(screen.x) >= 16.0
            && (position.y + height).min(screen.y + screen.height) - position.y.max(screen.y)
                >= 16.0
    })
}

pub fn preserve_position(current: &AppSettings, mut incoming: AppSettings) -> AppSettings {
    // Settings pages may still have a snapshot captured before the last drag.
    incoming.offset_x = current.offset_x;
    incoming.offset_y = current.offset_y;
    incoming.overlay_position = current.overlay_position;
    incoming
}

struct Sample {
    cursor: OverlayPosition,
    frame: Rect,
    modifier: bool,
    left: bool,
    visible: bool,
}

struct DragRuntime {
    window: WebviewWindow,
    gesture: Gesture,
    armed: bool,
    on_finish: Box<dyn Fn(OverlayPosition)>,
}

fn should_arm(was_armed: bool, dragging: bool, sample: &Sample) -> bool {
    sample.visible
        && sample.modifier
        && (dragging
            || if sample.left {
                // Keep the intercepted press armed until the asynchronous WebView IPC arrives.
                was_armed
            } else {
                sample.frame.contains(sample.cursor)
            })
}

thread_local! {
    // Native geometry and gesture state are only touched on the UI thread.
    static DRAG: RefCell<Option<DragRuntime>> = const { RefCell::new(None) };
}

pub fn install(window: &WebviewWindow, on_finish: impl Fn(OverlayPosition) + 'static) {
    DRAG.with(|state| {
        *state.borrow_mut() = Some(DragRuntime {
            window: window.clone(),
            gesture: Gesture::default(),
            armed: false,
            on_finish: Box::new(on_finish),
        });
    });
    let alive = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let flag = alive.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            flag.store(false, std::sync::atomic::Ordering::Release);
            DRAG.with(|state| *state.borrow_mut() = None);
        }
    });
    let window = window.clone();
    std::thread::spawn(move || {
        while alive.load(std::sync::atomic::Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(8));
            let (sent, received) = std::sync::mpsc::sync_channel(0);
            if window
                .run_on_main_thread(move || {
                    tick();
                    let _ = sent.send(());
                })
                .is_err()
                || received.recv().is_err()
            {
                break;
            }
        }
    });
}

pub fn begin(window: WebviewWindow, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if window.label() != "main"
        || ![x, y, width, height].into_iter().all(f64::is_finite)
        || width <= 0.0
        || height <= 0.0
        || x < 0.0
        || y < 0.0
        || x >= width
        || y >= height
    {
        return Err("invalid overlay drag origin".to_owned());
    }
    window
        .run_on_main_thread(move || {
            DRAG.with(|state| {
                let mut state = state.borrow_mut();
                let Some(runtime) = state.as_mut() else {
                    return;
                };
                let Ok(sample) = native::sample(&runtime.window) else {
                    return;
                };
                if !runtime.armed || !sample.left || !sample.visible {
                    return;
                }
                let relative_y = if cfg!(target_os = "macos") {
                    (1.0 - y / height).min(1.0 - f64::EPSILON)
                } else {
                    y / height
                };
                let point = OverlayPosition {
                    x: sample.frame.x + x / width * sample.frame.width,
                    y: sample.frame.y + relative_y * sample.frame.height,
                };
                runtime.gesture.begin(sample.modifier, point, sample.frame);
            })
        })
        .map_err(|_| "overlay drag could not start".to_owned())
}

pub fn cancel(window: &WebviewWindow) {
    let window = window.clone();
    let _ = window.clone().run_on_main_thread(move || {
        DRAG.with(|state| {
            if let Some(runtime) = state.borrow_mut().as_mut() {
                runtime.gesture.grab = None;
                runtime.armed = false;
            }
        });
        let _ = window.set_ignore_cursor_events(true);
    });
}

fn tick() {
    DRAG.with(|state| {
        let mut state = state.borrow_mut();
        let Some(runtime) = state.as_mut() else {
            return;
        };
        let Ok(sample) = native::sample(&runtime.window) else {
            runtime.gesture.grab = None;
            runtime.armed = false;
            let _ = runtime.window.set_ignore_cursor_events(true);
            return;
        };
        if runtime.gesture.grab.is_some() {
            if !sample.modifier || !sample.left || !sample.visible {
                runtime.gesture.grab = None;
                runtime.armed = false;
                let _ = runtime.window.set_ignore_cursor_events(true);
                match ensure_reachable(&runtime.window) {
                    Ok(position) => (runtime.on_finish)(position),
                    Err(error) => {
                        eprintln!("Codex Halo: {error}");
                        let _ = runtime
                            .window
                            .emit_to("settings", "position-save-failed", error);
                    }
                }
                return;
            }
            let (width, height) = native::drag_size(&runtime.window, &sample);
            if let Some(position) = runtime.gesture.position(sample.cursor, width, height) {
                if native::move_for_drag(&runtime.window, position, width, height).is_err() {
                    runtime.gesture.grab = None;
                    runtime.armed = false;
                    let _ = runtime.window.set_ignore_cursor_events(true);
                    eprintln!("Codex Halo: unable to move overlay");
                    return;
                }
            }
        }
        let armed = should_arm(runtime.armed, runtime.gesture.grab.is_some(), &sample);
        if armed != runtime.armed && runtime.window.set_ignore_cursor_events(!armed).is_ok() {
            runtime.armed = armed;
        }
    });
}

pub fn restore(window: &WebviewWindow, settings: &AppSettings) -> Result<OverlayPosition, String> {
    let frame = native::sample(window)?.frame;
    let screens = native::screens(window)?;
    let candidate = match settings.overlay_position {
        Some(position) => position,
        None => native::default_position(window, settings.offset_x, settings.offset_y)?,
    };
    let position = if reachable(candidate, frame.width, frame.height, &screens) {
        candidate
    } else {
        native::default_position(window, 28, 140)?
    };
    native::set_position(window, position)?;
    ensure_reachable(window)
}

fn ensure_reachable(window: &WebviewWindow) -> Result<OverlayPosition, String> {
    let frame = native::sample(window)?.frame;
    let position = OverlayPosition {
        x: frame.x,
        y: frame.y,
    };
    if reachable(
        position,
        frame.width,
        frame.height,
        &native::screens(window)?,
    ) {
        Ok(position)
    } else {
        let position = native::default_position(window, 28, 140)?;
        native::set_position(window, position)?;
        Ok(position)
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSScreen, NSWindow};
    use objc2_foundation::NSPoint;

    fn with_window<T>(window: &WebviewWindow, f: impl FnOnce(&NSWindow) -> T) -> Result<T, String> {
        MainThreadMarker::new().ok_or("overlay geometry requires the main thread")?;
        let pointer = window
            .ns_window()
            .map_err(|_| "overlay window is unavailable")?;
        // Tauri owns this NSWindow for the lifetime of the WebviewWindow.
        Ok(f(unsafe { &*pointer.cast::<NSWindow>() }))
    }

    pub(super) fn sample(window: &WebviewWindow) -> Result<Sample, String> {
        with_window(window, |native| {
            let frame = native.frame();
            let point = NSEvent::mouseLocation();
            Sample {
                cursor: OverlayPosition {
                    x: point.x,
                    y: point.y,
                },
                frame: Rect {
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height,
                },
                modifier: NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Command),
                left: NSEvent::pressedMouseButtons() & 1 != 0,
                visible: native.isVisible() && native.isOnActiveSpace(),
            }
        })
    }

    pub(super) fn set_position(
        window: &WebviewWindow,
        position: OverlayPosition,
    ) -> Result<(), String> {
        with_window(window, |native| {
            native.setFrameOrigin(NSPoint::new(position.x, position.y))
        })
    }

    pub(super) fn move_for_drag(
        window: &WebviewWindow,
        position: OverlayPosition,
        _width: f64,
        _height: f64,
    ) -> Result<(), String> {
        set_position(window, position)
    }

    pub(super) fn screens(_window: &WebviewWindow) -> Result<Vec<Rect>, String> {
        let main = MainThreadMarker::new().ok_or("overlay geometry requires the main thread")?;
        Ok(NSScreen::screens(main)
            .iter()
            .map(|screen| {
                let frame = screen.frame();
                Rect {
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height,
                }
            })
            .collect())
    }

    pub(super) fn default_position(
        window: &WebviewWindow,
        x: i32,
        y: i32,
    ) -> Result<OverlayPosition, String> {
        let screen = screens(window)?
            .into_iter()
            .next()
            .ok_or("primary monitor is unavailable")?;
        let frame = sample(window)?.frame;
        Ok(OverlayPosition {
            x: screen.x + screen.width - frame.width - f64::from(x),
            y: screen.y + f64::from(y),
        })
    }

    pub(super) fn drag_size(_window: &WebviewWindow, sample: &Sample) -> (f64, f64) {
        (sample.frame.width, sample.frame.height)
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::*;
    use tauri::{PhysicalPosition, Position};

    pub(super) fn sample(window: &WebviewWindow) -> Result<Sample, String> {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let cursor = window
            .cursor_position()
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        let (modifier, left) = unsafe {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_CONTROL, VK_LBUTTON,
            };
            (
                GetAsyncKeyState(i32::from(VK_CONTROL)) < 0,
                GetAsyncKeyState(i32::from(VK_LBUTTON)) < 0,
            )
        };
        #[cfg(not(windows))]
        let (modifier, left) = (false, false);
        Ok(Sample {
            cursor: OverlayPosition {
                x: cursor.x,
                y: cursor.y,
            },
            frame: Rect {
                x: f64::from(position.x),
                y: f64::from(position.y),
                width: f64::from(size.width),
                height: f64::from(size.height),
            },
            modifier,
            left,
            visible: window.is_visible().map_err(|error| error.to_string())?,
        })
    }

    pub(super) fn set_position(
        window: &WebviewWindow,
        position: OverlayPosition,
    ) -> Result<(), String> {
        window
            .set_position(Position::Physical(PhysicalPosition::new(
                position.x.round() as i32,
                position.y.round() as i32,
            )))
            .map_err(|error| error.to_string())
    }

    pub(super) fn move_for_drag(
        window: &WebviewWindow,
        position: OverlayPosition,
        width: f64,
        height: f64,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
            };
            let handle = window.hwnd().map_err(|error| error.to_string())?;
            // Size and origin change together so the captured logical grab point survives WM_DPICHANGED.
            if unsafe {
                SetWindowPos(
                    handle.0.cast(),
                    std::ptr::null_mut(),
                    position.x.round() as i32,
                    position.y.round() as i32,
                    width.round() as i32,
                    height.round() as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
            } == 0
            {
                return Err("overlay position could not be changed".to_owned());
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = (width, height);
            set_position(window, position)
        }
    }

    pub(super) fn screens(window: &WebviewWindow) -> Result<Vec<Rect>, String> {
        Ok(window
            .available_monitors()
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|monitor| Rect {
                x: f64::from(monitor.position().x),
                y: f64::from(monitor.position().y),
                width: f64::from(monitor.size().width),
                height: f64::from(monitor.size().height),
            })
            .collect())
    }

    pub(super) fn default_position(
        window: &WebviewWindow,
        x: i32,
        y: i32,
    ) -> Result<OverlayPosition, String> {
        let monitor = window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("primary monitor is unavailable")?;
        let scale = monitor.scale_factor();
        Ok(OverlayPosition {
            x: f64::from(monitor.position().x) + f64::from(monitor.size().width)
                - (112.0 + f64::from(x)) * scale,
            y: f64::from(monitor.position().y) + f64::from(monitor.size().height)
                - (112.0 + f64::from(y)) * scale,
        })
    }

    pub(super) fn drag_size(_window: &WebviewWindow, sample: &Sample) -> (f64, f64) {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::Foundation::POINT;
            use windows_sys::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
            use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
            let monitor = MonitorFromPoint(
                POINT {
                    x: sample.cursor.x.round() as i32,
                    y: sample.cursor.y.round() as i32,
                },
                MONITOR_DEFAULTTONEAREST,
            );
            let (mut x, mut y) = (96, 96);
            if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut x, &mut y) >= 0 {
                return (112.0 * f64::from(x) / 96.0, 112.0 * f64::from(y) / 96.0);
            }
        }
        (sample.frame.width, sample.frame.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Rect {
        Rect {
            x: -500.0,
            y: 200.0,
            width: 112.0,
            height: 112.0,
        }
    }

    #[test]
    fn only_modified_local_press_inside_window_starts_and_preserves_grab_after_dpi_change() {
        let mut gesture = Gesture::default();
        let point = OverlayPosition {
            x: -472.0,
            y: 256.0,
        };
        assert!(!gesture.begin(false, point, frame()));
        assert!(!gesture.begin(true, OverlayPosition { x: 0.0, y: 0.0 }, frame()));
        assert!(gesture.begin(true, point, frame()));
        assert_eq!(
            gesture.position(
                OverlayPosition {
                    x: 100.0,
                    y: -200.0
                },
                224.0,
                224.0
            ),
            Some(OverlayPosition { x: 44.0, y: -312.0 })
        );
    }

    #[test]
    fn saved_window_requires_a_grabbable_area_on_a_connected_screen() {
        assert!(reachable(
            OverlayPosition {
                x: -500.0,
                y: 200.0
            },
            112.0,
            112.0,
            &[frame()]
        ));
        assert!(!reachable(
            OverlayPosition {
                x: -10_000.0,
                y: 200.0
            },
            112.0,
            112.0,
            &[frame()]
        ));
        assert!(!reachable(
            OverlayPosition {
                x: -611.0,
                y: 200.0
            },
            112.0,
            112.0,
            &[frame()]
        ));
    }

    #[test]
    fn stale_settings_snapshot_cannot_overwrite_drag_or_legacy_position() {
        let mut current = AppSettings::default();
        current.offset_x = 123;
        current.overlay_position = Some(OverlayPosition {
            x: -5120.0,
            y: 150.0,
        });
        let mut stale = AppSettings::default();
        stale.opacity = 0.5;
        let merged = preserve_position(&current, stale);
        assert_eq!(merged.overlay_position, current.overlay_position);
        assert_eq!(merged.offset_x, 123);
        assert_eq!(merged.opacity, 0.5);
    }

    #[test]
    fn armed_left_press_survives_poll_before_webview_ipc() {
        let sample = Sample {
            cursor: OverlayPosition {
                x: -472.0,
                y: 256.0,
            },
            frame: frame(),
            modifier: true,
            left: true,
            visible: true,
        };
        assert!(should_arm(true, false, &sample));
        assert!(!should_arm(false, false, &sample));
        assert!(!should_arm(
            true,
            false,
            &Sample {
                modifier: false,
                ..sample
            }
        ));
    }
}
