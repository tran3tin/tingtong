/**
 * Settings Manager — handles loading/saving settings via Tauri IPC
 */

const { invoke } = window.__TAURI__.core;

// Default settings shape
const DEFAULT_SETTINGS = {
  ui_language: 'vi',
  soniox_api_key: '',
  source_language: 'auto',
  target_language: 'vi',
  audio_source: 'system',
  overlay_opacity: 0.85,
  font_size: 16,
  max_lines: 5,
  show_original: true,
  translation_mode: 'soniox',
  translation_direction: 'one_way',
  my_language: 'vi',
  other_language: 'en',
  two_way_tts_enabled: true,
  // Two-way audio routing: 'vb_cable' (VB-Audio Virtual Cable, implemented) or
  // 'no_vb_cable' (planned, under development).
  two_way_audio_mode: 'vb_cable',
  // Two-way passthrough: mix the original voice into the same endpoint as TTS.
  send_original_voice_to_remote: false, // other person hears my voice + translation
  play_original_voice_to_me: false,     // I hear other person's voice + translation
  two_way_mute_original_mic: false,
  custom_context: null,
  elevenlabs_api_key: '',
  tts_enabled: false,
  tts_provider: 'edge',
  tts_voice_id: '21m00Tcm4TlvDq8ikWAM',
  tts_speed: 1.2,
  edge_tts_voice: 'vi-VN-HoaiMyNeural',
  edge_tts_speed: 50,
  tts_auto_read: true,
  // Soniox TTS settings
  soniox_tts_voice: 'Mina',
  // TTS output devices (WASAPI render endpoint ids; 'default' = system default render)
  tts_read_to_me_device: 'default',   // remote→me → user's real headphones
  tts_send_to_remote_device: 'default', // me→remote → CABLE Input (call app mic = CABLE Output)
  // Microphone input device for two-way capture (cpal device name; 'default' = OS default input).
  // Defaults to OS default. In a VB-Cable call setup the OS default recording is often
  // CABLE Output, so the user should pick their real headset mic here instead.
  microphone_device: 'default',
};

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._listeners = [];
  }

  /**
   * Load settings from Rust backend
   */
  async load() {
    try {
      const settings = await invoke('get_settings');
      this.settings = { ...DEFAULT_SETTINGS, ...settings };
    } catch (err) {
      console.error('Failed to load settings:', err);
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this._notify();
    return this.settings;
  }

  /**
   * Save settings to Rust backend
   */
  async save(newSettings) {
    try {
      const merged = { ...this.settings, ...newSettings };
      await invoke('save_settings', { newSettings: merged });
      this.settings = merged;
      this._notify();
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  }

  /**
   * Get current settings (cached)
   */
  get() {
    return { ...this.settings };
  }

  /**
   * Subscribe to settings changes
   */
  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  _notify() {
    const settings = this.get();
    this._listeners.forEach(cb => cb(settings));
  }
}

// Singleton
export const settingsManager = new SettingsManager();
