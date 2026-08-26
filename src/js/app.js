/**
 * App — main application controller
 * Wires together: settings, UI, Soniox client, and audio capture
 */

import { settingsManager } from './settings.js';
import { TranscriptUI } from './ui.js';
import { sonioxClient, SonioxClient } from './soniox.js';
import { elevenLabsTTS } from './elevenlabs-tts.js';
import { googleTTS } from './google-tts.js';
import { edgeTTSRust } from './edge-tts.js';
import { sonioxTTS } from './soniox-tts.js';
import { audioPlayer, remoteAudioPlayer } from './audio-player.js';

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

const EDGE_VOICE_BY_LANG = {
    vi: 'vi-VN-HoaiMyNeural',
    en: 'en-US-JennyNeural',
    ja: 'ja-JP-NanamiNeural',
    ko: 'ko-KR-SunHiNeural',
    zh: 'zh-CN-XiaoxiaoNeural',
};

class App {
    constructor() {
        this.isRunning = false;
        this.isStarting = false; // Guard against re-entry
        this.currentSource = 'system'; // 'system' | 'microphone'
        this.translationMode = 'soniox'; // 'soniox' | 'local'
        this.transcriptUI = null;
        this.appWindow = getCurrentWindow();
        this.localPipelineChannel = null;
        this.localPipelineReady = false;
        this.recordingStartTime = null;
        this.ttsEnabled = false;  // TTS runtime toggle
        this.isPinned = true;     // Always-on-top state
        this.isCompact = false;   // Compact mode (hide control bar)
        this.remoteSonioxClient = null;
        this.localSonioxClient = null;
        this.twoWayDirection = 'one_way';
        this.ttsRemoteToMeEnabled = false; // Two-way: read remote→me translations
        this.ttsMeToRemoteEnabled = false; // Two-way: read me→remote translations
        this._isTTSPlaying = false;        // any TTS rendering (echo suppression for mic)
        this._isRemoteTTSPlaying = false; // send-to-remote rendering specifically
    }

    async init() {
        // Load settings
        await settingsManager.load();

        // Init transcript UI
        const transcriptContainer = document.getElementById('transcript-content');
        this.transcriptUI = new TranscriptUI(transcriptContainer);

        // Check platform — hide Local MLX on non-Apple-Silicon
        await this._checkPlatformSupport();

        // Apply saved settings to UI
        this._applySettings(settingsManager.get());

        // Bind event listeners
        this._bindEvents();

        // Bind keyboard shortcuts
        this._bindKeyboardShortcuts();

        // Subscribe to settings changes
        settingsManager.onChange((settings) => this._applySettings(settings));

        // Pre-load Soniox TTS voices if provider is soniox
        const ttsProvider = settingsManager.get().tts_provider || 'edge';
        if (ttsProvider === 'soniox') {
            this._loadSonioxVoices();
        }

        // Init audio players for TTS (Rust WASAPI render to chosen device).
        audioPlayer.init();
        remoteAudioPlayer.init();

        // Either player being active means "TTS is playing" → drop mic audio to
        // suppress the echo loop (call app mic would otherwise pick TTS up).
        audioPlayer.onPlaybackStateChange = (isActive) => this._syncTTSEchoFlag();
        remoteAudioPlayer.onPlaybackStateChange = (isActive) => this._syncTTSEchoFlag();

        // Wire TTS audio callbacks for providers that use the global audioPlayer
        // (one-way mode). Two-way mode routes per-call (see _speakTwoWayIfEnabled).
        for (const tts of [elevenLabsTTS, edgeTTSRust, googleTTS, sonioxTTS]) {
            tts.onAudioChunk = (base64Audio, isFinal) => {
                audioPlayer.enqueue(base64Audio);
            };
        }
        for (const tts of [elevenLabsTTS, edgeTTSRust, googleTTS, sonioxTTS]) {
            tts.onError = (error) => {
                console.error('[TTS]', error);
                this._showToast(error, 'error');
            };
        }

        // Window position restore disabled — causes issues on Retina displays
        // await this._restoreWindowPosition();

        console.log('🌐 My Translator v0.5.0 initialized');
    }

    async _checkPlatformSupport() {
        try {
            // Check if we're on macOS Apple Silicon
            const arch = await invoke('get_platform_info');
            const info = JSON.parse(arch);
            this.isAppleSilicon = (info.os === 'macos' && info.arch === 'aarch64');
        } catch {
            // Fallback: check via navigator
            this.isAppleSilicon = navigator.platform === 'MacIntel' &&
                navigator.userAgent.includes('Mac OS X');
        }

        if (!this.isAppleSilicon) {
            // Hide Local MLX option
            const select = document.getElementById('select-translation-mode');
            const localOption = select?.querySelector('option[value="local"]');
            if (localOption) localOption.remove();

            // Force soniox mode if user had local selected
            const settings = settingsManager.get();
            if (settings.translation_mode === 'local') {
                settings.translation_mode = 'soniox';
                settingsManager.save(settings);
            }
        }
    }

    // ─── Event Binding ──────────────────────────────────────

