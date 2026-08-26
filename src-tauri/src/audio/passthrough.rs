//! Live audio passthrough: continuously capture a source and render it to a
//! WASAPI output endpoint, so the endpoint receives a mix of the live source
//! *plus* any TTS the `play_tts_audio` path renders into the same device.
//!
//! Two uses in two-way VB-Cable mode:
//!   - mic → CABLE Input: the other person hears the user's original voice
//!     alongside the TTS translation.
//!   - system loopback → headphones: the user hears the other person's original
//!     voice alongside the TTS translation.
//!
//! Each passthrough runs two threads: a capture thread (keeps the cpal/WASAPI
//! stream alive and sends interleaved f32 frames to a channel) and a render
//! thread (reads frames and writes them to the target WASAPI endpoint). Both
//! stop when `is_running` flips to false.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

/// What a passthrough captures from.
pub enum PassthroughSource {
    /// Microphone via cpal; `device_name` empty/"default" → OS default input.
    /// Spawns its OWN cpal input stream. Don't use this when the MicCapture is
    /// already running on the same device — many hands-free mics allow only one
    /// capture stream, and a second open fails or yields silence.
    Mic { device_name: Option<String> },
    /// Microphone frames tapped from the already-running MicCapture (no second
    /// cpal stream is opened). `rate`/`channels` are the capture's native format.
    MicTap {
        receiver: mpsc::Receiver<Vec<f32>>,
        rate: u32,
        channels: u16,
    },
    /// System audio via WASAPI loopback of the selected render endpoint.
    /// In the VB-Cable topology this must be the call app's speaker endpoint
    /// (normally CABLE Input), not the Windows default render endpoint.
    System { capture_device_id: String },
}

pub struct AudioPassthrough {
    is_running: Arc<AtomicBool>,
    _thread: Option<JoinHandle<()>>,
}

// The render thread holds WASAPI COM handles; the capture thread holds a cpal
// stream. Both are accessed only through the Mutex in AudioState.
unsafe impl Send for AudioPassthrough {}

