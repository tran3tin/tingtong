/// Soniox TTS — call Soniox REST API for text-to-speech synthesis.

use base64::Engine as _;

const SONIOX_TTS_URL: &str = "https://tts-rt.soniox.com/tts";
const SONIOX_API_URL: &str = "https://api.soniox.com/v1";

/// Fetch available TTS models with their built-in voices from Soniox API.
/// Returns JSON: the full GET response body from /v1/tts-models.
#[tauri::command]
pub async fn soniox_tts_models(api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("Soniox API key not configured".into());
    }

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/tts-models", SONIOX_API_URL))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Soniox TTS models: {}", e))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Soniox TTS models error ({}): {}", status, body));
    }
    Ok(body)
}

/// Synthesize text using Soniox TTS REST API. Returns base64-encoded MP3 audio.
#[tauri::command]
pub async fn soniox_tts_speak(
    text: String,
    voice: String,
    language: String,
    api_key: String,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Empty text".into());
    }
    if api_key.trim().is_empty() {
        return Err("Soniox API key not configured".into());
    }

    let request_body = serde_json::json!({
        "model": "tts-rt-v2",
        "language": language,
        "voice": voice,
        "audio_format": "mp3",
        "text": text,
        "bitrate": 128000,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(SONIOX_TTS_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Soniox TTS request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("Soniox TTS error ({}): {}", status, error_body));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Check if response is an error JSON (non-audio content type)
    if content_type.contains("application/json") {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("Soniox TTS error: {}", error_body));
    }

    // Stream audio bytes into buffer
    let mut audio_data: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream read error: {}", e))?;
        audio_data.extend_from_slice(&chunk);
    }

    if audio_data.is_empty() {
        return Err("No audio received from Soniox TTS".into());
    }

    // Return base64-encoded MP3
    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio_data);
    Ok(b64)
}
