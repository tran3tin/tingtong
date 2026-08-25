//! Per-device audio playback via WASAPI (Windows) + MP3 decode (minimp3).
//!
//! WebView2 does not implement `AudioContext.setSinkId`, so per-output-device
//! routing of TTS was impossible from JS. Instead JS hands the base64 MP3 chunk
//! to this command, which decodes it to PCM and renders it to the *specific*
//! WASAPI endpoint the user chose in Settings (e.g. the real headphones for
//! "read-to-me", or CABLE Input for "send-to-remote").

/// Decode a base64 MP3 buffer into mono i16 PCM.
/// Returns `(pcm_i16_mono, sample_rate_hz)`.
fn decode_mp3(base64_mp3: &str) -> Result<(Vec<i16>, u32), String> {
    use base64::Engine as _;
    use minimp3::{Decoder, Error, Frame};
    use std::io::Cursor;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_mp3)
        .map_err(|e| format!("base64 decode failed: {}", e))?;

    let mut decoder = Decoder::new(Cursor::new(bytes));
    let mut samples: Vec<i16> = Vec::new();
    let mut sample_rate: u32 = 24000;

    loop {
        match decoder.next_frame() {
            Ok(Frame {
                data,
                sample_rate: rate,
                channels,
                ..
            }) => {
                sample_rate = rate as u32;
                // Collapse to mono (take channel 0 / average) so we always
                // render a single mono stream regardless of MP3 channel count.
                if channels == 1 {
                    samples.extend_from_slice(&data);
                } else {
                    for f in data.chunks(channels) {
                        let n = f.len().min(channels);
                        if n == 0 {
                            samples.push(0);
                        } else {
                            let sum: i32 = f[..n].iter().map(|&s| s as i32).sum();
                            samples.push((sum / n as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16);
                        }
                    }
                }
            }
            Err(Error::Eof) => break,
            Err(e) => return Err(format!("MP3 decode error: {:?}", e)),
        }
    }

    if samples.is_empty() {
        return Err("No decodable audio in MP3".into());
    }

    Ok((samples, sample_rate))
}

/// Render mono i16 PCM to the chosen WASAPI output endpoint (or system default).
/// `device_id` may be empty/"default" to use the default render endpoint.
#[cfg(target_os = "windows")]
unsafe fn render_pcm(device_id: &str, pcm: &[i16], sample_rate: u32, volume: f32) -> Result<(), String> {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        .map_err(|e| format!("Create device enumerator: {}", e))?;

    // Resolve target endpoint: by ID, or default render if device is default/empty.
    let device: IMMDevice = if device_id.is_empty() || device_id == "default" {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?
    } else {
        // GetDevice expects a PCWSTR. HSTRING implements Param<PCWSTR>.
        let id = windows::core::HSTRING::from(device_id);
        enumerator
            .GetDevice(&id)
            .map_err(|e| format!("GetDevice '{}': {}", device_id, e))?
    };

    let audio_client: IAudioClient = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate audio client: {}", e))?;

    // Build a mono 16-bit format matching the decoded PCM.
    // AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM lets WASAPI adapt to the actual device
    // format (sample rate / channel count), so 24kHz mono plays on a 48kHz stereo endpoint.
    let mut format: WAVEFORMATEX = std::mem::zeroed();
    format.wFormatTag = WAVE_FORMAT_PCM as u16;
    format.nChannels = 1;
    format.nSamplesPerSec = sample_rate;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = sample_rate * 2;
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

    audio_client.Start().map_err(|e| format!("Start: {:?}", e))?;

    // Write PCM into the device buffer as it drains.
    let mut offset = 0usize;
    let mut io_err: Option<String> = None;
    while offset < pcm.len() && io_err.is_none() {
        let padding: u32 = match audio_client.GetCurrentPadding() {
            Ok(p) => p,
            Err(e) => {
                io_err = Some(format!("GetCurrentPadding: {}", e));
                break;
            }
        };
        let frames_free = buffer_frames.saturating_sub(padding);
        if frames_free == 0 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }

        let frames_to_write = (frames_free as usize).min(pcm.len() - offset);
        let data_ptr: *mut u8 = match render.GetBuffer(frames_to_write as u32) {
            Ok(p) => p,
            Err(e) => {
                io_err = Some(format!("GetBuffer: {:?}", e));
                break;
            }
        };

        let out_slice = std::slice::from_raw_parts_mut(data_ptr as *mut i16, frames_to_write);
        for (dst, src) in out_slice
            .iter_mut()
            .zip(pcm[offset..offset + frames_to_write].iter())
        {
            let scaled = (*src as f32 * volume).clamp(-32767.0, 32767.0);
            *dst = scaled as i16;
        }

        if let Err(e) = render.ReleaseBuffer(frames_to_write as u32, 0) {
            io_err = Some(format!("ReleaseBuffer: {:?}", e));
            break;
        }
        offset += frames_to_write;
    }

    // Drain remaining buffer before stopping (let the tail of the clip play).
    if io_err.is_none() {
        // Sleep for the duration of one buffer worth so the last writes are heard.
        let drain_ms = (buffer_frames as u64).saturating_mul(1000) / (sample_rate.max(1) as u64);
        std::thread::sleep(std::time::Duration::from_millis(drain_ms.max(20)));
    }

    let _ = audio_client.Stop();
    CoUninitialize();

    if let Some(e) = io_err {
        return Err(e);
    }
    Ok(())
}

/// Tauri command: play a base64 MP3 to a specific output device.
/// Runs the blocking WASAPI render on a background thread so the IPC call
/// doesn't block the async runtime. Returns playback duration in ms.
#[tauri::command]
pub async fn play_tts_audio(
    device_id: String,
    base64_mp3: String,
    volume: Option<f32>,
) -> Result<u64, String> {
    if base64_mp3.trim().is_empty() {
        return Err("Empty audio".into());
    }
    let volume = volume.unwrap_or(1.0).clamp(0.0, 2.0);

    // Decode on a blocking thread (CPU-bound, minimp3 is synchronous).
    let (pcm, sample_rate) = tauri::async_runtime::spawn_blocking(move || {
        decode_mp3(&base64_mp3)
    })
    .await
    .map_err(|e| format!("Decode join error: {}", e))??;

    let duration_ms = (pcm.len() as u64).saturating_mul(1000) / (sample_rate.max(1) as u64);

    // Render on a blocking thread (WASAPI writes are synchronous/sleeping).
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || unsafe {
            render_pcm(&device_id, &pcm, sample_rate, volume)
        })
        .await
        .map_err(|e| format!("Render join error: {}", e))??;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (device_id, pcm, sample_rate, volume);
        return Err("Audio playback is only supported on Windows".into());
    }

    Ok(duration_ms)
}
