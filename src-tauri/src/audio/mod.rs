mod analysis;
mod control;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub generation: u64,
    pub sequence: u64,
    pub timestamp_ms: i64,
    pub status: &'static str,
    pub reason: Option<&'static str>,
    pub level: f64,
    pub low: f64,
    pub mid: f64,
    pub high: f64,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            generation: 0,
            sequence: 0,
            timestamp_ms: 0,
            status: "disabled",
            reason: None,
            level: 0.0,
            low: 0.0,
            mid: 0.0,
            high: 0.0,
        }
    }
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::Capture;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows::Capture;

use control::Control;
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
#[derive(Clone, Copy, Debug)]
pub(super) enum Fault {
    #[cfg(target_os = "macos")]
    RestartRequired,
    Permission,
    Unsupported,
    Device,
    Disconnected,
}
pub(super) struct Frame {
    features: analysis::Features,
    timestamp_ms: i64,
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
struct Capture;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl Capture {
    fn open() -> Result<Self, Fault> {
        Err(Fault::Unsupported)
    }
    fn poll(&mut self) -> Result<Option<Frame>, Fault> {
        Ok(None)
    }
    fn health(&self) -> Result<(), Fault> {
        Ok(())
    }
}

type Shared = Arc<(Mutex<Control>, Condvar)>;
pub struct AudioRuntime {
    shared: Shared,
    thread: Mutex<Option<JoinHandle<()>>>,
}
impl AudioRuntime {
    pub fn new(emit: impl Fn(Snapshot) + Send + 'static) -> Self {
        let shared = Arc::new((Mutex::new(Control::default()), Condvar::new()));
        let worker = shared.clone();
        let thread = thread::Builder::new()
            .name("halo-system-audio".into())
            .spawn(move || run(worker, emit))
            .expect("audio supervisor thread");
        Self {
            shared,
            thread: Mutex::new(Some(thread)),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.shared
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .clone()
    }
    pub fn configure(&self, enabled: bool, visible: bool) -> Snapshot {
        self.update(|control| {
            if control.enabled == enabled && control.visible == visible {
                return false;
            }
            if control.enabled != enabled {
                control.blocked = None;
            }
            control.enabled = enabled;
            control.visible = visible;
            true
        })
    }
    pub fn motion_preference(&self, reduced: bool) -> Snapshot {
        self.update(|control| {
            if control.reduced_motion == Some(reduced) {
                return false;
            }
            control.reduced_motion = Some(reduced);
            true
        })
    }
    pub fn retry(&self) -> Snapshot {
        self.update(|control| {
            control.blocked = None;
            true
        })
    }
    fn update(&self, apply: impl FnOnce(&mut Control) -> bool) -> Snapshot {
        let mut control = self.shared.0.lock().unwrap_or_else(|e| e.into_inner());
        if !control.exit && apply(&mut control) {
            control.refresh();
            self.shared.1.notify_one();
        }
        control.snapshot.clone()
    }
    pub fn shutdown(&self) {
        self.update(|control| {
            control.exit = true;
            true
        });
        if let Some(thread) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = thread.join();
        }
    }
}
impl Drop for AudioRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn run(shared: Shared, emit: impl Fn(Snapshot)) {
    let interval = Duration::from_millis(34);
    let mut capture: Option<Capture> = None;
    let mut generation = u64::MAX;
    let mut attempts = 0;
    let mut next_open = Instant::now();
    let mut last_health = Instant::now();
    let mut stable_since = Instant::now();
    let mut last_emit = Instant::now() - interval;
    let mut emitted_generation = u64::MAX;
    let mut last_tick_ms = now_ms();
    loop {
        let mut control = shared.0.lock().unwrap_or_else(|e| e.into_inner());
        if control.exit {
            drop(control);
            drop(capture);
            return;
        }
        if control.snapshot.generation != generation {
            generation = control.snapshot.generation;
            attempts = 0;
            next_open = Instant::now();
            // Drop outside the mutex: an OS stop may wait for its final callback.
            drop(control);
            capture = None;
            control = shared.0.lock().unwrap_or_else(|e| e.into_inner());
            if control.snapshot.generation != generation {
                continue;
            }
        }
        control.expire(now_ms());
        if last_emit.elapsed() >= interval
            && (emitted_generation != generation || capture.is_some())
        {
            control.snapshot.sequence += 1;
            emit(control.snapshot.clone());
            emitted_generation = generation;
            last_emit = Instant::now();
        }
        if !control.runnable() {
            if emitted_generation == generation {
                drop(shared.1.wait(control).unwrap_or_else(|e| e.into_inner()));
            } else {
                drop(
                    shared
                        .1
                        .wait_timeout(control, interval)
                        .unwrap_or_else(|e| e.into_inner()),
                );
            }
            last_tick_ms = now_ms();
            continue;
        }
        drop(control);
        let tick_ms = now_ms();
        let woke = tick_ms.saturating_sub(last_tick_ms) > 2_000;
        last_tick_ms = tick_ms;
        let result = if capture.is_some() && woke {
            eprintln!("Codex Halo audio: phase=wake-reconnect");
            Err(Fault::Disconnected)
        } else if let Some(device) = capture.as_mut() {
            let mut result = device.poll();
            if let Err(fault) = &result {
                eprintln!("Codex Halo audio: phase=poll fault={fault:?}");
            }
            if last_health.elapsed() >= Duration::from_secs(1) {
                if let Err(fault) = device.health() {
                    eprintln!("Codex Halo audio: phase=health fault={fault:?}");
                    result = Err(fault);
                }
                last_health = Instant::now();
            }
            result
        } else if Instant::now() >= next_open {
            eprintln!("Codex Halo audio: phase=open");
            match Capture::open() {
                Ok(device) => {
                    eprintln!("Codex Halo audio: phase=open outcome=started");
                    capture = Some(device);
                    last_health = Instant::now();
                    stable_since = Instant::now();
                    last_tick_ms = now_ms();
                    Ok(None)
                }
                Err(fault) => {
                    eprintln!("Codex Halo audio: phase=open fault={fault:?}");
                    Err(fault)
                }
            }
        } else {
            Ok(None)
        };
        let mut control = shared.0.lock().unwrap_or_else(|e| e.into_inner());
        if control.snapshot.generation != generation {
            continue;
        }
        match result {
            Ok(Some(frame)) => {
                if now_ms().saturating_sub(frame.timestamp_ms) <= 500 {
                    control.accept(generation, frame.features, frame.timestamp_ms);
                    if stable_since.elapsed() >= Duration::from_secs(10) {
                        attempts = 0;
                    }
                }
            }
            Ok(None) => {
                // A healthy tap-only aggregate waits for playback (Apple's
                // TapAutoStart contract); normal silence must not consume retries.
                if capture.is_some() {
                    control.waiting_for_audio(generation, now_ms());
                }
            }
            Err(fault) => {
                attempts += 1;
                control.blocked = match fault {
                    #[cfg(target_os = "macos")]
                    Fault::RestartRequired => Some(("error", "restart_required")),
                    Fault::Permission => Some(("permission_denied", "permission")),
                    Fault::Unsupported => Some(("unsupported", "unsupported")),
                    Fault::Device | Fault::Disconnected if attempts >= 3 => Some((
                        "error",
                        if matches!(fault, Fault::Disconnected) {
                            "disconnected"
                        } else {
                            "device"
                        },
                    )),
                    _ => None,
                };
                control.refresh();
                if control.blocked.is_none() {
                    control.snapshot.reason = Some("device");
                }
                generation = control.snapshot.generation;
                next_open = Instant::now() + Duration::from_millis(500 * attempts);
                drop(control);
                capture = None;
                control = shared.0.lock().unwrap_or_else(|e| e.into_inner());
            }
        }
        let delay = wake_delay(
            last_emit,
            next_open,
            capture.is_some(),
            emitted_generation != control.snapshot.generation,
            Instant::now(),
        );
        drop(
            shared
                .1
                .wait_timeout(control, delay)
                .unwrap_or_else(|e| e.into_inner()),
        );
    }
}

fn wake_delay(
    last_emit: Instant,
    next_open: Instant,
    capturing: bool,
    pending: bool,
    now: Instant,
) -> Duration {
    if !capturing && !pending && next_open > now {
        return next_open.duration_since(now);
    }
    Duration::from_millis(34)
        .saturating_sub(now.saturating_duration_since(last_emit))
        .max(Duration::from_millis(1))
}

#[cfg(test)]
mod runtime_tests {
    use super::*;
    #[test]
    fn retry_backoff_sleeps_until_the_next_attempt_but_new_state_is_prompt() {
        let now = Instant::now();
        let last = now - Duration::from_millis(100);
        let retry = now + Duration::from_millis(500);
        assert_eq!(
            wake_delay(last, retry, false, false, now),
            Duration::from_millis(500)
        );
        assert!(wake_delay(last, retry, false, true, now) <= Duration::from_millis(34));
    }
}
