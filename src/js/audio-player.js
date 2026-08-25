/**
 * AudioPlayer — queue-based audio playback.
 *
 * WebView2 does NOT implement `AudioContext.setSinkId`, so per-output-device
 * routing via Web Audio is impossible. Instead, playback is delegated to a
 * Rust WASAPI renderer (`play_tts_audio`), which decodes the base64 MP3 to PCM
 * and writes it directly to the chosen Windows endpoint:
 *   - read-to-me → real headphones (so the user hears the other person)
 *   - send-to-remote → CABLE Input (so the call app's mic picks it up)
 */

const { invoke } = window.__TAURI__.core;

class AudioPlayer {
    constructor(name = 'main', sinkId = 'default') {
        this.name = name;
        this._queue = [];           // [base64Audio] queue
        this._isPlaying = false;
        this._enabled = true;
        this._maxQueueSize = 10;    // Max chunks queued before dropping oldest
        this.onPlaybackStateChange = null; // (isActive: boolean) => void — two-way echo suppression
        this._deviceId = sinkId;    // WASAPI endpoint ID ('default' or from list_audio_devices)
        this._volume = 1.0;         // 0..2
        this._stopped = false;      // guard: stop() flips this so in-flight chain ends
    }

    /**
     * Set output device (Windows WASAPI endpoint id from list_audio_devices).
     * @param {string} deviceId - 'default' or a device id
     */
    async setOutputDevice(deviceId) {
        this._deviceId = deviceId || 'default';
        console.log(`[AudioPlayer:${this.name}] Output device set to:`, this._deviceId);
    }

    get deviceId() {
        return this._deviceId;
    }

    /**
     * Initialize. No-op in the Rust-backed player (no AudioContext to create).
     */
    async init() {
        console.log(`[AudioPlayer:${this.name}] Initialized (Rust WASAPI playback path)`);
    }

    /**
     * Resume — no-op (no autoplay policy in the Rust path; playback is native).
     */
    async resume() {
        this._stopped = false;
    }

    /**
     * Enqueue a base64-encoded audio chunk for playback (MP3 from TTS).
     * @param {string} base64Audio - base64-encoded MP3 data
     */
    async enqueue(base64Audio) {
        if (!this._enabled || !base64Audio) return;

        if (this._queue.length >= this._maxQueueSize) {
            const dropped = this._queue.length - this._maxQueueSize + 1;
            this._queue.splice(0, dropped);
            console.warn(`[AudioPlayer:${this.name}] Dropped ${dropped} stale audio chunk(s)`);
        }

        this._queue.push(base64Audio);
        this._scheduleNext();
    }

    get isActive() {
        return this._isPlaying || this._queue.length > 0;
    }

    async _scheduleNext() {
        if (!this._enabled || this._isPlaying) return;

        if (this._stopped) {
            this._queue = [];
            this._setPlaying(false);
            return;
        }

        const chunk = this._queue.shift();
        if (!chunk) {
            this._setPlaying(false);
            return;
        }

        this._setPlaying(true);
        try {
            await invoke('play_tts_audio', {
                deviceId: this._deviceId,
                base64Mp3: chunk,
                volume: this._volume,
            });
        } catch (err) {
            console.error(`[AudioPlayer:${this.name}] Playback error:`, err);
        }

        // Chain next chunk (if not stopped while this one was playing).
        if (this._stopped) {
            this._queue = [];
            this._setPlaying(false);
        } else if (this._queue.length === 0) {
            this._setPlaying(false);
        } else {
            this._scheduleNext();
        }
    }

    _setPlaying(isActive) {
        if (this._isPlaying !== isActive) {
            this._isPlaying = isActive;
            this.onPlaybackStateChange?.(isActive);
        }
    }

    /**
     * Stop all playback and clear the queue. A currently-rendering Rust command
     * will finish its current MP3 chunk (native, can't be interrupted mid-frame),
     * but nothing further is scheduled.
     */
    stop() {
        this._stopped = true;
        this._queue = [];
        this._setPlaying(false);
    }

    /**
     * Enable/disable playback
     */
    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) {
            this.stop();
        }
    }

    get enabled() {
        return this._enabled;
    }
}

// Two independent players so each direction can target its own output device.
export const audioPlayer = new AudioPlayer('read-to-me', 'default');       // remote→me → headphones
export const remoteAudioPlayer = new AudioPlayer('send-to-remote', 'default'); // me→remote → CABLE Input
