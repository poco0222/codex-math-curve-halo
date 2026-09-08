use super::{analysis::Analyzer, Fault, Frame};
use windows::{
    core::Error,
    Wdk::System::SystemServices::RtlGetVersion,
    Win32::{
        Foundation::E_ACCESSDENIED,
        Media::{
            Audio::*,
            KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE},
            Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                COINIT_MULTITHREADED,
            },
            SystemInformation::OSVERSIONINFOW,
        },
    },
};

fn fault(error: Error) -> Fault {
    if error.code() == E_ACCESSDENIED {
        Fault::Permission
    } else {
        Fault::Device
    }
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
struct MixFormat(*mut WAVEFORMATEX);
impl Drop for MixFormat {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.cast())) };
    }
}

pub(super) struct Capture {
    capture: IAudioCaptureClient,
    client: IAudioClient,
    enumerator: IMMDeviceEnumerator,
    device_id: String,
    analyzer: Analyzer,
    channels: usize,
    bytes: usize,
    float: bool,
    // COM interfaces above must release before the owning apartment is uninitialized.
    _apartment: Apartment,
}
unsafe fn device_id(device: &IMMDevice) -> Result<String, Fault> {
    let id = device.GetId().map_err(fault)?;
    let result = id.to_string().map_err(|_| Fault::Device);
    CoTaskMemFree(Some(id.0.cast()));
    result
}
impl Capture {
    pub fn open() -> Result<Self, Fault> {
        unsafe {
            let mut version = OSVERSIONINFOW {
                dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
                ..Default::default()
            };
            if RtlGetVersion(&mut version).0 < 0
                || version.dwMajorVersion < 10
                || (version.dwMajorVersion == 10 && version.dwBuildNumber < 15063)
            {
                return Err(Fault::Unsupported);
            }
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(fault)?;
            let apartment = Apartment;
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(fault)?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(fault)?;
            let id = device_id(&device)?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(fault)?;
            let mix = MixFormat(client.GetMixFormat().map_err(fault)?);
            if mix.0.is_null() {
                return Err(Fault::Device);
            }
            let format = mix.0.read_unaligned();
            let channels = format.nChannels as usize;
            let bits = format.wBitsPerSample;
            let float = match format.wFormatTag as u32 {
                3 => true,
                1 => false,
                WAVE_FORMAT_EXTENSIBLE if format.cbSize >= 22 => {
                    let extended = (mix.0 as *const WAVEFORMATEXTENSIBLE).read_unaligned();
                    let sub_format = extended.SubFormat;
                    if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                        true
                    } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                        false
                    } else {
                        return Err(Fault::Device);
                    }
                }
                _ => return Err(Fault::Device),
            };
            if channels == 0
                || channels > 32
                || format.nSamplesPerSec < 8000
                || (float && ![32, 64].contains(&bits))
                || (!float && ![8, 16, 24, 32].contains(&bits))
                || format.nBlockAlign as usize != channels * (bits as usize / 8)
            {
                return Err(Fault::Device);
            }
            // Poll the shared render mix; no microphone or hardware Stereo Mix device.
            client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    2_000_000,
                    0,
                    mix.0,
                    None,
                )
                .map_err(fault)?;
            let capture: IAudioCaptureClient = client.GetService().map_err(fault)?;
            client.Start().map_err(fault)?;
            let result = Self {
                capture,
                client,
                enumerator,
                device_id: id,
                analyzer: Analyzer::new(format.nSamplesPerSec as f64, channels),
                channels,
                bytes: bits as usize / 8,
                float,
                _apartment: apartment,
            };
            Ok(result)
        }
    }
    pub fn health(&self) -> Result<(), Fault> {
        unsafe {
            let device = self
                .enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(fault)?;
            if device_id(&device)? != self.device_id {
                return Err(Fault::Device);
            }
            self.client.GetCurrentPadding().map_err(fault)?;
            Ok(())
        }
    }
    pub fn poll(&mut self) -> Result<Option<Frame>, Fault> {
        unsafe {
            // A bounded drain also tolerates wake-up backlogs without monopolizing the supervisor.
            for _ in 0..64 {
                if self.capture.GetNextPacketSize().map_err(fault)? == 0 {
                    break;
                }
                let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0, 0);
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(fault)?;
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                if !silent && data.is_null() {
                    let _ = self.capture.ReleaseBuffer(frames);
                    return Err(Fault::Device);
                }
                for frame in 0..frames as usize {
                    for channel in 0..self.channels {
                        let sample = if silent {
                            0.0
                        } else {
                            let ptr = data.add((frame * self.channels + channel) * self.bytes);
                            match (self.float, self.bytes) {
                                (true, 4) => (ptr as *const f32).read_unaligned() as f64,
                                (true, 8) => (ptr as *const f64).read_unaligned(),
                                (false, 1) => (*ptr as f64 - 128.0) / 128.0,
                                (false, 2) => (ptr as *const i16).read_unaligned() as f64 / 32768.0,
                                (false, 3) => {
                                    (((u32::from(*ptr)
                                        | u32::from(*ptr.add(1)) << 8
                                        | u32::from(*ptr.add(2)) << 16)
                                        as i32)
                                        << 8
                                        >> 8) as f64
                                        / 8388608.0
                                }
                                (false, 4) => {
                                    (ptr as *const i32).read_unaligned() as f64 / 2147483648.0
                                }
                                _ => 0.0,
                            }
                        };
                        self.analyzer.sample(channel, sample);
                    }
                }
                self.capture.ReleaseBuffer(frames).map_err(fault)?;
            }
            // WASAPI may produce no packets during silence; a healthy open client is still silent.
            Ok(Some(Frame {
                features: self.analyzer.finish(),
                timestamp_ms: super::now_ms(),
            }))
        }
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = unsafe { self.client.Stop() };
    }
}