impl AudioPassthrough {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
            _thread: None,
        }
    }

    /// Start capturing `source` and rendering it to `render_device_id`
    /// (a WASAPI render endpoint id, or "default"/empty for the system default).
    pub fn start(
        &mut self,
        source: PassthroughSource,
        render_device_id: String,
    ) -> Result<(), String> {
        if self.is_running.load(Ordering::SeqCst) {
            return Err("Passthrough already running".to_string());
        }
        let src_kind = match &source {
            PassthroughSource::Mic { .. } => "mic",
            PassthroughSource::MicTap { .. } => "mic-tap",
            PassthroughSource::System { .. } => "system",
        };
        println!(
            "[Passthrough] start source='{}' render_device_id='{}'",
            src_kind, render_device_id
        );
        self.is_running.store(true, Ordering::SeqCst);
        let is_running = self.is_running.clone();

        // Start the source capture; returns (receiver of f32 frames, rate, channels).
        let (receiver, source_rate, source_channels, source_label) = match source {
            PassthroughSource::Mic { device_name } => {
                let r = spawn_mic_source(device_name, is_running.clone())?;
                (r.0, r.1, r.2, "mic")
            }
            PassthroughSource::MicTap { receiver, rate, channels } => {
                (receiver, rate, channels, "mic-tap")
            }
            PassthroughSource::System { capture_device_id } => {
                let r = spawn_system_source(capture_device_id, is_running.clone())?;
                (r.0, r.1, r.2, "system")
            }
        };

        let render_device_id_cl = render_device_id.clone();
        let is_running_render = is_running.clone();
        let thread = std::thread::spawn(move || {
            #[cfg(target_os = "windows")]
            {
                unsafe {
                    if let Err(e) = run_render_loop(
                        receiver,
                        source_rate,
                        source_channels,
                        render_device_id_cl.clone(),
                        is_running_render,
                    ) {
                        eprintln!(
                            "[Passthrough/{}] render loop exited with error (render_device_id='{}'): {}",
                            source_label, render_device_id_cl, e
                        );
                    } else {
                        println!(
                            "[Passthrough/{}] render loop ended cleanly (render_device_id='{}')",
                            source_label, render_device_id_cl
                        );
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (
                    receiver,
                    source_rate,
                    source_channels,
                    render_device_id_cl,
                    is_running_render,
                );
                eprintln!("[Passthrough] Not supported on this platform");
            }
        });
        self._thread = Some(thread);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(t) = self._thread.take() {
            let _ = t.join();
        }
    }
}

impl Default for AudioPassthrough {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Sources ──────────────────────────────────────────────

/// Capture from a cpal input device, sending interleaved f32 frames.
/// Returns (receiver, sample_rate, channels).
fn spawn_mic_source(
    device_name: Option<String>,
    is_running: Arc<AtomicBool>,
) -> Result<(mpsc::Receiver<Vec<f32>>, u32, u16), String> {
    let host = cpal::default_host();

    let wanted = device_name.unwrap_or_default();
    let device = if !wanted.is_empty() && !wanted.eq_ignore_ascii_case("default") {
        host.input_devices()
            .map_err(|e| format!("Enumerate input devices: {}", e))?
            .find(|d| d.name().ok().as_deref() == Some(wanted.as_str()))
            .ok_or_else(|| format!("Microphone device '{}' not found", wanted))?
    } else {
        host.default_input_device()
            .ok_or("No default microphone found")?
    };

    let supported = device
        .default_input_config()
        .or_else(|_| {
            device
                .supported_input_configs()
                .ok()
                .and_then(|mut configs| configs.next())
                .map(|config| config.with_max_sample_rate())
                .ok_or_else(|| "No supported input config".to_string())
        })?;
    let rate = supported.sample_rate().0;
    let channels = supported.channels();
    let format = supported.sample_format();

    let stream_config = cpal::StreamConfig {
        channels,
        sample_rate: supported.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };

    let (sender, receiver) = mpsc::channel::<Vec<f32>>();
    let is_running_cb = is_running.clone();
    let is_running_keep = is_running.clone();
    let err_fn = |err| eprintln!("[Passthrough/Mic] input error: {}", err);

    std::thread::spawn(move || {
        let stream = match format {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if !is_running_cb.load(Ordering::SeqCst) {
                            return;
                        }
                        let _ = sender.send(data.to_vec());
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let sender = sender.clone();
                let is_running_cb = is_running_cb.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if !is_running_cb.load(Ordering::SeqCst) {
                            return;
                        }
                        let f: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                        let _ = sender.send(f);
                    },
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let sender = sender.clone();
                let is_running_cb = is_running_cb.clone();
                device.build_input_stream(
                    &stream_config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if !is_running_cb.load(Ordering::SeqCst) {
                            return;
                        }
                        let f: Vec<f32> =
                            data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                        let _ = sender.send(f);
                    },
                    err_fn,
                    None,
                )
            }
            f => {
                eprintln!("[Passthrough/Mic] unsupported sample format: {:?}", f);
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Passthrough/Mic] build_input_stream failed: {}", e);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[Passthrough/Mic] play failed: {}", e);
            return;
        }

        // Keep the stream alive on this thread until stopped.
        while is_running_keep.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        drop(stream);
    });

    Ok((receiver, rate, channels))
}