    _bindEvents() {
        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            this._showView('settings');
        });

        // Back from settings
        document.getElementById('btn-back').addEventListener('click', () => {
            this._showView('overlay');
        });

        // Close button (overlay)
        document.getElementById('btn-close').addEventListener('click', async () => {
            if (this.transcriptUI.hasSegments()) {
                await this._saveTranscriptFile();
            }
            await this._saveWindowPosition();
            await this.stop();
            await this.appWindow.close();
        });

        // Minimize button
        document.getElementById('btn-minimize').addEventListener('click', async () => {
            await this._saveWindowPosition();
            await this.appWindow.minimize();
        });

        // Pin/Unpin button
        document.getElementById('btn-pin').addEventListener('click', () => {
            this._togglePin();
        });

        // Compact mode button
        document.getElementById('btn-compact').addEventListener('click', () => {
            this._toggleCompact();
        });

        // View mode toggle (dual panel)
        document.getElementById('btn-view-mode').addEventListener('click', () => {
            this._toggleViewMode();
        });

        // Font size quick controls
        document.getElementById('btn-font-up').addEventListener('click', () => this._adjustFontSize(4));
        document.getElementById('btn-font-down').addEventListener('click', () => this._adjustFontSize(-4));

        // Color dot controls
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                const color = dot.dataset.color;
                this.transcriptUI.configure({ fontColor: color });
            });
        });

        // Start/Stop button
        document.getElementById('btn-start').addEventListener('click', async () => {
            if (this.isStarting) return; // Prevent re-entry
            try {
                if (this.isRunning) {
                    await this.stop();
                } else {
                    this.isStarting = true;
                    await this.start();
                }
            } catch (err) {
                console.error('[App] Start/Stop error:', err);
                this._showToast(`Error: ${err}`, 'error');
                this.isRunning = false;
                this._updateStartButton();
                this._updateStatus('error');
                this.transcriptUI.clear();
                this.transcriptUI.showPlaceholder();
            } finally {
                this.isStarting = false;
            }
        });

        // Source buttons
        document.getElementById('btn-source-system').addEventListener('click', () => {
            this._setSource('system');
        });

        document.getElementById('btn-source-mic').addEventListener('click', () => {
            this._setSource('microphone');
        });

        // Clear button — save transcript file then clear
        document.getElementById('btn-clear').addEventListener('click', async () => {
            if (this.transcriptUI.hasSegments()) {
                await this._saveTranscriptFile();
            }
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            this.recordingStartTime = null;
        });

        // Copy transcript button
        document.getElementById('btn-copy').addEventListener('click', async () => {
            const text = this.transcriptUI.getPlainText();
            if (text) {
                await navigator.clipboard.writeText(text);
                this._showToast('Copied to clipboard', 'success');
            } else {
                this._showToast('Nothing to copy', 'info');
            }
        });

        // Open saved transcripts folder
        document.getElementById('btn-open-transcripts').addEventListener('click', async () => {
            try {
                await invoke('open_transcript_dir');
            } catch (err) {
                this._showToast('Failed to open folder: ' + err, 'error');
            }
        });

        // Settings form elements
        this._bindSettingsForm();

        // Manual drag for settings view
        // data-tauri-drag-region doesn't work well when parent contains buttons
        // Using Tauri's recommended appWindow.startDragging() approach instead
        document.getElementById('settings-view')?.addEventListener('mousedown', (e) => {
            const interactive = e.target.closest('button, input, select, label, a, textarea, .settings-section, .settings-actions');
            if (!interactive && e.buttons === 1) {
                e.preventDefault();
                this.appWindow.startDragging();
            }
        });

        // Toggle API key visibility
        document.getElementById('btn-toggle-key').addEventListener('click', () => {
            const input = document.getElementById('input-api-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        // Translation mode toggle
        document.getElementById('select-translation-mode').addEventListener('change', (e) => {
            this._updateModeUI(e.target.value);
        });

        // Translation direction toggle
        document.querySelectorAll('input[name="translation-direction"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this._updateDirectionUI(document.querySelector('input[name="translation-direction"]:checked')?.value || 'one_way');
            });
        });

        // Soniox link
        document.getElementById('link-soniox').addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://console.soniox.com/signup/');
        });

        // ElevenLabs link
        document.getElementById('link-elevenlabs')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.__TAURI__.opener.openUrl('https://elevenlabs.io/app/sign-up');
        });

        // Save settings — both top and bottom buttons
        document.getElementById('btn-save-settings').addEventListener('click', () => {
            this._saveSettingsFromForm();
        });
        document.getElementById('btn-save-settings-top')?.addEventListener('click', () => {
            this._saveSettingsFromForm();
        });

        // Slider live updates
        document.getElementById('range-opacity').addEventListener('input', (e) => {
            document.getElementById('opacity-value').textContent = `${e.target.value}%`;
        });

        document.getElementById('range-font-size').addEventListener('input', (e) => {
            document.getElementById('font-size-value').textContent = `${e.target.value}px`;
        });

        document.getElementById('range-max-lines').addEventListener('input', (e) => {
            document.getElementById('max-lines-value').textContent = e.target.value;
        });

        // Toggle ElevenLabs API key visibility
        document.getElementById('btn-toggle-elevenlabs-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-elevenlabs-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('btn-toggle-google-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-google-tts-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        // Settings tab switching
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab)?.classList.add('active');
            });
        });

        // TTS enable/disable toggle in settings — show/hide detail
        document.getElementById('check-tts-enabled')?.addEventListener('change', (e) => {
            const detail = document.getElementById('tts-settings-detail');
            if (detail) detail.style.display = e.target.checked ? '' : 'none';
        });

        // TTS provider toggle — show/hide relevant settings panels
        document.getElementById('select-tts-provider')?.addEventListener('change', (e) => {
            this._updateTTSProviderUI(e.target.value);
        });

        // Soniox voice dropdown — reconfigure active TTS immediately so the
        // selected voice takes effect even before the user clicks "Save".
        document.getElementById('select-soniox-voice')?.addEventListener('change', (e) => {
            const saved = settingsManager.get();
            if (saved.tts_provider === 'soniox') {
                const tts = this._getActiveTTS();
                this._configureTTS(tts, { ...saved, soniox_tts_voice: e.target.value });
                console.log('[App] Soniox voice changed →', e.target.value);
            }
        });

        // TTS speed slider — show value
        document.getElementById('range-tts-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('tts-speed-value');
            if (label) label.textContent = e.target.value + 'x';
        });

        // Edge TTS speed slider
        document.getElementById('range-edge-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('edge-speed-value');
            const v = parseInt(e.target.value);
            if (label) label.textContent = (v >= 0 ? '+' : '') + v + '%';
        });

        document.getElementById('range-google-speed')?.addEventListener('input', (e) => {
            const label = document.getElementById('google-speed-value');
            if (label) label.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
        });

        // Add translation term row
        document.getElementById('btn-add-term')?.addEventListener('click', () => {
            this._addTermRow('', '');
        });

        // TTS toggle button in overlay
        document.getElementById('btn-tts').addEventListener('click', () => {
            this._toggleTTS();
        });

        document.getElementById('btn-tts-remote-to-me')?.addEventListener('click', () => {
            this._toggleTwoWayTTS('remote_to_me');
        });

        document.getElementById('btn-tts-me-to-remote')?.addEventListener('click', () => {
            this._toggleTwoWayTTS('me_to_remote');
        });

        // Two-way TTS output device dropdowns (WASAPI render endpoints)
        document.getElementById('select-tts-read-to-me-device')?.addEventListener('change', async (e) => {
            const deviceValue = e.target.value;
            await settingsManager.save({ tts_read_to_me_device: deviceValue });
            audioPlayer.setOutputDevice(deviceValue);
            console.log('[App] Read-to-me device:', deviceValue);
        });

        document.getElementById('select-tts-send-to-remote-device')?.addEventListener('change', async (e) => {
            const deviceValue = e.target.value;
            await settingsManager.save({ tts_send_to_remote_device: deviceValue });
            remoteAudioPlayer.setOutputDevice(deviceValue);
            console.log('[App] Send-to-remote device:', deviceValue);
        });

        document.getElementById('select-two-way-audio-mode')?.addEventListener('change', async (e) => {
            const mode = e.target.value;
            await settingsManager.save({ two_way_audio_mode: mode });
            this._updateTwoWayAudioModeUI(mode);
        });

        document.getElementById('check-send-original-voice')?.addEventListener('change', async (e) => {
            const sendToRemote = e.target.checked;
            await settingsManager.save({ send_original_voice_to_remote: sendToRemote });
            // Update passthrough live if two-way session is active
            if (this.isRunning && this.twoWayDirection === 'two_way') {
                const s = settingsManager.get();
                try {
                    await invoke('update_passthrough', {
                        sendToRemote,
                        playToMe: s.play_original_voice_to_me,
                        sendDeviceId: s.tts_send_to_remote_device || 'default',
                        playDeviceId: s.tts_read_to_me_device || 'default',
                        micDeviceName: s.microphone_device && s.microphone_device !== 'default' ? s.microphone_device : null,
                    });
                    this._showToast(sendToRemote ? 'Gửi giọng gốc ON 🔊' : 'Gửi giọng gốc OFF 🔇', 'success');
                } catch (err) {
                    console.error('[App] Failed to update passthrough:', err);
                    this._showToast(`Lỗi cập nhật passthrough: ${err}`, 'error');
                }
            }
        });
        document.getElementById('check-play-original-voice')?.addEventListener('change', async (e) => {
            const playToMe = e.target.checked;
            await settingsManager.save({ play_original_voice_to_me: playToMe });
            // Update passthrough live if two-way session is active
            if (this.isRunning && this.twoWayDirection === 'two_way') {
                const s = settingsManager.get();
                try {
                    await invoke('update_passthrough', {
                        sendToRemote: s.send_original_voice_to_remote,
                        playToMe,
                        sendDeviceId: s.tts_send_to_remote_device || 'default',
                        playDeviceId: s.tts_read_to_me_device || 'default',
                        micDeviceName: s.microphone_device && s.microphone_device !== 'default' ? s.microphone_device : null,
                    });
                    this._showToast(playToMe ? 'Nghe giọng gốc ON 🔊' : 'Nghe giọng gốc OFF 🔇', 'success');
                } catch (err) {
                    console.error('[App] Failed to update passthrough:', err);
                    this._showToast(`Lỗi cập nhật passthrough: ${err}`, 'error');
                }
            }
        });

        document.getElementById('select-mic-device')?.addEventListener('change', async (e) => {
            const deviceValue = e.target.value;
            await settingsManager.save({ microphone_device: deviceValue });
            console.log('[App] Microphone device saved:', deviceValue);
        });

        // Wire Soniox callbacks
        sonioxClient.onOriginal = (text, speaker) => {
            this.transcriptUI.addOriginal(text, speaker);
        };

        sonioxClient.onTranslation = (text) => {
            this.transcriptUI.addTranslation(text);
            this._speakIfEnabled(text);
        };

        sonioxClient.onProvisional = (text, speaker) => {
            if (text) {
                this.transcriptUI.setProvisional(text, speaker);
            } else {
                this.transcriptUI.clearProvisional();
            }
        };

        sonioxClient.onStatusChange = (status) => {
            this._updateStatus(status);
        };

        sonioxClient.onError = (error) => {
            this._showToast(error, 'error');
        };
    }

    _bindSettingsForm() {
        // These are handled in _populateSettingsForm and _saveSettingsFromForm
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────

    _bindKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore when typing in input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Cmd/Ctrl + Enter: Start/Stop
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (this.isStarting) return;
                (async () => {
                    try {
                        if (this.isRunning) {
                            await this.stop();
                        } else {
                            this.isStarting = true;
                            await this.start();
                        }
                    } catch (err) {
                        console.error('[App] Keyboard start/stop error:', err);
                        this._showToast(`Error: ${err}`, 'error');
                        this.isRunning = false;
                        this._updateStartButton();
                        this._updateStatus('error');
                    } finally {
                        this.isStarting = false;
                    }
                })();
            }

            // Escape: Go back to overlay / close settings
            if (e.key === 'Escape') {
                e.preventDefault();
                const settingsVisible = document.getElementById('settings-view').classList.contains('active');
                if (settingsVisible) {
                    this._showView('overlay');
                }
            }

            // Cmd/Ctrl + ,: Open settings
            if ((e.metaKey || e.ctrlKey) && e.key === ',') {
                e.preventDefault();
                this._showView('settings');
            }

            // Cmd/Ctrl + 1: Switch to System Audio
            if ((e.metaKey || e.ctrlKey) && e.key === '1') {
                e.preventDefault();
                this._setSource('system');
            }

            // Cmd/Ctrl + 2: Switch to Microphone
            if ((e.metaKey || e.ctrlKey) && e.key === '2') {
                e.preventDefault();
                this._setSource('microphone');
            }

            // Cmd/Ctrl + T: Toggle TTS
            if ((e.metaKey || e.ctrlKey) && e.key === 't') {
                e.preventDefault();
                this._toggleTTS();
            }

            // Cmd/Ctrl + M: Minimize
            if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
                e.preventDefault();
                this._saveWindowPosition();
                this.appWindow.minimize();
            }

            // Cmd/Ctrl + P: Toggle Pin
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault();
                this._togglePin();
            }

            // Cmd/Ctrl + D: Toggle Compact
            if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                e.preventDefault();
                this._toggleCompact();
            }
        });
    }

    // ─── Views ──────────────────────────────────────────────

    _showView(view) {
        document.getElementById('overlay-view').classList.toggle('active', view === 'overlay');
        document.getElementById('settings-view').classList.toggle('active', view === 'settings');

        if (view === 'settings') {
            this._populateSettingsForm();
            // Load Soniox voices if Soniox is selected
            const provider = document.getElementById('select-tts-provider')?.value;
            if (provider === 'soniox') {
                this._loadSonioxVoices();
            }
        }
    }

    // ─── Settings Form ─────────────────────────────────────

    _populateSettingsForm() {
        const s = settingsManager.get();

        document.getElementById('input-api-key').value = s.soniox_api_key || '';
        document.getElementById('select-source-lang').value = s.source_language || 'auto';
        document.getElementById('select-target-lang').value = s.target_language || 'vi';
        document.getElementById('select-translation-mode').value = s.translation_mode || 'soniox';
        const direction = s.translation_direction || 'one_way';
        const directionRadio = document.querySelector(`input[name="translation-direction"][value="${direction}"]`);
        if (directionRadio) directionRadio.checked = true;
        document.getElementById('select-my-language').value = s.my_language || 'vi';
        document.getElementById('select-other-language').value = s.other_language || 'en';
        const audioModeSelect = document.getElementById('select-two-way-audio-mode');
        if (audioModeSelect) audioModeSelect.value = s.two_way_audio_mode || 'vb_cable';
        this._updateTwoWayAudioModeUI(audioModeSelect?.value || 'vb_cable');
        document.getElementById('check-two-way-tts').checked = s.two_way_tts_enabled !== false;
        document.getElementById('check-two-way-mute-original-mic').checked = !!s.two_way_mute_original_mic;
        document.getElementById('check-send-original-voice').checked = !!s.send_original_voice_to_remote;
        document.getElementById('check-play-original-voice').checked = !!s.play_original_voice_to_me;
        this._updateModeUI(s.translation_mode || 'soniox');
        this._updateDirectionUI(direction);

        // Audio source radio
        const radioValue = s.audio_source || 'system';
        const radio = document.querySelector(`input[name="audio-source"][value="${radioValue}"]`);
        if (radio) radio.checked = true;

        // Display
        const opacityPercent = Math.round((s.overlay_opacity || 0.85) * 100);
        document.getElementById('range-opacity').value = opacityPercent;
        document.getElementById('opacity-value').textContent = `${opacityPercent}%`;

        document.getElementById('range-font-size').value = s.font_size || 16;
        document.getElementById('font-size-value').textContent = `${s.font_size || 16}px`;

        document.getElementById('range-max-lines').value = s.max_lines || 5;
        document.getElementById('max-lines-value').textContent = s.max_lines || 5;

        document.getElementById('check-show-original').checked = s.show_original !== false;

        // Custom context
        const ctx = s.custom_context;
        document.getElementById('input-context-domain').value = ctx?.domain || '';
        // Load translation terms as rows
        const termsList = document.getElementById('translation-terms-list');
        if (termsList) {
            termsList.innerHTML = '';
            const terms = ctx?.translation_terms || [];
            terms.forEach(t => this._addTermRow(t.source, t.target));
        }

        // TTS settings
        document.getElementById('input-elevenlabs-key').value = s.elevenlabs_api_key || '';
        document.getElementById('select-tts-voice').value = s.tts_voice_id || '21m00Tcm4TlvDq8ikWAM';
        // Edge TTS settings
        const edgeVoiceSelect = document.getElementById('select-edge-voice');
        if (edgeVoiceSelect) edgeVoiceSelect.value = s.edge_tts_voice || 'vi-VN-HoaiMyNeural';
        const edgeSpeedSlider = document.getElementById('range-edge-speed');
        const edgeSpeedLabel = document.getElementById('edge-speed-value');
        const edgeSpeed = s.edge_tts_speed !== undefined ? s.edge_tts_speed : 20;
        if (edgeSpeedSlider) edgeSpeedSlider.value = edgeSpeed;
        if (edgeSpeedLabel) edgeSpeedLabel.textContent = (edgeSpeed >= 0 ? '+' : '') + edgeSpeed + '%';

        // Google TTS settings
        const googleKeyInput = document.getElementById('input-google-tts-key');
        if (googleKeyInput) googleKeyInput.value = s.google_tts_api_key || '';
        const googleVoiceSelect = document.getElementById('select-google-voice');
        if (googleVoiceSelect) googleVoiceSelect.value = s.google_tts_voice || 'vi-VN-Chirp3-HD-Aoede';
        const googleSpeedSlider = document.getElementById('range-google-speed');
        const googleSpeedLabel = document.getElementById('google-speed-value');
        const googleSpeed = s.google_tts_speed || 1.0;
        if (googleSpeedSlider) googleSpeedSlider.value = googleSpeed;
        if (googleSpeedLabel) googleSpeedLabel.textContent = googleSpeed + 'x';

        // Soniox TTS settings
        const sonioxVoiceSelect = document.getElementById('select-soniox-voice');
        if (sonioxVoiceSelect) sonioxVoiceSelect.value = s.soniox_tts_voice || 'Mina';

        // TTS provider
        const providerSelect = document.getElementById('select-tts-provider');
        if (providerSelect) {
            providerSelect.value = s.tts_provider || 'edge';
            this._updateTTSProviderUI(providerSelect.value);
        }
    }

    async _saveSettingsFromForm() {
        const settings = {
            soniox_api_key: document.getElementById('input-api-key').value.trim(),
            source_language: document.getElementById('select-source-lang').value,
            target_language: document.getElementById('select-target-lang').value,
            translation_mode: document.getElementById('select-translation-mode').value,
            translation_direction: document.querySelector('input[name="translation-direction"]:checked')?.value || 'one_way',
            my_language: document.getElementById('select-my-language')?.value || 'vi',
            other_language: document.getElementById('select-other-language')?.value || 'en',
            two_way_audio_mode: document.getElementById('select-two-way-audio-mode')?.value || 'vb_cable',
            send_original_voice_to_remote: !!document.getElementById('check-send-original-voice')?.checked,
            play_original_voice_to_me: !!document.getElementById('check-play-original-voice')?.checked,
            two_way_tts_enabled: document.getElementById('check-two-way-tts')?.checked !== false,
            two_way_mute_original_mic: !!document.getElementById('check-two-way-mute-original-mic')?.checked,
            audio_source: document.querySelector('input[name="audio-source"]:checked')?.value || 'system',
            overlay_opacity: parseInt(document.getElementById('range-opacity').value) / 100,
            font_size: parseInt(document.getElementById('range-font-size').value),
            max_lines: parseInt(document.getElementById('range-max-lines').value),
            show_original: document.getElementById('check-show-original').checked,
            custom_context: null,
        };

        // Parse custom context
        const domain = document.getElementById('input-context-domain').value.trim();
        const translationTerms = [];
        document.querySelectorAll('#translation-terms-list .term-row').forEach(row => {
            const source = row.querySelector('.term-source')?.value.trim();
            const target = row.querySelector('.term-target')?.value.trim();
            if (source && target) translationTerms.push({ source, target });
        });

        if (domain || translationTerms.length > 0) {
            settings.custom_context = {
                domain: domain || null,
                translation_terms: translationTerms,
            };
        }

        // TTS settings
        settings.tts_provider = document.getElementById('select-tts-provider')?.value || 'edge';
        settings.elevenlabs_api_key = document.getElementById('input-elevenlabs-key').value.trim();
        settings.tts_voice_id = document.getElementById('select-tts-voice').value;
        settings.edge_tts_voice = document.getElementById('select-edge-voice')?.value || 'vi-VN-HoaiMyNeural';
        settings.edge_tts_speed = parseInt(document.getElementById('range-edge-speed')?.value || 20);
        settings.tts_speed = parseFloat(document.getElementById('range-tts-speed')?.value || 1.2);
        settings.google_tts_api_key = document.getElementById('input-google-tts-key')?.value.trim() || '';
        settings.google_tts_voice = document.getElementById('select-google-voice')?.value || 'vi-VN-Chirp3-HD-Aoede';
        settings.google_tts_speed = parseFloat(document.getElementById('range-google-speed')?.value || 1.0);
        settings.soniox_tts_voice = document.getElementById('select-soniox-voice')?.value || 'Mina';
        settings.tts_enabled = false;
        // Two-way TTS output devices (WASAPI render endpoints)
        settings.tts_read_to_me_device = document.getElementById('select-tts-read-to-me-device')?.value || 'default';
        settings.tts_send_to_remote_device = document.getElementById('select-tts-send-to-remote-device')?.value || 'default';
        // Two-way microphone input device (cpal device name; 'default' = OS default)
        settings.microphone_device = document.getElementById('select-mic-device')?.value || 'default';

        try {
            await settingsManager.save(settings);
            this._showToast('Settings saved', 'success');
            this._showView('overlay');
        } catch (err) {
            this._showToast(`Failed to save: ${err}`, 'error');
        }
    }

    // ─── Apply Settings ────────────────────────────────────

    _applySettings(settings) {
        // Update overlay opacity
        const overlayView = document.getElementById('overlay-view');
        overlayView.style.opacity = settings.overlay_opacity || 0.85;

        // Update transcript UI
        if (this.transcriptUI) {
            this.transcriptUI.configure({
                maxLines: settings.max_lines || 5,
                showOriginal: settings.show_original !== false,
                fontSize: settings.font_size || 16,
            });
            this.transcriptUI.setTwoWayMode((settings.translation_direction || 'one_way') === 'two_way');
        }

        this.twoWayDirection = settings.translation_direction || 'one_way';

        // Two-way TTS toggles always start OFF — user enables per session via overlay buttons
        this.ttsRemoteToMeEnabled = false;
        this.ttsMeToRemoteEnabled = false;
        this._updateTwoWayTTSButtons();

        // Update current source button states
        this.currentSource = settings.audio_source === 'both' ? 'system' : (settings.audio_source || 'system');
        this._updateSourceButtons();

        // TTS is always OFF on app start — user must toggle on each session
        this.ttsEnabled = false;
        this._updateTTSButton();

        // Apply per-device TTS output routing (read-to-me / send-to-remote).
        if (settings.tts_read_to_me_device && settings.tts_read_to_me_device !== 'default') {
            audioPlayer.setOutputDevice(settings.tts_read_to_me_device);
        }
        if (settings.tts_send_to_remote_device && settings.tts_send_to_remote_device !== 'default') {
            remoteAudioPlayer.setOutputDevice(settings.tts_send_to_remote_device);
        }

        // Populate the device dropdowns from the OS (async, fire-and-forget).
        this._populateDeviceDropdown('select-tts-read-to-me-device', settings.tts_read_to_me_device || 'default');
        this._populateDeviceDropdown('select-tts-send-to-remote-device', settings.tts_send_to_remote_device || 'default');
        this._populateMicrophoneDropdown(settings.microphone_device || 'default');
    }

    /**
     * Populate a TTS output-device dropdown from list_audio_devices.
     */
    async _populateDeviceDropdown(selectId, currentId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        const keepDefault = () => {
            // Preserve the static "System Default" option that ships in the HTML.
            while (select.options.length > 1) select.remove(1);
        };

        try {
            const devices = await invoke('list_audio_devices');
            keepDefault();
            if (!Array.isArray(devices) || devices.length === 0) return;
            for (const dev of devices) {
                const opt = document.createElement('option');
                opt.value = dev.id;
                opt.textContent = dev.name + (dev.is_default ? '  (default)' : '');
                select.appendChild(opt);
            }
            if (currentId && currentId !== 'default') select.value = currentId;
        } catch (err) {
            console.warn('[App] list_audio_devices failed:', err);
            keepDefault();
        }
    }

    /**
     * Populate a microphone input dropdown from active Windows capture endpoints.
     */
    async _populateMicrophoneDropdown(currentName) {
        const select = document.getElementById('select-mic-device');
        if (!select) return;

        while (select.options.length > 1) select.remove(1);
        try {
            const devices = await invoke('list_microphone_devices');
            if (!Array.isArray(devices)) return;
            for (const dev of devices) {
                const opt = document.createElement('option');
                // cpal resolves input devices by their friendly name.
                opt.value = dev.name;
                opt.textContent = dev.name + (dev.is_default ? '  (default)' : '');
                select.appendChild(opt);
            }
            if (currentName && currentName !== 'default') select.value = currentName;
        } catch (err) {
            console.warn('[App] list_microphone_devices failed:', err);
        }
    }

    // ─── TTS Control ──────────────────────────────────────

    _toggleTTS() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';

        // Check API key for premium providers
        if (provider === 'elevenlabs' && !settings.elevenlabs_api_key) {
            this._showToast('Add ElevenLabs API key in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }
        if (provider === 'google' && !settings.google_tts_api_key) {
            this._showToast('Add Google TTS API key in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }
        if (provider === 'soniox' && !settings.soniox_api_key) {
            this._showToast('Add Soniox API key in Settings → TTS', 'error');
            this._showView('settings');
            return;
        }

        this.ttsEnabled = !this.ttsEnabled;
        this._updateTTSButton();

        const tts = this._getActiveTTS();

        if (this.ttsEnabled) {
            this._configureTTS(tts, settings);
            if (this.isRunning) {
                tts.connect();
                audioPlayer.resume();
            }
            const label = { edge: 'Edge TTS (Free)', google: 'Google Chirp 3 HD', elevenlabs: 'ElevenLabs', soniox: 'Soniox TTS' }[provider] || provider;
            this._showToast(`TTS narration ON 🔊 (${label})`, 'success');
        } else {
            tts.disconnect();
            audioPlayer.stop();
            this._showToast('TTS narration OFF 🔇', 'success');
        }
    }

    _toggleTwoWayTTS(direction) {
        if (direction === 'remote_to_me') {
            this.ttsRemoteToMeEnabled = !this.ttsRemoteToMeEnabled;
            this._showToast(this.ttsRemoteToMeEnabled ? 'TTS nghe ON 🔊' : 'TTS nghe OFF 🔇', 'success');
        } else {
            this.ttsMeToRemoteEnabled = !this.ttsMeToRemoteEnabled;
            this._showToast(this.ttsMeToRemoteEnabled ? 'TTS gửi ON 🔊' : 'TTS gửi OFF 🔇', 'success');
        }

        if ((this.ttsRemoteToMeEnabled || this.ttsMeToRemoteEnabled) && this.isRunning) {
            edgeTTSRust.connect();
            audioPlayer.resume();
            remoteAudioPlayer.resume();
        } else if (!this.ttsRemoteToMeEnabled && !this.ttsMeToRemoteEnabled) {
            edgeTTSRust.disconnect();
            audioPlayer.stop();
            remoteAudioPlayer.stop();
        }

        this._updateTwoWayTTSButtons();
    }

    _getActiveTTS() {
        const settings = settingsManager.get();
        const provider = settings.tts_provider || 'edge';
        if (provider === 'elevenlabs') return elevenLabsTTS;
        if (provider === 'google') return googleTTS;
        if (provider === 'soniox') return sonioxTTS;
        return edgeTTSRust;
    }

    _configureTTS(tts, settings) {
        const provider = settings.tts_provider || 'edge';
        if (provider === 'elevenlabs') {
            tts.configure({
                apiKey: settings.elevenlabs_api_key,
                voiceId: settings.tts_voice_id || '21m00Tcm4TlvDq8ikWAM',
            });
        } else if (provider === 'google') {
            const voice = settings.google_tts_voice || 'vi-VN-Chirp3-HD-Aoede';
            const langCode = voice.replace(/-Chirp3.*/, '');
            tts.configure({
                apiKey: settings.google_tts_api_key,
                voice: voice,
                languageCode: langCode,
                speakingRate: settings.google_tts_speed || 1.0,
            });
        } else if (provider === 'soniox') {
            tts.configure({
                voice: settings.soniox_tts_voice || 'Mina',
                language: settings.my_language || 'vi',
            });
        } else {
            tts.configure({
                voice: settings.edge_tts_voice || 'vi-VN-HoaiMyNeural',
                speed: settings.edge_tts_speed !== undefined ? settings.edge_tts_speed : 20,
            });
        }
    }

    _addTermRow(source = '', target = '') {
        const list = document.getElementById('translation-terms-list');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'term-row';
        row.innerHTML = `<input type="text" class="term-source" value="${source}" placeholder="Source" />` +
            `<input type="text" class="term-target" value="${target}" placeholder="Target" />` +
            `<button type="button" class="btn-remove-term" title="Remove">×</button>`;
        row.querySelector('.btn-remove-term').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    _updateTTSProviderUI(provider) {
        const ed = document.getElementById('tts-edge-settings');
        const go = document.getElementById('tts-google-settings');
        const el = document.getElementById('tts-elevenlabs-settings');
        const sn = document.getElementById('tts-soniox-settings');
        if (ed) ed.style.display = provider === 'edge' ? '' : 'none';
        if (go) go.style.display = provider === 'google' ? '' : 'none';
        if (el) el.style.display = provider === 'elevenlabs' ? '' : 'none';
        if (sn) sn.style.display = provider === 'soniox' ? '' : 'none';
        // Update hint text
        const hint = document.getElementById('tts-provider-hint');
        if (hint) {
            const hints = {
                edge: 'Free, natural voices — no API key needed',
                soniox: 'High-quality voices — uses your Soniox API key',
                google: 'Near-human quality — requires Google Cloud API key (1M chars/month free)',
                elevenlabs: 'Premium quality — requires ElevenLabs API key',
            };
            hint.textContent = hints[provider] || '';
        }
        // Fetch Soniox voices from API when selected
        if (provider === 'soniox') {
            this._loadSonioxVoices();
        }
    }

    // Translate Soniox voice descriptions to Vietnamese (word-by-word)
    _translateVoiceDesc(desc) {
        if (!desc) return '';
        const map = {
            // Adjectives
            'rich': 'trầm',
            'steady': 'ổn định',
            'polished': 'tinh tế',
            'controlled': 'kiểm soát',
            'reassuring': 'đáng tin cậy',
            'confident': 'tự tin',
            'mature': 'trưởng thành',
            'bright': 'sáng',
            'expressive': 'truyền cảm',
            'youthful': 'trẻ trung',
            'natural': 'tự nhiên',
            'friendly': 'thân thiện',
            'warm': 'ấm áp',
            'engaging': 'hấp dẫn',
            'bold': 'táo bạo',
            'clear': 'rõ ràng',
            'smooth': 'mượt mà',
            'soft': 'nhẹ nhàng',
            'deep': 'sâu',
            'calm': 'bình tĩnh',
            'energetic': 'năng động',
            'professional': 'chuyên nghiệp',
            'gentle': 'nhẹ nhàng',
            'soothing': 'dịu dàng',
            'dynamic': 'năng động',
            'powerful': 'mạnh mẽ',
            'authoritative': 'uy quyền',
            'conversational': 'giống nói chuyện',
            'narration': 'lời dẫn',
            'narrative': 'kể chuyện',
            'casual': 'bình thường',
            'formal': 'trang trọng',
            'serious': 'nghiêm túc',
            'playful': 'vui tươi',
            'cheerful': 'vui vẻ',
            'optimistic': 'lạc quan',
            'thoughtful': 'sâu sắc',
            'sincere': 'chân thành',
            'kind': 'tốt bụng',
            'excited': 'hào hứng',
            'assertive': 'quyết đoán',
            'dramatic': 'kịch tính',
            'empathetic': 'thấu hiểu',
            'encouraging': 'động viên',
            'enthusiastic': 'nhiệt tình',
            'graceful': 'duyên dáng',
            'humorous': 'hài hước',
            'inquisitive': 'tò mò',
            'lively': 'sống động',
            'loving': 'yêu thương',
            'mellow': 'nhẹ nhàng',
            'mischievous': 'tinh nghịch',
            'passionate': 'đam mê',
            'persuasive': 'thuyết phục',
            'respectful': 'tôn trọng',
            'witty': 'hóm hỉnh',
            'husky': 'khàn',
            'breathy': 'thở',
            'airy': 'nhẹ',
            'sweet': 'ngọt ngào',
            'full': 'đầy',
            'resonant': 'vang',
            'dark': 'tối',
            'neutral': 'trung tính',
            'standard': 'chuẩn',
            // Nouns
            'voice': 'giọng',
            'tone': 'giọng',
            'pacing': 'nhịp độ',
            'presence': 'sự hiện diện',
            'rhythm': 'nhịp điệu',
            'energy': 'năng lượng',
            'warmth': 'sự ấm áp',
            'personality': 'cá tính',
            'style': 'phong cách',
            'quality': 'chất lượng',
            // Articles & prepositions
            'a': 'một',
            'an': 'một',
            'the': '',
            'with': 'với',
            'and': 'và',
            'of': 'của',
            'in': 'trong',
            'that': '',
            'which': '',
            'it': 'nó',
            'this': 'này',
            'has': 'có',
            'is': 'là',
            'are': 'là',
            'very': 'rất',
            'more': 'hơn',
            'slightly': 'hơi',
            'rather': 'khá',
        };
        let result = desc;
        // Sort by length desc so longer words match first
        const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length);
        for (const en of sortedKeys) {
            const regex = new RegExp(`\\b${en}\\b`, 'gi');
            result = result.replace(regex, map[en]);
        }
        // Clean up extra spaces
        result = result.replace(/\s+/g, ' ').trim();
        return result;
    }

    async _loadSonioxVoices() {
        const select = document.getElementById('select-soniox-voice');
        if (!select) return;
        const settings = await settingsManager.get();
        const savedVoice = settings.soniox_tts_voice || 'Mina';
        const apiKey = settings.soniox_api_key || '';
        if (!apiKey) {
            select.innerHTML = '<option value="Mina">👩 Mina — Nữ</option><option value="Adrian">👨 Adrian — Nam</option>';
            return;
        }
        try {
            const voices = await sonioxTTS.fetchVoices(apiKey);
            if (Array.isArray(voices) && voices.length > 0) {
                // Group voices by gender
                const male = voices.filter(v => v.gender === 'male');
                const female = voices.filter(v => v.gender === 'female');
                const other = voices.filter(v => v.gender !== 'male' && v.gender !== 'female');
                const all = [...female, ...male, ...other];

                select.innerHTML = '';
                all.forEach(v => {
                    const name = v.id || v.name || '';
                    const gender = v.gender || '';
                    const desc = v.description || '';
                    const icon = gender === 'female' ? '👩' : gender === 'male' ? '👨' : '🎤';
                    const genderVN = gender === 'female' ? 'Nữ' : gender === 'male' ? 'Nam' : '';
                    const shortDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
                    const viDesc = this._translateVoiceDesc(shortDesc);
                    const label = viDesc ? `${name} — ${viDesc}` : genderVN ? `${name} — ${genderVN}` : name;
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = `${icon} ${label}`;
                    opt.title = desc;
                    if (name === savedVoice) opt.selected = true;
                    select.appendChild(opt);
                });
            } else {
                select.innerHTML = '<option value="Mina">👩 Mina — Nữ</option><option value="Adrian">👨 Adrian — Nam</option>';
            }
        } catch (err) {
            console.error('[App] Failed to load Soniox voices:', err);
            select.innerHTML = '<option value="Mina">👩 Mina — Nữ</option><option value="Adrian">👨 Adrian — Nam</option>';
        }
    }

    _updateTTSButton() {
        const btn = document.getElementById('btn-tts');
        const iconOff = document.getElementById('icon-tts-off');
        const iconOn = document.getElementById('icon-tts-on');

        if (btn) btn.classList.toggle('active', this.ttsEnabled);
        if (iconOff) iconOff.style.display = this.ttsEnabled ? 'none' : 'block';
        if (iconOn) iconOn.style.display = this.ttsEnabled ? 'block' : 'none';
    }

    _updateTwoWayTTSButtons() {
        const remoteBtn = document.getElementById('btn-tts-remote-to-me');
        const localBtn = document.getElementById('btn-tts-me-to-remote');
        if (remoteBtn) remoteBtn.classList.toggle('active', this.ttsRemoteToMeEnabled);
        if (localBtn) localBtn.classList.toggle('active', this.ttsMeToRemoteEnabled);
    }

    _speakIfEnabled(text) {
        if (this.ttsEnabled && text?.trim()) {
            this._getActiveTTS().speak(text);
        }
    }

    // ─── Source Control ────────────────────────────────────

    _setSource(source) {
        const wasRunning = this.isRunning;

        // If currently running, restart with new source
        if (wasRunning) {
            this.stop().then(() => {
                this.currentSource = source;
                this._updateSourceButtons();
                this._showToast(`Switched to ${source === 'system' ? 'System Audio' : 'Microphone'}`, 'success');
                this.start();
            });
        } else {
            this.currentSource = source;
            this._updateSourceButtons();
            this._showToast(`Source: ${source === 'system' ? 'System Audio' : 'Microphone'}`, 'success');
        }
    }

    _updateSourceButtons() {
        document.getElementById('btn-source-system').classList.toggle('active',
            this.currentSource === 'system');
        document.getElementById('btn-source-mic').classList.toggle('active',
            this.currentSource === 'microphone');
    }

    _updateModeUI(mode) {
        const isSoniox = mode === 'soniox';
        const direction = document.querySelector('input[name="translation-direction"]:checked')?.value || 'one_way';
        const forceTwoWayOff = !isSoniox && direction === 'two_way';

        if (forceTwoWayOff) {
            const oneWayRadio = document.querySelector('input[name="translation-direction"][value="one_way"]');
            if (oneWayRadio) oneWayRadio.checked = true;
        }

        // Toggle hints
        const hintSoniox = document.getElementById('hint-mode-soniox');
        const hintLocal = document.getElementById('hint-mode-local');
        if (hintSoniox) hintSoniox.style.display = isSoniox ? '' : 'none';
        if (hintLocal) hintLocal.style.display = !isSoniox ? '' : 'none';

        // Toggle Soniox-only sections
        const sectionApiKey = document.getElementById('section-api-key');
        const sectionContext = document.getElementById('section-soniox-context');
        if (sectionApiKey) sectionApiKey.style.display = isSoniox ? '' : 'none';
        if (sectionContext) sectionContext.style.display = isSoniox ? '' : 'none';

        const twoWayRadio = document.querySelector('input[name="translation-direction"][value="two_way"]');
        if (twoWayRadio) twoWayRadio.disabled = !isSoniox;
        this._updateDirectionUI(forceTwoWayOff ? 'one_way' : direction);
    }

    _updateDirectionUI(direction) {
        const isTwoWay = direction === 'two_way';
        const hintOneWay = document.getElementById('hint-direction-one-way');
        const hintTwoWay = document.getElementById('hint-direction-two-way');
        const sectionTwoWayLanguages = document.getElementById('section-two-way-languages');
        const sectionOneWayLanguages = document.getElementById('section-one-way-languages');
        const sourceGroup = document.getElementById('audio-source-group')?.closest('.settings-section');
        const viewModeButton = document.getElementById('btn-view-mode');
        const oneWayTTSButton = document.getElementById('btn-tts');
        const twoWayTTSControls = document.getElementById('two-way-tts-controls');

        if (hintOneWay) hintOneWay.style.display = isTwoWay ? 'none' : '';
        if (hintTwoWay) hintTwoWay.style.display = isTwoWay ? '' : 'none';
        if (sectionTwoWayLanguages) sectionTwoWayLanguages.style.display = isTwoWay ? '' : 'none';
        if (sectionOneWayLanguages) sectionOneWayLanguages.style.display = isTwoWay ? 'none' : '';
        if (sourceGroup) sourceGroup.style.display = isTwoWay ? 'none' : '';
        if (viewModeButton) viewModeButton.style.display = isTwoWay ? 'none' : '';
        if (oneWayTTSButton) oneWayTTSButton.style.display = isTwoWay ? 'none' : '';
        if (twoWayTTSControls) twoWayTTSControls.style.display = isTwoWay ? '' : 'none';

        if (isTwoWay) {
            const mode = document.getElementById('select-two-way-audio-mode')?.value || 'vb_cable';
            this._updateTwoWayAudioModeUI(mode);
        }
    }

    /**
     * Show the VB-Cable-only fields (mic selector, passthrough toggles, warning)
     * only for the "Use VB-Cable" routing mode. "No Use VB-Cable" is under development.
     */
    _updateTwoWayAudioModeUI(mode) {
        const isVBCable = mode !== 'no_vb_cable';
        const micField = document.getElementById('select-mic-device')?.closest('.field');
        const warningHint = document.querySelector('#section-two-way-languages .warning-hint');
        const modeHint = document.getElementById('hint-two-way-audio-mode');
        document.querySelectorAll('#section-two-way-languages .vb-cable-only').forEach((el) => {
            el.style.display = isVBCable ? '' : 'none';
        });
        if (micField) micField.style.display = isVBCable ? '' : 'none';
        if (warningHint) warningHint.style.display = isVBCable ? '' : 'none';
        if (modeHint) {
            modeHint.textContent = isVBCable
                ? 'Use VB-Cable is the current implementation.'
                : 'No Use VB-Cable is under development.';
        }
    }

    // ─── Start/Stop ────────────────────────────────────────

    async start() {
        const settings = settingsManager.get();
        this.translationMode = settings.translation_mode || 'soniox';
        this.twoWayDirection = settings.translation_direction || 'one_way';
        console.log('[App] start() called, translation_mode:', this.translationMode, 'settings:', JSON.stringify(settings));

        // Check Soniox API key only for cloud mode
        if (this.translationMode === 'soniox' && !settings.soniox_api_key) {
            this._showToast('Soniox API key is required. Add it in Settings.', 'error');
            this._showView('settings');
            return;
        }

        // Check ElevenLabs key only if TTS is enabled AND provider is elevenlabs
        if (this.ttsEnabled && settings.tts_provider === 'elevenlabs' && !settings.elevenlabs_api_key) {
            this._showToast('TTS is ON but ElevenLabs API key is missing. Add it in Settings or disable TTS.', 'error');
            this._showView('settings');
            return;
        }

        this.isRunning = true;
        this._updateStartButton();
        if (!this.recordingStartTime) this.recordingStartTime = Date.now();

        // Clear transcript only if nothing is showing
        if (!this.transcriptUI.hasContent()) {
            this.transcriptUI.showListening();
        } else {
            this.transcriptUI.clearProvisional();
        }

        if (this.translationMode === 'local') {
            await this._startLocalMode(settings);
        } else if (this.twoWayDirection === 'two_way') {
            await this._startTwoWayMode(settings);
        } else {
            await this._startSonioxMode(settings);
        }

        // Start TTS if enabled (one-way modes only — two-way manages TTS itself)
        if (this.ttsEnabled && this.twoWayDirection !== 'two_way') {
            const tts = this._getActiveTTS();
            this._configureTTS(tts, settings);
            tts.connect();
            audioPlayer.resume();
        }
    }

    async _startSonioxMode(settings) {
        // Connect to Soniox
        console.log('[App] Connecting to Soniox...');
        this._updateStatus('connecting');
        sonioxClient.connect({
            apiKey: settings.soniox_api_key,
            sourceLanguage: settings.source_language,
            targetLanguage: settings.target_language,
            customContext: settings.custom_context,
        });

        // Start audio capture — Rust batches audio every 200ms, JS just forwards
        try {
            let audioChunkCount = 0;

            const channel = new window.__TAURI__.core.Channel();
            channel.onmessage = (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Audio] Batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                // Forward batched audio to Soniox
                const bytes = new Uint8Array(pcmData);
                sonioxClient.sendAudio(bytes.buffer);
            };

            console.log('[App] Starting audio capture, source:', this.currentSource);
            await invoke('start_capture', {
                source: this.currentSource,
                channel: channel,
            });
            console.log('[App] Audio capture started successfully');
        } catch (err) {
            console.error('Failed to start audio capture:', err);
            this._showToast(`Audio error: ${err}`, 'error');
            await this.stop();
        }
    }

    async _startTwoWayMode(settings) {
        if (settings.two_way_audio_mode === 'no_vb_cable') {
            this._showToast('No Use VB-Cable is under development.', 'error');
            this.isRunning = false;
            this._updateStartButton();
            this._updateStatus('error');
            return;
        }
        console.log('[App] Starting two-way call mode...');
        this._updateStatus('connecting');
        this.transcriptUI.setTwoWayMode(true);
        this._showToast(settings.two_way_mute_original_mic
            ? 'Two-way mode: original mic route muted. Use CABLE Output as the call app microphone.'
            : 'Two-way mode: use headphones; route TTS to CABLE Input if needed.', 'success');

        this.remoteSonioxClient = new SonioxClient();
        this.localSonioxClient = new SonioxClient();
        this._configureTwoWayCallbacks(settings);

        this.remoteSonioxClient.connect({
            apiKey: settings.soniox_api_key,
            sourceLanguage: settings.other_language || 'en',
            targetLanguage: settings.my_language || 'vi',
            customContext: settings.custom_context,
        });

        this.localSonioxClient.connect({
            apiKey: settings.soniox_api_key,
            sourceLanguage: settings.my_language || 'vi',
            targetLanguage: settings.other_language || 'en',
            customContext: settings.custom_context,
        });

        try {
            const systemChannel = new window.__TAURI__.core.Channel();
            const micChannel = new window.__TAURI__.core.Channel();
            let systemChunkCount = 0;
            let micChunkCount = 0;

            systemChannel.onmessage = (pcmData) => {
                // While the send-to-remote player renders our translation into
                // CABLE Input, the system loopback picks that TTS back up. Drop it
                // so the remote Soniox client doesn't re-transcribe our own TTS
                // (which would otherwise loop: you say vi → TTS en → captured →
                // translated again → more TTS).
                if (this._isRemoteTTSPlaying) return;
                systemChunkCount++;
                if (systemChunkCount <= 3 || systemChunkCount % 50 === 0) {
                    console.log(`[Two-way/System] Batch #${systemChunkCount}, size:`, pcmData?.length || 0);
                }
                this.remoteSonioxClient?.sendAudio(new Uint8Array(pcmData).buffer);
            };

            micChannel.onmessage = (pcmData) => {
                // Only suppress mic audio while the send-to-remote player is
                // rendering into the call route. Read-to-me TTS goes to the
                // user's headphones and must not silence their own speech.
                if (this._isRemoteTTSPlaying) return;
                micChunkCount++;
                if (micChunkCount <= 3 || micChunkCount % 50 === 0) {
                    console.log(`[Two-way/Mic] Batch #${micChunkCount}, size:`, pcmData?.length || 0);
                }
                this.localSonioxClient?.sendAudio(new Uint8Array(pcmData).buffer);
            };

            await invoke('start_system_capture', { channel: systemChannel });
            // Resolve the user's chosen mic device for this capture. 'default'/empty
            // → OS default input (Rust treats it as the cpal default input device).
            const micDevice = settings.microphone_device && settings.microphone_device !== 'default'
                ? settings.microphone_device
                : null;
            await invoke('start_microphone_capture', { channel: micChannel, deviceName: micDevice });

            // Optional live passthroughs mix original speech into the same
            // output endpoints as the translations. They take effect at start;
            // stop and start the call again after changing these checkboxes.
            if (settings.send_original_voice_to_remote) {
                await invoke('start_passthrough', {
                    source: 'mic',
                    renderDeviceId: settings.tts_send_to_remote_device || 'default',
                    deviceName: micDevice,
                });
            }
            if (settings.play_original_voice_to_me) {
                await invoke('start_passthrough', {
                    source: 'system',
                    renderDeviceId: settings.tts_read_to_me_device || 'default',
                    deviceName: null,
                });
            }

            console.log('[App] Two-way captures started successfully (mic device:', micDevice || 'default', ')');
        } catch (err) {
            console.error('Failed to start two-way audio capture:', err);
            this._showToast(`Two-way audio error: ${err}`, 'error');
            await this.stop();
        }
    }

    _configureTwoWayCallbacks(settings) {
        const myLanguage = settings.my_language || 'vi';
        const otherLanguage = settings.other_language || 'en';
        let connectedCount = 0;
        const onStatus = (status) => {
            if (status === 'connected') {
                connectedCount = Math.min(2, connectedCount + 1);
                if (connectedCount >= 2) this._updateStatus('connected');
                return;
            }
            if (status === 'connecting') this._updateStatus('connecting');
            if (status === 'error') this._updateStatus('error');
        };

        this.remoteSonioxClient.onOriginal = (text, speaker) => {
            this.transcriptUI.addOriginalForDirection(text, speaker, 'remote_to_me');
        };
        this.remoteSonioxClient.onTranslation = (text) => {
            this.transcriptUI.addTranslationForDirection(text, 'remote_to_me');
            this._speakTwoWayIfEnabled(text, myLanguage, 'remote_to_me');
        };
        this.remoteSonioxClient.onProvisional = (text, speaker) => {
            if (text) this.transcriptUI.setProvisionalForDirection(text, speaker, 'remote_to_me');
            else this.transcriptUI.clearProvisionalForDirection('remote_to_me');
        };
        this.remoteSonioxClient.onStatusChange = onStatus;
        this.remoteSonioxClient.onError = (error) => this._showToast(`Remote audio: ${error}`, 'error');

        this.localSonioxClient.onOriginal = (text, speaker) => {
            if (this._isRemoteTTSPlaying) {
                console.debug('[Two-way] local onOriginal skipped while send-to-remote TTS plays');
                return;
            }
            this.transcriptUI.addOriginalForDirection(text, speaker, 'me_to_remote');
        };
        this.localSonioxClient.onTranslation = (text) => {
            if (this._isRemoteTTSPlaying) {
                console.debug('[Two-way] local onTranslation skipped while send-to-remote TTS plays');
                return;
            }
            this.transcriptUI.addTranslationForDirection(text, 'me_to_remote');
            this._speakTwoWayIfEnabled(text, otherLanguage, 'me_to_remote');
        };
        this.localSonioxClient.onProvisional = (text, speaker) => {
            if (this._isRemoteTTSPlaying) {
                console.debug('[Two-way] local onProvisional skipped while send-to-remote TTS plays');
                return;
            }
            if (text) this.transcriptUI.setProvisionalForDirection(text, speaker, 'me_to_remote');
            else this.transcriptUI.clearProvisionalForDirection('me_to_remote');
        };
        this.localSonioxClient.onStatusChange = onStatus;
        this.localSonioxClient.onError = (error) => this._showToast(`Microphone: ${error}`, 'error');
    }

    _speakTwoWayIfEnabled(text, language, direction) {
        const enabled = direction === 'me_to_remote'
            ? this.ttsMeToRemoteEnabled
            : this.ttsRemoteToMeEnabled;
        if (!enabled || !text?.trim()) return;

        console.debug('[Two-way] speak', direction, 'len:', text.length);

        const tts = this._getActiveTTS();
        const settings = settingsManager.get();
        this._configureTTS(tts, settings);
        tts.connect();

        // Route the MP3 to the right output device per direction:
        //   - me_to_remote  → remoteAudioPlayer (CABLE Input → call app mic → other person)
        //   - remote_to_me  → audioPlayer (user's real headphones)
        if (direction === 'me_to_remote') {
            const player = remoteAudioPlayer;
            player.resume();
            tts.speak(text, (base64Audio) => player.enqueue(base64Audio));
        } else {
            audioPlayer.resume();
            tts.speak(text, (base64Audio) => audioPlayer.enqueue(base64Audio));
        }
    }

    /**
     * Re-derive the TTS echo-suppression flags from both players' states.
     * `_isTTSPlaying` = any TTS rendering (kept for general gating elsewhere).
     * `_isRemoteTTSPlaying` = only the send-to-remote player, whose output
     *   feeds CABLE Input and is picked up by CABLE Output (the mic source).
     *   We drop mic audio + local-side callbacks only while THIS flag is set,
     *   because only send-to-remote TTS can loop back into the mic capture.
     *   Read-to-me TTS goes to the user's real headphones and does not echo.
     */
    _syncTTSEchoFlag() {
        this._isTTSPlaying = audioPlayer.isActive || remoteAudioPlayer.isActive;
        this._isRemoteTTSPlaying = remoteAudioPlayer.isActive;
    }

    async _startLocalMode(settings) {
        console.log('[App] Starting Local mode (MLX models)...');
        this._updateStatus('connecting');

        // Step 0: Check audio permission FIRST (before loading models)
        try {
            await invoke('start_capture', {
                source: this.currentSource,
                channel: new window.__TAURI__.core.Channel(), // dummy channel for permission check
            });
            await invoke('stop_capture');
        } catch (err) {
            console.error('[App] Audio permission check failed:', err);
            this._showToast(`Audio permission required: ${err}`, 'error');
            this.isRunning = false;
            this._updateStartButton();
            this._updateStatus('error');
            this.transcriptUI.clear();
            this.transcriptUI.showPlaceholder();
            return;
        }

        // Step 1: Check if MLX setup is complete
        try {
            const checkResult = await invoke('check_mlx_setup');
            const status = JSON.parse(checkResult);
            if (!status.ready) {
                this._showToast('Setting up MLX models (one-time, ~5GB)...', 'success');
                this.transcriptUI.showStatusMessage('Downloading MLX models (one-time setup)...');
                await this._runMlxSetup();
            }
        } catch (err) {
            console.warn('[App] MLX check failed (proceeding anyway):', err);
        }

        console.log('[App] MLX check passed, starting pipeline...');

        // Step 1: Start pipeline FIRST (independent of audio)
        try {
            this._showToast('Starting local pipeline...', 'success');

            this.localPipelineChannel = new window.__TAURI__.core.Channel();
            this.localPipelineReady = false;

            this.localPipelineChannel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    console.warn('[Local] JSON parse failed:', typeof msg, msg);
                    return;
                }
                try {
                    this._handleLocalPipelineResult(data);
                } catch (e) {
                    console.error('[Local] Handler error for type:', data?.type, e);
                }
            };

            const sourceLangMap = {
                'auto': 'auto', 'ja': 'Japanese', 'en': 'English',
                'zh': 'Chinese', 'ko': 'Korean', 'vi': 'Vietnamese',
            };
            const sourceLang = sourceLangMap[settings.source_language] || 'Japanese';

            await invoke('start_local_pipeline', {
                sourceLang: sourceLang,
                targetLang: settings.target_language || 'vi',
                channel: this.localPipelineChannel,
            });
            console.log('[App] Local pipeline spawned');
        } catch (err) {
            console.error('Failed to start pipeline:', err);
            this._showToast(`Pipeline error: ${err}`, 'error');
            await this.stop();
            return;
        }

        // Step 2: Start audio capture
        try {
            const audioChannel = new window.__TAURI__.core.Channel();
            let audioChunkCount = 0;

            audioChannel.onmessage = async (pcmData) => {
                audioChunkCount++;
                if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
                    console.log(`[Local] Audio batch #${audioChunkCount}, size:`, pcmData?.length || 0);
                }
                try {
                    await invoke('send_audio_to_pipeline', { data: Array.from(new Uint8Array(pcmData)) });
                } catch (e) {
                    // Pipeline may not be ready yet
                }
            };

            await invoke('start_capture', {
                source: this.currentSource,
                channel: audioChannel,
            });
            console.log('[App] Audio capture started');
        } catch (err) {
            console.error('Audio capture failed (pipeline still running):', err);
            this._showToast(`Audio: ${err}. Pipeline still loading...`, 'error');
        }
    }

    _handleLocalPipelineResult(data) {
        switch (data.type) {
            case 'ready':
                this.localPipelineReady = true;
                this._updateStatus('connected');
                this.transcriptUI.removeStatusMessage();
                this.transcriptUI.showListening();
                this._showToast('Local models ready!', 'success');
                break;
            case 'result':
                // Chase effect: show original first (gray), then translation (white)
                if (data.original) {
                    this.transcriptUI.addOriginal(data.original);
                }
                // Small delay for visual "chase" effect
                setTimeout(() => {
                if (data.translated) {
                    this.transcriptUI.addTranslation(data.translated);
                    this._speakIfEnabled(data.translated);
                }
                }, 80);
                break;
            case 'status':
                const msg = data.message || 'Loading...';
                // Status bar: show compact message (strip [pipeline] prefix)
                const statusText = document.getElementById('status-text');
                if (statusText) {
                    const compact = msg.replace(/^\[pipeline\]\s*/, '');
                    statusText.textContent = compact;
                }
                // Transcript area: only show loading/starting messages, not debug logs
                if (!msg.startsWith('[pipeline]')) {
                    this.transcriptUI.showStatusMessage(msg);
                }
                break;
            case 'done':
                this._updateStatus('disconnected');
                break;
        }
    }

    async _runMlxSetup() {
        const modal = document.getElementById('setup-modal');
        const progressFill = document.getElementById('setup-progress-fill');
        const progressPct = document.getElementById('setup-progress-pct');
        const statusText = document.getElementById('setup-status-text');
        const cancelBtn = document.getElementById('btn-cancel-setup');

        // Step mapping: step name → total progress weight
        const stepWeights = { check: 5, venv: 10, packages: 35, models: 50 };
        let totalProgress = 0;

        const updateStep = (stepName, icon, isActive) => {
            const stepEl = document.getElementById(`step-${stepName}`);
            if (!stepEl) return;
            stepEl.querySelector('.step-icon').textContent = icon;
            stepEl.classList.toggle('active', isActive);
            stepEl.classList.toggle('done', icon === '✅');
        };

        const updateProgress = (pct) => {
            totalProgress = Math.min(100, pct);
            progressFill.style.width = totalProgress + '%';
            progressPct.textContent = Math.round(totalProgress) + '%';
        };

        // Show modal
        modal.style.display = 'flex';

        return new Promise((resolve, reject) => {
            const channel = new window.__TAURI__.core.Channel();

            // Cancel handler
            const onCancel = () => {
                modal.style.display = 'none';
                reject(new Error('Setup cancelled'));
            };
            cancelBtn.addEventListener('click', onCancel, { once: true });

            channel.onmessage = (msg) => {
                let data;
                try {
                    data = (typeof msg === 'string') ? JSON.parse(msg) : msg;
                } catch (e) {
                    return;
                }

                switch (data.type) {
                    case 'progress':
                        statusText.textContent = data.message || 'Working...';

                        // Update step indicators
                        if (data.step) {
                            // Mark previous steps as done
                            const steps = ['check', 'venv', 'packages', 'models'];
                            const currentIdx = steps.indexOf(data.step);
                            steps.forEach((s, i) => {
                                if (i < currentIdx) updateStep(s, '✅', false);
                                else if (i === currentIdx) updateStep(s, '🔄', true);
                            });

                            if (data.done) {
                                updateStep(data.step, '✅', false);
                            }

                            // Calculate overall progress
                            let pct = 0;
                            steps.forEach((s, i) => {
                                if (i < currentIdx) pct += stepWeights[s];
                                else if (i === currentIdx) {
                                    pct += (data.progress || 0) / 100 * stepWeights[s];
                                }
                            });
                            updateProgress(pct);
                        }
                        break;

                    case 'complete':
                        updateProgress(100);
                        statusText.textContent = '✅ ' + (data.message || 'Setup complete!');
                        ['check', 'venv', 'packages', 'models'].forEach(s => updateStep(s, '✅', false));

                        // Close modal after brief delay
                        setTimeout(() => {
                            modal.style.display = 'none';
                            resolve();
                        }, 1000);
                        break;

                    case 'error':
                        statusText.textContent = '❌ ' + (data.message || 'Setup failed');
                        cancelBtn.textContent = 'Close';
                        cancelBtn.removeEventListener('click', onCancel);
                        cancelBtn.addEventListener('click', () => {
                            modal.style.display = 'none';
                            reject(new Error(data.message));
                        }, { once: true });
                        break;

                    case 'log':
                        console.log('[MLX Setup]', data.message);
                        break;
                }
            };

            invoke('run_mlx_setup', { channel })
                .catch(err => {
                    statusText.textContent = '❌ ' + err;
                    modal.style.display = 'none';
                    reject(err);
                });
        });
    }

    async stop() {
        this.isRunning = false;
        this._updateStartButton();

        // Stop audio capture
        try {
            await invoke('stop_capture');
        } catch (err) {
            console.error('Failed to stop audio capture:', err);
        }

        if (this.translationMode === 'local') {
            // Stop local pipeline
            try {
                await invoke('stop_local_pipeline');
            } catch (err) {
                console.error('Failed to stop local pipeline:', err);
            }
            this.localPipelineReady = false;
            this.transcriptUI.removeStatusMessage();
            this._updateStatus('disconnected');
        } else if (this.twoWayDirection === 'two_way' && (this.remoteSonioxClient || this.localSonioxClient)) {
            try {
                await invoke('stop_all_passthrough');
                await invoke('stop_system_capture');
                await invoke('stop_microphone_capture');
            } catch (err) {
                console.error('Failed to stop two-way audio capture:', err);
            }
            this.remoteSonioxClient?.disconnect();
            this.localSonioxClient?.disconnect();
            this.remoteSonioxClient = null;
            this.localSonioxClient = null;
            edgeTTSRust.disconnect();
            audioPlayer.stop();
            remoteAudioPlayer.stop();
            this._updateStatus('disconnected');
        } else {
            // Disconnect Soniox
            sonioxClient.disconnect();
        }

        // Keep transcript visible — don't clear
        this.transcriptUI.clearProvisional();
        this.transcriptUI.setTwoWayMode(this.twoWayDirection === 'two_way');
        this._updateTwoWayTTSButtons();

        // Stop TTS
        elevenLabsTTS.disconnect();
        edgeTTSRust.disconnect();

        audioPlayer.stop();
        remoteAudioPlayer.stop();

        // Auto-save on stop (safety net)
        if (this.transcriptUI.hasSegments()) {
            await this._saveTranscriptFile();
        }
    }

    _updateStartButton() {
        const btn = document.getElementById('btn-start');
        const iconPlay = document.getElementById('icon-play');
        const iconStop = document.getElementById('icon-stop');

        btn.classList.toggle('recording', this.isRunning);
        iconPlay.style.display = this.isRunning ? 'none' : 'block';
        iconStop.style.display = this.isRunning ? 'block' : 'none';
    }

    // ─── Transcript Persistence ───────────────────────────────

    _formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}m ${sec}s`;
    }

    async _saveTranscriptFile() {
        const duration = this.recordingStartTime
            ? this._formatDuration(Date.now() - this.recordingStartTime)
            : 'unknown';

        const settings = settingsManager.get();
        const isTwoWay = this.twoWayDirection === 'two_way';
        const sourceLang = isTwoWay ? (settings.other_language || 'en') : (document.getElementById('select-source-lang')?.value || 'auto');
        const targetLang = isTwoWay ? (settings.my_language || 'vi') : (document.getElementById('select-target-lang')?.value || 'vi');

        const content = this.transcriptUI.getFormattedContent({
            model: isTwoWay ? 'Soniox Cloud API — Two-way Call' : (this.translationMode === 'soniox' ? 'Soniox Cloud API' : 'Local MLX Whisper'),
            sourceLang,
            targetLang,
            duration,
            audioSource: isTwoWay ? 'system + microphone' : this.currentSource,
        });

        if (!content) return;

        try {
            const path = await invoke('save_transcript', { content });
            const filename = path.split('/').pop();
            this._showToast(`Saved: ${filename}`, 'success');
        } catch (err) {
            console.error('Failed to save transcript:', err);
            this._showToast('Failed to save transcript', 'error');
        }
    }

    // ─── Status ────────────────────────────────────────────

    _updateStatus(status) {
        const dot = document.getElementById('status-indicator');
        const text = document.getElementById('status-text');

        dot.className = 'status-dot';

        switch (status) {
            case 'connecting':
                dot.classList.add('connecting');
                text.textContent = 'Connecting...';
                break;
            case 'connected':
                dot.classList.add('connected');
                text.textContent = 'Listening';
                break;
            case 'disconnected':
                dot.classList.add('disconnected');
                text.textContent = 'Ready';
                break;
            case 'error':
                dot.classList.add('error');
                text.textContent = 'Error';
                break;
        }
    }

    // ─── Window Position ───────────────────────────────────

    async _saveWindowPosition() {
        try {
            const factor = await this.appWindow.scaleFactor();
            const pos = await this.appWindow.outerPosition();
            const size = await this.appWindow.innerSize();
            // Save logical coordinates (physical / scaleFactor)
            localStorage.setItem('window_state', JSON.stringify({
                x: Math.round(pos.x / factor),
                y: Math.round(pos.y / factor),
                width: Math.round(size.width / factor),
                height: Math.round(size.height / factor),
            }));
        } catch (err) {
            console.error('Failed to save window position:', err);
        }
    }

    async _restoreWindowPosition() {
        try {
            const saved = localStorage.getItem('window_state');
            if (!saved) return;

            const state = JSON.parse(saved);
            const { LogicalPosition, LogicalSize } = window.__TAURI__.window;

            // Validate — don't restore if position seems off-screen
            if (state.x < -100 || state.y < -100 || state.x > 5000 || state.y > 3000) {
                console.warn('Saved window position looks off-screen, skipping restore');
                localStorage.removeItem('window_state');
                return;
            }

            if (state.width && state.height && state.width >= 300 && state.height >= 100) {
                await this.appWindow.setSize(new LogicalSize(state.width, state.height));
            }
            if (state.x !== undefined && state.y !== undefined) {
                await this.appWindow.setPosition(new LogicalPosition(state.x, state.y));
            }
        } catch (err) {
            console.error('Failed to restore window position:', err);
            localStorage.removeItem('window_state');
        }
    }

    // ─── Pin / Unpin (Always on Top) ────────────────────

    async _togglePin() {
        this.isPinned = !this.isPinned;
        await this.appWindow.setAlwaysOnTop(this.isPinned);
        const btn = document.getElementById('btn-pin');
        if (btn) btn.classList.toggle('active', this.isPinned);
        this._showToast(this.isPinned ? 'Pinned on top' : 'Unpinned — window can go behind other apps', 'success');
    }

    // ─── Compact Mode ───────────────────────────────

    _toggleCompact() {
        this.isCompact = !this.isCompact;
        const dragRegion = document.getElementById('drag-region');
        const overlay = document.getElementById('overlay-view');

        if (this.isCompact) {
            dragRegion.classList.add('compact-hidden');
            overlay.classList.add('compact-mode');
        } else {
            dragRegion.classList.remove('compact-hidden');
            overlay.classList.remove('compact-mode');
        }
    }

    _toggleViewMode() {
        const isDual = this.transcriptUI.viewMode === 'dual';
        const newMode = isDual ? 'single' : 'dual';
        this.transcriptUI.configure({ viewMode: newMode });
        const btn = document.getElementById('btn-view-mode');
        if (btn) btn.classList.toggle('active', newMode === 'dual');
    }

    _adjustFontSize(delta) {
        const current = this.transcriptUI.fontSize || 16;
        const newSize = Math.max(12, Math.min(140, current + delta));
        this.transcriptUI.configure({ fontSize: newSize });

        // Update display
        const display = document.getElementById('font-size-display');
        if (display) display.textContent = newSize;

        // Sync with settings slider
        const slider = document.getElementById('range-font-size');
        if (slider) slider.value = newSize;
        const sliderVal = document.getElementById('font-size-value');
        if (sliderVal) sliderVal.textContent = `${newSize}px`;
    }

    // ─── Toast ─────────────────────────────────────────────

    _showToast(message, type = 'success') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-remove (longer for errors)
        const duration = type === 'error' ? 5000 : 3000;
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
