use super::{analysis::Analyzer, Fault, Frame};
use std::{
    cell::UnsafeCell,
    ffi::c_void,
    sync::atomic::{AtomicBool, Ordering},
    sync::mpsc::{sync_channel, Receiver, SyncSender},
};

unsafe extern "C" {
    fn halo_audio_open(error: *mut i32, rate: *mut f64, channels: *mut u32) -> *mut c_void;
    fn halo_audio_start(
        handle: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void, *const f32, u32, u32, u32, bool),
        context: *mut c_void,
    ) -> i32;
    fn halo_audio_health(handle: *mut c_void) -> i32;
    fn halo_audio_close(handle: *mut c_void, errors: *mut i32);
}
struct Callback {
    analyzer: UnsafeCell<Analyzer>,
    active: AtomicBool,
    sender: SyncSender<Frame>,
}
pub(super) struct Capture {
    handle: *mut c_void,
    callback: Option<Box<Callback>>,
    receiver: Receiver<Frame>,
}
static STOP_FAILED: AtomicBool = AtomicBool::new(false);

fn fault(code: i32) -> Fault {
    match code {
        1 => Fault::Permission,
        2 => Fault::Unsupported,
        _ => Fault::Device,
    }
}
unsafe extern "C" fn samples(
    context: *mut c_void,
    data: *const f32,
    count: u32,
    channels: u32,
    offset: u32,
    last: bool,
) {
    if context.is_null() || data.is_null() || channels == 0 {
        return;
    }
    let callback = &*context.cast::<Callback>();
    if !callback.active.load(Ordering::Acquire) {
        return;
    }
    // Core Audio serializes this IOProc. Only its thread touches the filter state;
    // shutdown shares only the atomic gate and never borrows that mutable state.
    let analyzer = &mut *callback.analyzer.get();
    let values = std::slice::from_raw_parts(data, count as usize);
    for frame in values.chunks_exact(channels as usize) {
        for (channel, value) in frame.iter().enumerate() {
            analyzer.sample(offset as usize + channel, *value as f64);
        }
    }
    if last {
        // A single pending feature frame bounds memory and prevents IPC backlogs.
        let _ = callback.sender.try_send(Frame {
            features: analyzer.finish(),
            timestamp_ms: super::now_ms(),
        });
    }
}
impl Capture {
    pub fn open() -> Result<Self, Fault> {
        if STOP_FAILED.load(Ordering::Acquire) {
            return Err(Fault::RestartRequired);
        }
        let (mut code, mut rate, mut channels) = (0, 0.0, 0);
        let handle = unsafe { halo_audio_open(&mut code, &mut rate, &mut channels) };
        if handle.is_null() {
            return Err(fault(code));
        }
        let (sender, receiver) = sync_channel(1);
        let capture = Self {
            handle,
            callback: Some(Box::new(Callback {
                analyzer: UnsafeCell::new(Analyzer::new(rate, channels as usize)),
                active: AtomicBool::new(true),
                sender,
            })),
            receiver,
        };
        let code = unsafe {
            halo_audio_start(
                handle,
                samples,
                (capture.callback.as_deref().unwrap() as *const Callback)
                    .cast_mut()
                    .cast(),
            )
        };
        if code != 0 {
            return Err(fault(code));
        }
        Ok(capture)
    }
    pub fn poll(&mut self) -> Result<Option<Frame>, Fault> {
        Ok(self.receiver.try_iter().last())
    }
    pub fn health(&self) -> Result<(), Fault> {
        let code = unsafe { halo_audio_health(self.handle) };
        if code == 0 {
            Ok(())
        } else {
            Err(fault(code))
        }
    }
}
fn release_callback(callback: Box<Callback>, io_proc_status: i32, poisoned: &AtomicBool) {
    callback.active.store(false, Ordering::Release);
    if io_proc_status != 0 {
        poisoned.store(true, Ordering::Release);
        // The OS still owns a callback address. Retain it until process exit and
        // refuse future captures; freeing it or opening another stream is unsafe.
        let _ = Box::leak(callback);
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let Some(callback) = self.callback.take() else {
            return;
        };
        callback.active.store(false, Ordering::Release);
        // Destroy the IOProc before Rust releases its callback context.
        let mut errors = [0i32; 4];
        unsafe { halo_audio_close(self.handle, errors.as_mut_ptr()) };
        release_callback(callback, errors[1], &STOP_FAILED);
        if errors != [0; 4] {
            eprintln!("Codex Halo audio teardown [stop, IOProc, aggregate, tap]: {errors:?}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::BTreeSet,
        thread,
        time::{Duration, Instant},
    };

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }
    unsafe extern "C" {
        fn AudioObjectGetPropertyDataSize(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
        ) -> i32;
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }
    fn objects(selector: &[u8; 4]) -> BTreeSet<u32> {
        let address = Address {
            selector: u32::from_be_bytes(*selector),
            scope: u32::from_be_bytes(*b"glob"),
            element: 0,
        };
        let mut size = 0;
        unsafe {
            assert_eq!(
                AudioObjectGetPropertyDataSize(1, &address, 0, std::ptr::null(), &mut size),
                0
            );
            let mut values = vec![0u32; size as usize / 4];
            assert_eq!(
                AudioObjectGetPropertyData(
                    1,
                    &address,
                    0,
                    std::ptr::null(),
                    &mut size,
                    values.as_mut_ptr().cast()
                ),
                0
            );
            values.truncate(size as usize / 4);
            values.into_iter().collect()
        }
    }
    #[test]
    fn failed_io_proc_removal_retains_context_until_process_exit() {
        let poisoned = AtomicBool::new(false);
        let (sender, receiver) = sync_channel(1);
        let callback = Box::new(Callback {
            analyzer: UnsafeCell::new(Analyzer::new(48_000.0, 1)),
            active: AtomicBool::new(true),
            sender,
        });
        let pointer = (&*callback as *const Callback).cast_mut();
        release_callback(callback, -1, &poisoned);
        assert!(poisoned.load(Ordering::Acquire));
        unsafe {
            samples(pointer.cast(), [1.0f32; 8].as_ptr(), 8, 1, 0, true);
        }
        assert_eq!(
            receiver.try_recv().err(),
            Some(std::sync::mpsc::TryRecvError::Empty)
        );
        // No OS owns this test context, so the retained allocation can be reclaimed.
        unsafe {
            drop(Box::from_raw(pointer));
        }
        assert_eq!(
            receiver.try_recv().err(),
            Some(std::sync::mpsc::TryRecvError::Disconnected)
        );

        let (sender, receiver) = sync_channel(1);
        let callback = Box::new(Callback {
            analyzer: UnsafeCell::new(Analyzer::new(48_000.0, 1)),
            active: AtomicBool::new(true),
            sender,
        });
        let healthy = AtomicBool::new(false);
        release_callback(callback, 0, &healthy);
        assert!(!healthy.load(Ordering::Acquire));
        assert_eq!(
            receiver.try_recv().err(),
            Some(std::sync::mpsc::TryRecvError::Disconnected)
        );
    }
    #[test]
    #[ignore = "Captures real system playback for four seconds; run explicitly with playback and macOS permission"]
    fn real_system_audio_smoke() {
        let taps_before = objects(b"tps#");
        let devices_before = objects(b"dev#");
        let mut capture = Capture::open().expect("real system capture must start");
        let own_taps: BTreeSet<_> = objects(b"tps#").difference(&taps_before).copied().collect();
        let own_devices: BTreeSet<_> = objects(b"dev#")
            .difference(&devices_before)
            .copied()
            .collect();
        let start = Instant::now();
        let mut nonzero = [false; 4];
        while start.elapsed() < Duration::from_secs(4) {
            capture.health().expect("default output remains available");
            if let Some(frame) = capture.poll().unwrap() {
                for (seen, value) in nonzero.iter_mut().zip([
                    frame.features.level,
                    frame.features.low,
                    frame.features.mid,
                    frame.features.high,
                ]) {
                    *seen |= value > 0.005;
                }
            }
            thread::sleep(Duration::from_millis(34));
        }
        drop(capture);
        let release_started = Instant::now();
        let immediate_taps = own_taps.is_disjoint(&objects(b"tps#"));
        let immediate_devices = own_devices.is_disjoint(&objects(b"dev#"));
        let mut released = immediate_taps && immediate_devices;
        while !released && release_started.elapsed() < Duration::from_secs(2) {
            thread::sleep(Duration::from_millis(20));
            released = own_taps.is_disjoint(&objects(b"tps#"))
                && own_devices.is_disjoint(&objects(b"dev#"));
        }
        println!("teardown immediate_taps_removed={immediate_taps} immediate_aggregate_removed={immediate_devices} settled_ms={}", release_started.elapsed().as_millis());
        println!("started=true nonzero_level={} nonzero_low={} nonzero_mid={} nonzero_high={} released={released}", nonzero[0], nonzero[1], nonzero[2], nonzero[3]);
        assert!(released, "tap and aggregate must be removed after stop");
        assert!(
            nonzero[0],
            "play system audio while running this ignored smoke test"
        );
    }
}