/// Capture system audio via WASAPI loopback, sending interleaved f32 frames
/// at the device's mix format. `capture_device_id` identifies the exact
/// render endpoint to loop back (or "default"/empty for the OS default).
fn spawn_system_source(
    capture_device_id: String,
    is_running: Arc<AtomicBool>,
) -> Result<(mpsc::Receiver<Vec<f32>>, u32, u16), String> {
    let (sender, receiver) = mpsc::channel::<Vec<f32>>();
    let is_running_cap = is_running.clone();
    let capture_device_id_thread = capture_device_id.clone();

    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::Win32::Media::Audio::*;
            use windows::Win32::System::Com::*;

            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let enumerator: IMMDeviceEnumerator = match CoCreateInstance(
                &MMDeviceEnumerator,
                None,
                CLSCTX_ALL,
            ) {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("[Passthrough/System] enumerator: {}", e);
                    return;
                }
            };

            let device = if capture_device_id_thread.is_empty()
                || capture_device_id_thread.eq_ignore_ascii_case("default")
            {
                match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[Passthrough/System] default endpoint: {}", e);
                        return;
                    }
                }
            } else {
                match enumerator.GetDevice(&windows::core::HSTRING::from(
                    &capture_device_id_thread,
                )) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!(
                            "[Passthrough/System] GetDevice('{}'): {}",
                            capture_device_id_thread, e
                        );
                        return;
                    }
                }
            };
            println!(
                "[Passthrough/System] loopback capture device id='{}'",
                capture_device_id_thread
            );

            let audio_client: IAudioClient = match device.Activate(CLSCTX_ALL, None) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Passthrough/System] activate: {}", e);
                    return;
                }
            };

            let mix_format_ptr = match audio_client.GetMixFormat() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[Passthrough/System] mix format: {}", e);
                    return;
                }
            };
            let mix_format = &*mix_format_ptr;
            let source_channels = mix_format.nChannels as u32;

            if let Err(e) = audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000,
                0,
                mix_format_ptr,
                None,
            ) {
                eprintln!("[Passthrough/System] initialize: {}", e);
                return;
            }

            let capture_client: IAudioCaptureClient = match audio_client.GetService() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Passthrough/System] capture client: {}", e);
                    return;
                }
            };

            if let Err(e) = audio_client.Start() {
                eprintln!("[Passthrough/System] start: {}", e);
                return;
            }

            while is_running_cap.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(10));

                let packet_size = match capture_client.GetNextPacketSize() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                if packet_size == 0 {
                    continue;
                }

                let mut buffer_ptr = std::ptr::null_mut();
                let mut num_frames = 0u32;
                let mut flags = 0u32;

                if capture_client
                    .GetBuffer(&mut buffer_ptr, &mut num_frames, &mut flags, None, None)
                    .is_err()
                {
                    continue;
                }

                if num_frames > 0 && !buffer_ptr.is_null() {
                    let is_silent =
                        (flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)) != 0;
                    if !is_silent && mix_format.wBitsPerSample == 32 {
                        let ptr = buffer_ptr as *const f32;
                        let slice = std::slice::from_raw_parts(
                            ptr,
                            num_frames as usize * source_channels as usize,
                        );
                        if sender.send(slice.to_vec()).is_err() {
                            break;
                        }
                    }
                }
                let _ = capture_client.ReleaseBuffer(num_frames);
            }

            let _ = audio_client.Stop();
            CoUninitialize();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (sender, is_running_cap);
            eprintln!("[Passthrough/System] not supported on this platform");
        }
    });

    // On non-Windows we don't know the rate/channels; use harmless defaults so
    // the render thread (also a no-op there) has values. Windows overrides below.
    #[cfg(target_os = "windows")]
    {
        // The capture thread determines the real format from the device. We can't
        // read it back here without extra plumbing, so query the default render
        // endpoint's mix format for a reasonable rate/channels estimate. The
        // render loop uses AUTOCONVERTPCM so an exact match isn't required.
        let (rate, channels) = default_render_format_estimate();
        Ok((receiver, rate, channels))
    }
    #[cfg(not(target_os = "windows"))]
    Ok((receiver, 48000, 2))
}

#[cfg(target_os = "windows")]
fn default_render_format_estimate() -> (u32, u16) {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok().unwrap();
        if let Ok(dev) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            if let Ok(client) = dev.Activate::<IAudioClient>(CLSCTX_ALL, None) {
                if let Ok(fmt) = client.GetMixFormat() {
                    let f = &*fmt;
                    return (f.nSamplesPerSec, f.nChannels);
                }
            }
        }
        (48000, 2)
    }
}

// ─── Render loop (Windows WASAPI) ─────────────────────────

