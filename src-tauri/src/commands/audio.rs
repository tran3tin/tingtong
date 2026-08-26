use crate::audio::microphone::MicCapture;
use crate::audio::passthrough::{AudioPassthrough, PassthroughSource};
use crate::audio::SystemAudioCapture;
use serde::Serialize;
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{ipc::Channel, State};

/// State for tracking active audio captures
pub struct AudioState {
    pub system_audio: Mutex<SystemAudioCapture>,
    pub microphone: Mutex<MicCapture>,
    pub system_forwarder: Mutex<Option<AudioForwarder>>,
    pub microphone_forwarder: Mutex<Option<AudioForwarder>>,
    /// Live mic → CABLE Input passthrough (other person hears my original voice).
    pub me_to_remote_passthrough: Mutex<AudioPassthrough>,
    /// Live system loopback → headphones passthrough (I hear other person's voice).
    pub remote_to_me_passthrough: Mutex<AudioPassthrough>,
}

/// Forwards audio from a receiver to a Tauri IPC channel
pub struct AudioForwarder {
    /// Handle to signal stop
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AudioForwarder {
    fn stop(&self) {
        self.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    pub screen_recording: String,
    pub microphone: String,
}

/// Start audio capture and forward data to the frontend via IPC channel.
/// Kept for existing one-way/local mode. It still allows only one active source.
#[tauri::command]
pub fn start_capture(
    source: String,
    channel: Channel<Vec<u8>>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    stop_capture_inner(&state);

    match source.as_str() {
        "system" => start_system_capture(channel, state),
        "microphone" => start_microphone_capture(channel, None, state),
        _ => Err(format!("Unknown source: {}", source)),
    }
}

/// Start system audio capture without stopping microphone capture.
#[tauri::command]
pub fn start_system_capture(
    channel: Channel<Vec<u8>>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    stop_system_capture_inner(&state);

    let receiver = {
        let sys = state.system_audio.lock().map_err(|e| e.to_string())?;
        sys.start()?
    };

    let forwarder = spawn_forwarder(receiver, channel);
    let mut active = state.system_forwarder.lock().map_err(|e| e.to_string())?;
    *active = Some(forwarder);

    Ok(())
}

/// Start microphone capture without stopping system audio capture.
/// `device_name`: empty/"default" → OS default input; otherwise the cpal device name.
#[tauri::command]
pub fn start_microphone_capture(
    channel: Channel<Vec<u8>>,
    device_name: Option<String>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    stop_microphone_capture_inner(&state);

    let receiver = {
        let mut mic = state.microphone.lock().map_err(|e| e.to_string())?;
        mic.start(device_name)?
    };

    let forwarder = spawn_forwarder(receiver, channel);
    let mut active = state.microphone_forwarder.lock().map_err(|e| e.to_string())?;
    *active = Some(forwarder);

    Ok(())
}

/// Stop all audio capture
#[tauri::command]
pub fn stop_capture(state: State<'_, AudioState>) -> Result<(), String> {
    stop_capture_inner(&state);
    Ok(())
}

/// Stop only system audio capture
#[tauri::command]
pub fn stop_system_capture(state: State<'_, AudioState>) -> Result<(), String> {
    stop_system_capture_inner(&state);
    Ok(())
}

/// Stop only microphone capture
#[tauri::command]
pub fn stop_microphone_capture(state: State<'_, AudioState>) -> Result<(), String> {
    stop_microphone_capture_inner(&state);
    Ok(())
}

/// Start a live passthrough: capture `source` and render it continuously into
/// `render_device_id` (the same WASAPI endpoint TTS uses for that direction),
/// so the endpoint receives a mix of live source + TTS.
///   - source "mic"    → mic (my voice) → CABLE Input (other person hears my voice)
///   - source "system" → system loopback → headphones (I hear other person's voice)
/// No IPC channel is needed; audio goes straight to the WASAPI endpoint.
///
/// For "mic": if the MicCapture is already running (two-way mode), we tap its
/// stream instead of opening a second cpal input. Many Bluetooth hands-free
/// mics allow only one capture stream; a second open fails or yields silence.
#[tauri::command]
pub fn start_passthrough(
    source: String,
    render_device_id: String,
    device_name: Option<String>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    // Stop the matching instance first, then (re)start it.
    if source == "mic" {
        let mut pt = state
            .me_to_remote_passthrough
            .lock()
            .map_err(|e| e.to_string())?;
        pt.stop();

        let pt_source = {
            let mic = state.microphone.lock().map_err(|e| e.to_string())?;
            if mic.is_capturing() {
                // Tap the running capture instead of a second cpal stream.
                let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(64);
                mic.install_tap(tx);
                let (rate, channels) = mic.tap_format();
                PassthroughSource::MicTap { receiver: rx, rate, channels }
            } else {
                PassthroughSource::Mic { device_name }
            }
        };
        pt.start(pt_source, render_device_id)?;
    } else if source == "system" {
        let mut pt = state
            .remote_to_me_passthrough
            .lock()
            .map_err(|e| e.to_string())?;
        pt.stop();
        // System loopback source: in the VB-Cable topology the other person's
        // voice plays to CABLE Input (= Windows default render), so loop back
        // the default render endpoint. "default"/empty → default render.
        pt.start(PassthroughSource::System { capture_device_id: "default".to_string() }, render_device_id)?;
    } else {
        return Err(format!("Unknown passthrough source: {}", source));
    }
    Ok(())
}

/// Stop the passthrough for the given source ("mic" | "system").
#[tauri::command]
pub fn stop_passthrough(source: String, state: State<'_, AudioState>) -> Result<(), String> {
    stop_passthrough_inner(&source, &state);
    Ok(())
}

/// Stop both passthroughs.
#[tauri::command]
pub fn stop_all_passthrough(state: State<'_, AudioState>) -> Result<(), String> {
    stop_all_passthrough_inner(&state);
    Ok(())
}

/// Update passthroughs based on current settings (called when checkboxes change mid-session).
#[tauri::command]
pub fn update_passthrough(
    send_to_remote: bool,
    play_to_me: bool,
    send_device_id: String,
    play_device_id: String,
    mic_device_name: Option<String>,
    state: State<'_, AudioState>,
) -> Result<(), String> {
    // Stop all existing passthroughs first
    stop_all_passthrough_inner(&state);

    // Start mic → remote passthrough if enabled
    if send_to_remote {
        let mut pt = state
            .me_to_remote_passthrough
            .lock()
            .map_err(|e| e.to_string())?;

        let pt_source = {
            let mic = state.microphone.lock().map_err(|e| e.to_string())?;
            if mic.is_capturing() {
                // Tap the running capture instead of a second cpal stream.
                let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(64);
                mic.install_tap(tx);
                let (rate, channels) = mic.tap_format();
                PassthroughSource::MicTap { receiver: rx, rate, channels }
            } else {
                PassthroughSource::Mic { device_name: mic_device_name }
            }
        };
        pt.start(pt_source, send_device_id)?;
        println!("[Passthrough] Updated: mic → remote (send_to_remote=true)");
    }

    // Start system loopback → headphones passthrough if enabled
    if play_to_me {
        let mut pt = state
            .remote_to_me_passthrough
            .lock()
            .map_err(|e| e.to_string())?;
        pt.start(
            PassthroughSource::System { capture_device_id: "default".to_string() },
            play_device_id,
        )?;
        println!("[Passthrough] Updated: system → me (play_to_me=true)");
    }

    Ok(())
}

fn stop_passthrough_inner(source: &str, state: &AudioState) {
    if source == "mic" {
        if let Ok(mut pt) = state.me_to_remote_passthrough.lock() {
            pt.stop();
        }
        if let Ok(mic) = state.microphone.lock() {
            mic.clear_tap();
        }
    } else if source == "system" {
        if let Ok(mut pt) = state.remote_to_me_passthrough.lock() {
            pt.stop();
        }
    }
}

fn stop_all_passthrough_inner(state: &AudioState) {
    if let Ok(mut pt) = state.me_to_remote_passthrough.lock() {
        pt.stop();
    }
    if let Ok(mic) = state.microphone.lock() {
        mic.clear_tap();
    }
    if let Ok(mut pt) = state.remote_to_me_passthrough.lock() {
        pt.stop();
    }
}

fn spawn_forwarder(receiver: mpsc::Receiver<Vec<u8>>, channel: Channel<Vec<u8>>) -> AudioForwarder {
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_clone = stop_flag.clone();

    std::thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::with_capacity(32000); // ~1 sec at 16kHz s16le
        let batch_interval = std::time::Duration::from_millis(200);
        let mut last_flush = std::time::Instant::now();

        loop {
            if stop_flag_clone.load(std::sync::atomic::Ordering::SeqCst) {
                if !buffer.is_empty() {
                    let _ = channel.send(buffer.clone());
                }
                break;
            }

            match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
                Ok(data) => {
                    buffer.extend_from_slice(&data);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !buffer.is_empty() {
                        let _ = channel.send(buffer.clone());
                    }
                    break;
                }
            }

            if last_flush.elapsed() >= batch_interval && !buffer.is_empty() {
                if channel.send(buffer.clone()).is_err() {
                    break;
                }
                buffer.clear();
                last_flush = std::time::Instant::now();
            }
        }
    });

    AudioForwarder { stop_flag }
}

fn stop_capture_inner(state: &AudioState) {
    stop_all_passthrough_inner(state);
    stop_system_capture_inner(state);
    stop_microphone_capture_inner(state);
}

fn stop_system_capture_inner(state: &AudioState) {
    if let Ok(mut active) = state.system_forwarder.lock() {
        if let Some(forwarder) = active.take() {
            forwarder.stop();
        }
    }

    if let Ok(sys) = state.system_audio.lock() {
        sys.stop();
    }
}

fn stop_microphone_capture_inner(state: &AudioState) {
    if let Ok(mut active) = state.microphone_forwarder.lock() {
        if let Some(forwarder) = active.take() {
            forwarder.stop();
        }
    }

    if let Ok(mut mic) = state.microphone.lock() {
        mic.stop();
    }
}

/// Check audio capture permissions
#[tauri::command]
pub fn check_permissions() -> PermissionStatus {
    // Note: Actual permission checking on macOS requires Objective-C interop
    // For now, we return "unknown" and permissions will be prompted on first use
    PermissionStatus {
        screen_recording: "unknown".to_string(),
        microphone: "unknown".to_string(),
    }
}
