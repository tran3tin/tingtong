/**
 * Soniox TTS — Frontend module
 * Calls Rust backend to proxy Soniox TTS REST API.
 * Returns base64 MP3 audio, played via audioPlayer.
 */

const { invoke } = window.__TAURI__.core;

class SonioxTTS {
    constructor() {
        this.voice = 'Mina';
        this.language = 'vi';
        this.isConnected = false;
        this._queue = [];
        this._isSpeaking = false;

        // Same callback interface as other TTS providers
        this.onAudioChunk = null;  // global fallback (one-way mode → audioPlayer)
        this.onError = null;
        this.onStatusChange = null;
    }

    configure({ voice, language }) {
        if (voice) this.voice = voice;
        if (language) this.language = language;
    }

    connect() {
        this.isConnected = true;
        this._setStatus('connected');
        console.log('[Soniox TTS] Ready via Rust proxy');
    }

    /**
     * Fetch available TTS models and their built-in voices from Soniox API.
     * Returns flat array of voice objects like [{ name, gender, ... }, ...]
     */
    async fetchVoices(apiKey) {
        if (!apiKey) return [];
        const raw = await invoke('soniox_tts_models', { apiKey });
        const parsed = JSON.parse(raw);
        const voices = [];
        if (parsed.models && Array.isArray(parsed.models)) {
            for (const model of parsed.models) {
                if (model.voices && Array.isArray(model.voices)) {
                    for (const v of model.voices) {
                        voices.push({ ...v, model_id: model.id });
                    }
                }
            }
        }
        return voices;
    }

    speak(text, onChunk) {
        if (!text?.trim()) return;
        this._queue.push({ text: text.trim(), onChunk });
        if (!this._isSpeaking) {
            this._processQueue();
        }
    }

    async _processQueue() {
        if (this._queue.length === 0) {
            this._isSpeaking = false;
            return;
        }

        this._isSpeaking = true;
        const item = this._queue.shift();
        const text = item.text;
        const onChunk = item.onChunk;
        const startTime = performance.now();

        try {
            // Get API key from settings
            const { invoke: coreInvoke } = window.__TAURI__.core;
            const settings = await coreInvoke('get_settings');
            const apiKey = settings?.soniox_api_key || '';

            const base64Audio = await invoke('soniox_tts_speak', {
                text: text,
                voice: this.voice,
                language: this.language,
                apiKey: apiKey,
            });

            const elapsed = performance.now() - startTime;
            console.log(`[Soniox TTS] Audio received in ${elapsed.toFixed(0)}ms`);

            // Per-call callback wins (used in two-way mode to route to a specific
            // player); otherwise fall back to the global onAudioChunk (one-way mode).
            if (onChunk) {
                onChunk(base64Audio, true);
            } else if (this.onAudioChunk) {
                this.onAudioChunk(base64Audio, true);
            }
        } catch (err) {
            console.error('[Soniox TTS] Error:', err);
            this.onError?.(`Soniox TTS: ${err}`);
        }

        // Process next in queue
        this._processQueue();
    }

    disconnect() {
        this._queue = [];
        this._isSpeaking = false;
        this.isConnected = false;
        this._setStatus('disconnected');
    }

    _setStatus(status) {
        this.onStatusChange?.(status);
    }
}

export const sonioxTTS = new SonioxTTS();
