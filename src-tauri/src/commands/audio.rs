use crate::audio::microphone::MicCapture;
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