#[cfg(target_os = "windows")]
unsafe fn run_render_loop(
    receiver: mpsc::Receiver<Vec<f32>>,
    source_rate: u32,
    source_channels: u16,
    render_device_id: String,
    is_running: Arc<AtomicBool>,
) -> Result<(), String> {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("Create device enumerator: {}", e))?;

    let device: IMMDevice = if render_device_id.is_empty() || render_device_id == "default" {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?
    } else {
        let id = windows::core::HSTRING::from(&render_device_id);
        enumerator
            .GetDevice(&id)
            .map_err(|e| format!("GetDevice '{}': {}", render_device_id, e))?
    };
    // Log which render endpoint we resolved + its friendly name for debugging.
    {
        use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
        use windows::Win32::System::Com::STGM_READ;
        use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
        use windows::core::BSTR;
        let name = unsafe {
            device
                .OpenPropertyStore(STGM_READ)
                .ok()
                .and_then(|store: IPropertyStore| {
                    store
                        .GetValue(&PKEY_Device_FriendlyName as *const _ as *const _)
                        .ok()
                        .and_then(|prop| BSTR::try_from(&prop).ok())
                        .map(|b| b.to_string())
                })
        }
        .unwrap_or_else(|| "<unknown>".to_string());
        println!(
            "[Passthrough] render endpoint id='{}' name='{}' (src {}ch @ {}Hz)",
            render_device_id, name, source_channels, source_rate
        );
    }

    let audio_client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate audio client: {}", e))?;

    // Render as 16-bit PCM matching the source's rate/channels; AUTOCONVERTPCM
    // adapts to the actual endpoint format (e.g. 16k mono → 48k stereo).
    let channels = source_channels.max(1);
    let mut format: WAVEFORMATEX = std::mem::zeroed();
    format.wFormatTag = WAVE_FORMAT_PCM as u16;
    format.nChannels = channels;
    format.nSamplesPerSec = source_rate;
    format.wBitsPerSample = 16;
    format.nBlockAlign = (channels * 2) as u16;
    format.nAvgBytesPerSec = source_rate * (channels as u32) * 2;
    format.cbSize = 0;

    audio_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            30_000_000 / 100, // 30ms buffer (hns)
            0,
            &format,
            None,
        )
        .map_err(|e| format!("Initialize render client: {:?}", e))?;

    let buffer_frames: u32 = audio_client
        .GetBufferSize()
        .map_err(|e| format!("GetBufferSize: {}", e))?;

    let render: IAudioRenderClient = audio_client
        .GetService()
        .map_err(|e| format!("GetService IAudioRenderClient: {}", e))?;

    audio_client
        .Start()
        .map_err(|e| format!("Start: {:?}", e))?;

    // Accumulate source samples, write whole frames to the device.
    let mut leftover: Vec<f32> = Vec::new();
    let chan = channels as usize;

    while is_running.load(Ordering::SeqCst) {
        match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(chunk) => leftover.extend_from_slice(&chunk),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Write as many whole frames as fit in the free buffer.
        loop {
            if !is_running.load(Ordering::SeqCst) {
                break;
            }
            let padding = match audio_client.GetCurrentPadding() {
                Ok(p) => p,
                Err(_) => break,
            };
            let free = match buffer_frames.checked_sub(padding) {
                Some(f) => f,
                None => break,
            };
            if free == 0 {
                break;
            }
            let frames_available = leftover.len() / chan;
            if frames_available == 0 {
                break;
            }
            let frames_to_write = (free as usize).min(frames_available);
            let sample_count = frames_to_write * chan;

            let data_ptr: *mut u8 = match render.GetBuffer(frames_to_write as u32) {
                Ok(p) => p,
                Err(_) => break,
            };
            let out_slice =
                std::slice::from_raw_parts_mut(data_ptr as *mut i16, sample_count);
            for (dst, &src) in out_slice
                .iter_mut()
                .zip(leftover[..sample_count].iter())
            {
                let s = (src.clamp(-1.0, 1.0) * 32767.0) as i16;
                *dst = s;
            }
            if render.ReleaseBuffer(frames_to_write as u32, 0).is_err() {
                break;
            }
            leftover.drain(..sample_count);
        }
    }

    let _ = audio_client.Stop();
    CoUninitialize();
    Ok(())
}
