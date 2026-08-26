/**
 * i18n — UI Language Manager
 * Supports: vi (Vietnamese), en (English), fr (French)
 *
 * Usage:
 *   import { i18n } from './i18n.js';
 *   i18n.setLanguage('vi');  // switch UI to Vietnamese
 *   i18n.t('status_ready');  // get translated string by key
 */

// ─── Translations ──────────────────────────────────────

const TRANSLATIONS = {
    // ─── Status ────────────────────────────────────
    status_ready:       { vi: 'Sẵn sàng',       en: 'Ready',        fr: 'Prêt' },
    status_connecting:  { vi: 'Đang kết nối...', en: 'Connecting...', fr: 'Connexion...' },
    status_listening:   { vi: 'Đang nghe',       en: 'Listening',    fr: 'Écoute' },
    status_error:       { vi: 'Lỗi',             en: 'Error',        fr: 'Erreur' },

    // ─── Toolbar tooltips ───────────────────────────
    tooltip_settings:       { vi: 'Cài đặt',                          en: 'Settings',                        fr: 'Paramètres' },
    tooltip_system_audio:   { vi: 'Âm thanh hệ thống (⌘1)',          en: 'System Audio (⌘1)',               fr: 'Audio système (⌘1)' },
    tooltip_microphone:     { vi: 'Micro (⌘2)',                       en: 'Microphone (⌘2)',                 fr: 'Microphone (⌘2)' },
    tooltip_start_stop:     { vi: 'Bắt đầu/Dừng (Space)',             en: 'Start/Stop (Space)',              fr: 'Démarrer/Arrêter (Space)' },
    tooltip_tts:            { vi: 'TTS tường thuật (⌘T)',             en: 'TTS Narration (⌘T)',              fr: 'Narration TTS (⌘T)' },
    tooltip_tts_remote:     { vi: 'Đọc bản dịch cho tôi',             en: 'Read translations for me',        fr: 'Lire les traductions pour moi' },
    tooltip_tts_me:         { vi: 'Đọc bản dịch cho người kia',       en: 'Read translations for other',     fr: 'Lire les traductions pour l\'autre' },
    tooltip_clear:          { vi: 'Xóa transcript',                   en: 'Clear transcript',                fr: 'Effacer le transcript' },
    tooltip_copy:           { vi: 'Sao chép transcript',              en: 'Copy transcript',                 fr: 'Copier le transcript' },
    tooltip_open:           { vi: 'Mở transcript đã lưu',             en: 'Open saved transcripts',          fr: 'Ouvrir les transcripts sauvegardés' },
    tooltip_compact:        { vi: 'Thu gọn — ẩn thanh điều khiển',    en: 'Compact mode — hide control bar', fr: 'Mode compact — cacher la barre' },
    tooltip_pin:            { vi: 'Ghim trên cùng (luôn hiện)',       en: 'Pin on top (always visible)',     fr: 'Épingler en haut (toujours visible)' },
    tooltip_minimize:       { vi: 'Thu nhỏ xuống taskbar',            en: 'Minimize to taskbar',             fr: 'Réduire dans la barre des tâches' },
    tooltip_close:          { vi: 'Đóng',                             en: 'Close',                           fr: 'Fermer' },
    tooltip_font_down:      { vi: 'Giảm cỡ chữ',                     en: 'Decrease font size',              fr: 'Réduire la taille police' },
    tooltip_font_up:        { vi: 'Tăng cỡ chữ',                     en: 'Increase font size',              fr: 'Augmenter la taille police' },
    tooltip_color_white:    { vi: 'Trắng',                           en: 'White',                           fr: 'Blanc' },
    tooltip_color_yellow:   { vi: 'Vàng',                            en: 'Yellow',                          fr: 'Jaune' },
    tooltip_color_cyan:     { vi: 'Xanh cyan',                       en: 'Cyan',                            fr: 'Cyan' },
    tooltip_dual_view:      { vi: 'Chuyển chế độ xem',               en: 'Toggle dual view',                fr: 'Basculer vue duale' },
    tooltip_back:           { vi: 'Quay lại',                        en: 'Back',                            fr: 'Retour' },
    tooltip_save_close:     { vi: 'Lưu & Đóng',                      en: 'Save & Close',                    fr: 'Sauvegarder & Fermer' },
    tooltip_show_hide:      { vi: 'Hiện/Ẩn',                         en: 'Show/Hide',                       fr: 'Afficher/Masquer' },
    tooltip_add_term:       { vi: 'Thêm thuật ngữ',                  en: 'Add term',                        fr: 'Ajouter un terme' },

    // ─── Overlay ────────────────────────────────────
    placeholder_text:       { vi: 'Nhấn ▶ để bắt đầu dịch',          en: 'Press ▶ to start translating',    fr: 'Appuyez ▶ pour traduire' },
    shortcut_hint:          { vi: '⌘ Enter',                         en: '⌘ Enter',                         fr: '⌘ Entrée' },
    font_size_label:        { vi: 'Cỡ chữ',                          en: 'Font Size',                       fr: 'Taille police' },
    listening_text:         { vi: 'Đang nghe...',                    en: 'Listening...',                    fr: 'Écoute...' },

    // ─── Settings header ─────────────────────────────
    settings_title:         { vi: 'Cài đặt',     en: 'Settings',     fr: 'Paramètres' },
    tab_translation:        { vi: 'Dịch thuật',  en: 'Translation',  fr: 'Traduction' },
    tab_display:            { vi: 'Hiển thị',    en: 'Display',      fr: 'Affichage' },
    tab_tts:                { vi: 'TTS',         en: 'TTS',          fr: 'TTS' },

    // ─── Translation tab ─────────────────────────────
    field_engine:           { vi: 'Công cụ',                         en: 'Engine',                          fr: 'Moteur' },
    opt_cloud:              { vi: '☁️ Soniox API (Đám mây)',          en: '☁️ Soniox API (Cloud)',           fr: '☁️ Soniox API (Cloud)' },
    opt_local:              { vi: '🖥️ MLX (Ngoại tuyến)',             en: '🖥️ Local MLX (Offline)',           fr: '🖥️ MLX Local (Hors ligne)' },
    hint_soniox_mode:       { vi: 'Thời gian thực, 70+ ngôn ngữ, ~$0.12/giờ', en: 'Real-time, 70+ languages, ~$0.12/hr', fr: 'Temps réel, 70+ langues, ~0,12$/h' },
    hint_local_mode:        { vi: 'Ngoại tuyến, miễn phí, chậm ~3-4s',       en: 'Offline, free, ~3-4s delay',            fr: 'Hors ligne, gratuit, ~3-4s délai' },
    field_api_key:          { vi: 'Khóa API Soniox',                 en: 'Soniox API Key',                   fr: 'Clé API Soniox' },
    required_badge:         { vi: 'Bắt buộc',                        en: 'Required',                         fr: 'Requis' },
    api_key_placeholder:    { vi: 'Nhập khóa API Soniox...',          en: 'Enter your Soniox API key...',     fr: 'Entrez votre clé API Soniox...' },
    hint_get_key:           { vi: 'Lấy khóa tại',                    en: 'Get key at',                       fr: 'Obtenez la clé sur' },
    field_direction:        { vi: 'Hướng dịch',                      en: 'Direction',                        fr: 'Direction' },
    opt_one_way:            { vi: 'Một chiều',                       en: 'One-way',                          fr: 'Unidirectionnel' },
    opt_two_way:            { vi: 'Cuộc gọi hai chiều',              en: 'Two-way call',                     fr: 'Appel bidirectionnel' },
    hint_one_way:           { vi: 'Dịch một nguồn âm thanh đã chọn.', en: 'Translate one selected audio source.', fr: 'Traduire une source audio sélectionnée.' },
    hint_two_way:           { vi: 'Chế độ gọi chỉ dùng Soniox Cloud: âm thanh hệ thống → ngôn ngữ của bạn, micro → ngôn ngữ người kia.', en: 'Call mode uses Soniox Cloud only: system audio → your language, microphone → other person\'s language.', fr: 'Mode appel utilise Soniox Cloud: audio système → votre langue, micro → langue de l\'autre.' },
    field_my_lang:          { vi: 'Ngôn ngữ của tôi',                en: 'My language',                      fr: 'Ma langue' },
    field_other_lang:       { vi: 'Ngôn ngữ người kia',              en: 'Other person\'s language',         fr: 'Langue de l\'autre' },
    checkbox_speak_both:    { vi: 'Đọc âm thanh đã dịch ở cả hai hướng', en: 'Speak translated audio in both directions', fr: 'Lire l\'audio traduit dans les deux sens' },
    checkbox_mute_mic:      { vi: 'Tắt tiếng micro gốc',             en: 'Mute original mic route',          fr: 'Couper le micro d\'origine' },
    checkbox_send_voice:    { vi: 'Gửi giọng gốc của tôi cho người kia (họ nghe giọng tôi + bản dịch)', en: 'Send my original voice to the other person (they hear my voice + translation)', fr: 'Envoyer ma voix à l\'autre (il entend ma voix + traduction)' },
    checkbox_play_voice:    { vi: 'Phát giọng gốc người kia cho tôi (tôi nghe giọng họ + bản dịch)', en: 'Play other person\'s original voice to me (I hear their voice + translation)', fr: 'Jouer la voix de l\'autre pour moi (j\'entends sa voix + traduction)' },
    field_mic:              { vi: 'Micro (giọng tôi)',               en: 'Microphone (my voice)',            fr: 'Microphone (ma voix)' },
    option_default:         { vi: 'Mặc định hệ thống',               en: 'System Default',                   fr: 'Par défaut' },
    hint_mic_vb:            { vi: 'Trong thiết lập VB-Cable, ghi âm mặc định của Windows thường là CABLE Output — hãy chọn mic tai nghe thật của bạn ở đây để giọng nói được nhận dạng chính xác.', en: 'In a VB-Cable call setup, Windows default recording is often CABLE Output — pick your real headset mic here.', fr: 'Dans une configuration VB-Cable, l\'enregistrement par défaut Windows est souvent CABLE Output — choisissez votre vrai micro ici.' },
    hint_warning:           { vi: 'Dùng tai nghe để tránh echo. Để người kia nghe bản dịch, cài VB-Audio Virtual Cable, sau đó trong tab TTS đặt "Gửi-đi-xa → CABLE Input" và trong ứng dụng gọi đặt micro thành CABLE Output. Đặt "Đọc-cho-tôi" là tai nghe thật.', en: 'Use headphones to avoid echo. Install VB-Audio Virtual Cable, then set TTS tab "Send-to-remote → CABLE Input" and call app mic to CABLE Output.', fr: 'Utilisez un casque pour éviter l\'écho. Installez VB-Audio Virtual Cable, puis réglez "Envoyer-à-distance → CABLE Input" et le micro de l\'appel sur CABLE Output.' },
    field_source:           { vi: 'Nguồn',                           en: 'Source',                           fr: 'Source' },
    opt_auto_detect:        { vi: 'Tự động',                         en: 'Auto-detect',                     fr: 'Auto-détection' },
    field_target:           { vi: 'Đích',                            en: 'Target',                          fr: 'Cible' },
    field_audio_source:     { vi: 'Nguồn âm thanh',                  en: 'Audio Source',                    fr: 'Source audio' },
    opt_system:             { vi: 'Hệ thống',                        en: 'System',                          fr: 'Système' },
    opt_mic:                { vi: 'Micro',                           en: 'Mic',                             fr: 'Micro' },
    opt_both:               { vi: 'Cả hai',                          en: 'Both',                            fr: 'Les deux' },
    field_context:          { vi: 'Ngữ cảnh',                        en: 'Context',                         fr: 'Contexte' },
    optional_badge:         { vi: 'Tùy chọn',                        en: 'Optional',                        fr: 'Optionnel' },
    ctx_placeholder:        { vi: 'VD: Bài giảng đạo, Họp kỹ thuật...', en: 'e.g. Catholic sermon, Tech meeting...', fr: 'Ex: Sermon catholique, Réunion technique...' },
    hint_terms:             { vi: 'Thuật ngữ dịch thuật',            en: 'Translation terms',               fr: 'Termes de traduction' },
    label_popular:          { vi: 'Phổ biến',                        en: 'Popular',                         fr: 'Populaire' },
    label_all_languages:    { vi: 'Tất cả ngôn ngữ',                 en: 'All Languages',                   fr: 'Toutes les langues' },

    // ─── Display tab ────────────────────────────────
    field_opacity:          { vi: 'Độ mờ',                           en: 'Opacity',                         fr: 'Opacité' },
    field_font_size:        { vi: 'Cỡ chữ',                          en: 'Font Size',                       fr: 'Taille police' },
    field_max_lines:        { vi: 'Số dòng tối đa',                  en: 'Max Lines',                       fr: 'Lignes max' },
    checkbox_show_original: { vi: 'Hiển thị văn bản gốc',            en: 'Show original text',              fr: 'Afficher le texte original' },

    // ─── TTS tab ────────────────────────────────────
    field_provider:         { vi: 'Nhà cung cấp',                    en: 'Provider',                        fr: 'Fournisseur' },
    opt_edge_tts:           { vi: '🎙️ Edge TTS — Miễn phí',          en: '🎙️ Edge TTS — Free',               fr: '🎙️ Edge TTS — Gratuit' },
    opt_soniox_tts:         { vi: '🎯 Soniox TTS — Cao cấp',         en: '🎯 Soniox TTS — Premium',          fr: '🎯 Soniox TTS — Premium' },
    opt_google_tts:         { vi: '🌐 Google Chirp 3 HD — Cao cấp',   en: '🌐 Google Chirp 3 HD — Premium',    fr: '🌐 Google Chirp 3 HD — Premium' },
    opt_elevenlabs_tts:     { vi: '✨ ElevenLabs — Cao cấp',          en: '✨ ElevenLabs — Premium',           fr: '✨ ElevenLabs — Premium' },
    hint_tts_edge:          { vi: 'Miễn phí, giọng tự nhiên — không cần khóa API', en: 'Free, natural voices — no API key needed', fr: 'Gratuit, voix naturelles — aucune clé API requise' },
    hint_tts_soniox:        { vi: 'Dùng khóa API Soniox của bạn (giống với phiên âm)', en: 'Uses your Soniox API key (same as transcription)', fr: 'Utilise votre clé API Soniox (identique à la transcription)' },
    hint_tts_google:        { vi: 'Chất lượng gần giống người thật — yêu cầu khóa API Google Cloud (1 triệu ký tự/tháng miễn phí)', en: 'Near-human quality — requires Google Cloud API key (1M chars/month free)', fr: 'Qualité quasi-humaine — nécessite clé API Google Cloud (1M caractères/mois gratuit)' },
    hint_tts_elevenlabs:    { vi: 'Chất lượng cao cấp — yêu cầu khóa API ElevenLabs', en: 'Premium quality — requires ElevenLabs API key', fr: 'Qualité premium — nécessite clé API ElevenLabs' },
    field_voice:            { vi: 'Giọng',                           en: 'Voice',                           fr: 'Voix' },
    field_speed:            { vi: 'Tốc độ',                          en: 'Speed',                           fr: 'Vitesse' },
    field_google_api_key:   { vi: 'Khóa API Google Cloud',           en: 'Google Cloud API Key',            fr: 'Clé API Google Cloud' },
    field_elevenlabs_key:   { vi: 'Khóa API ElevenLabs',             en: 'ElevenLabs API Key',              fr: 'Clé API ElevenLabs' },
    elevenlabs_placeholder: { vi: 'Nhập khóa...',                    en: 'Enter key...',                    fr: 'Entrez la clé...' },
    hint_elevenlabs:        { vi: 'elevenlabs.io — Chất lượng cao cấp', en: 'elevenlabs.io — Premium quality', fr: 'elevenlabs.io — Qualité premium' },
    hint_google_howto:      { vi: 'console.cloud.google.com → Bật Text-to-Speech API → Tạo API Key', en: 'console.cloud.google.com → Enable Text-to-Speech API → Create API Key', fr: 'console.cloud.google.com → Activer Text-to-Speech API → Créer une clé API' },
    hint_loading_voices:    { vi: 'Đang tải giọng...',               en: 'Loading voices...',               fr: 'Chargement des voix...' },
    field_tts_devices:      { vi: 'Thiết bị xuất TTS gọi hai chiều', en: 'Two-way call TTS output devices',  fr: 'Périphériques sortie TTS appel bidirectionnel' },
    hint_tts_devices:       { vi: 'Chọn nơi phát từng bản dịch. "Đọc cho tôi" nên là tai nghe thật; "Gửi đi xa" nên là CABLE Input (VB-Audio) để ứng dụng gọi nghe được.', en: 'Pick where each translation plays. "Read for me" = your headphones; "Send to remote" = CABLE Input.', fr: 'Choisissez où jouer chaque traduction. "Lire pour moi" = votre casque; "Envoyer à distance" = CABLE Input.' },
    label_read_to_me:       { vi: 'Đọc cho tôi → tai nghe',          en: 'Read-for-me → my headphones',     fr: 'Lire pour moi → mon casque' },
    label_send_to_remote:   { vi: 'Gửi đi xa → CABLE Input',         en: 'Send-to-remote → CABLE Input',    fr: 'Envoyer à distance → CABLE Input' },
    btn_save:               { vi: 'Lưu & Đóng',                      en: 'Save & Close',                    fr: 'Sauvegarder & Fermer' },

    // ─── Setup modal ─────────────────────────────────
    setup_title:            { vi: 'Thiết lập mô hình Local',         en: 'Setting up Local Models',         fr: 'Configuration des modèles locaux' },
    setup_desc:             { vi: 'Đang tải và cài đặt mô hình MLX cho dịch ngoại tuyến. Chỉ thực hiện một lần.', en: 'Downloading and installing MLX models for offline translation. One-time setup.', fr: 'Téléchargement et installation des modèles MLX pour la traduction hors ligne. Configuration unique.' },
    setup_step_python:      { vi: 'Đang kiểm tra Python',            en: 'Checking Python',                 fr: 'Vérification de Python' },
    setup_step_env:         { vi: 'Đang tạo môi trường',             en: 'Creating environment',            fr: 'Création de l\'environnement' },
    setup_step_packages:    { vi: 'Đang cài đặt gói',               en: 'Installing packages',             fr: 'Installation des packages' },
    setup_step_models:      { vi: 'Đang tải mô hình (~5GB)',         en: 'Downloading models (~5GB)',       fr: 'Téléchargement des modèles (~5GB)' },
    setup_preparing:        { vi: 'Đang chuẩn bị...',               en: 'Preparing...',                    fr: 'Préparation...' },
    setup_cancel:           { vi: 'Hủy',                             en: 'Cancel',                          fr: 'Annuler' },

    // ─── Toast messages (app.js) ─────────────────────
    toast_copied:           { vi: 'Đã sao chép vào clipboard',       en: 'Copied to clipboard',             fr: 'Copié dans le presse-papier' },
    toast_nothing_copy:     { vi: 'Không có gì để sao chép',         en: 'Nothing to copy',                 fr: 'Rien à copier' },
    toast_open_failed:      { vi: 'Không mở được thư mục: ',         en: 'Failed to open folder: ',          fr: 'Impossible d\'ouvrir le dossier: ' },
    toast_settings_saved:   { vi: 'Đã lưu cài đặt',                 en: 'Settings saved',                  fr: 'Paramètres sauvegardés' },
    toast_save_failed:      { vi: 'Lưu thất bại: ',                 en: 'Failed to save: ',                fr: 'Échec de la sauvegarde: ' },
    toast_no_elevenlabs_key:{ vi: 'Thêm khóa API ElevenLabs trong Cài đặt → TTS', en: 'Add ElevenLabs API key in Settings → TTS', fr: 'Ajoutez la clé API ElevenLabs dans Paramètres → TTS' },
    toast_no_google_key:    { vi: 'Thêm khóa API Google TTS trong Cài đặt → TTS', en: 'Add Google TTS API key in Settings → TTS', fr: 'Ajoutez la clé API Google TTS dans Paramètres → TTS' },
    toast_no_soniox_key:    { vi: 'Thêm khóa API Soniox trong Cài đặt → TTS', en: 'Add Soniox API key in Settings → TTS', fr: 'Ajoutez la clé API Soniox dans Paramètres → TTS' },
    toast_tts_on:           { vi: 'TTS tường thuật BẬT',            en: 'TTS narration ON',                fr: 'Narration TTS ACTIVÉE' },
    toast_tts_off:          { vi: 'TTS tường thuật TẮT',            en: 'TTS narration OFF',               fr: 'Narration TTS DÉSACTIVÉE' },
    toast_tts_nghe_on:      { vi: 'TTS nghe BẬT',                   en: 'TTS listen ON',                   fr: 'TTS écoute ACTIVÉ' },
    toast_tts_nghe_off:     { vi: 'TTS nghe TẮT',                   en: 'TTS listen OFF',                  fr: 'TTS écoute DÉSACTIVÉ' },
    toast_tts_gui_on:       { vi: 'TTS gửi BẬT',                    en: 'TTS send ON',                     fr: 'TTS envoi ACTIVÉ' },
    toast_tts_gui_off:      { vi: 'TTS gửi TẮT',                    en: 'TTS send OFF',                    fr: 'TTS envoi DÉSACTIVÉ' },
    toast_switched_system:  { vi: 'Đã chuyển sang Âm thanh hệ thống', en: 'Switched to System Audio',        fr: 'Bascule vers Audio système' },
    toast_switched_mic:     { vi: 'Đã chuyển sang Micro',            en: 'Switched to Microphone',          fr: 'Bascule vers Microphone' },
    toast_source_system:    { vi: 'Nguồn: Âm thanh hệ thống',        en: 'Source: System Audio',            fr: 'Source: Audio système' },
    toast_source_mic:       { vi: 'Nguồn: Micro',                    en: 'Source: Microphone',              fr: 'Source: Microphone' },
    toast_need_soniox_key:  { vi: 'Cần khóa API Soniox. Thêm trong Cài đặt.', en: 'Soniox API key is required. Add it in Settings.', fr: 'Clé API Soniox requise. Ajoutez-la dans Paramètres.' },
    toast_missing_elevenlabs:{ vi: 'TTS đang BẬT nhưng thiếu khóa API ElevenLabs. Thêm trong Cài đặt hoặc tắt TTS.', en: 'TTS is ON but ElevenLabs API key is missing. Add it in Settings or disable TTS.', fr: 'TTS ACTIVÉ mais clé API ElevenLabs manquante. Ajoutez-la dans Paramètres ou désactivez TTS.' },
    toast_audio_error:      { vi: 'Lỗi âm thanh: ',                 en: 'Audio error: ',                   fr: 'Erreur audio: ' },
    toast_two_way_error:    { vi: 'Lỗi âm thanh hai chiều: ',       en: 'Two-way audio error: ',           fr: 'Erreur audio bidirectionnelle: ' },
    toast_remote_audio:     { vi: 'Âm thanh từ xa: ',               en: 'Remote audio: ',                  fr: 'Audio distant: ' },
    toast_mic_error:        { vi: 'Micro: ',                        en: 'Microphone: ',                    fr: 'Microphone: ' },
    toast_perm_error:       { vi: 'Cần quyền âm thanh: ',           en: 'Audio permission required: ',     fr: 'Permission audio requise: ' },
    toast_setup_mlx:        { vi: 'Đang thiết lập mô hình MLX (một lần, ~5GB)...', en: 'Setting up MLX models (one-time, ~5GB)...', fr: 'Configuration des modèles MLX (unique, ~5GB)...' },
    toast_starting_pipeline:{ vi: 'Đang khởi động pipeline cục bộ...', en: 'Starting local pipeline...',    fr: 'Démarrage du pipeline local...' },
    toast_pipeline_error:   { vi: 'Lỗi pipeline: ',                 en: 'Pipeline error: ',                fr: 'Erreur pipeline: ' },
    toast_audio_loading:    { vi: 'Âm thanh: %s. Pipeline vẫn đang tải...', en: 'Audio: %s. Pipeline still loading...', fr: 'Audio: %s. Pipeline encore en chargement...' },
    toast_models_ready:     { vi: 'Mô hình cục bộ đã sẵn sàng!',     en: 'Local models ready!',             fr: 'Modèles locaux prêts!' },
    toast_saved:            { vi: 'Đã lưu: ',                       en: 'Saved: ',                         fr: 'Sauvegardé: ' },
    toast_save_fail_transcript:{ vi: 'Lưu transcript thất bại',      en: 'Failed to save transcript',       fr: 'Échec de la sauvegarde du transcript' },
    toast_pinned:           { vi: 'Đã ghim trên cùng',              en: 'Pinned on top',                   fr: 'Épinglé en haut' },
    toast_unpinned:         { vi: 'Đã bỏ ghim — cửa sổ có thể ra sau ứng dụng khác', en: 'Unpinned — window can go behind other apps', fr: 'Désépinglé — la fenêtre peut passer derrière' },
    toast_error:            { vi: 'Lỗi: ',                          en: 'Error: ',                         fr: 'Erreur: ' },
    toast_two_way_muted:    { vi: 'Chế độ hai chiều: đã tắt tiếng micro gốc. Dùng CABLE Output làm micro ứng dụng gọi.', en: 'Two-way mode: original mic route muted. Use CABLE Output as the call app microphone.', fr: 'Mode bidirectionnel: micro d\'origine coupé. Utilisez CABLE Output comme micro de l\'appel.' },
    toast_two_way_normal:   { vi: 'Chế độ hai chiều: dùng tai nghe; định tuyến TTS đến CABLE Input nếu cần.', en: 'Two-way mode: use headphones; route TTS to CABLE Input if needed.', fr: 'Mode bidirectionnel: utilisez un casque; acheminez TTS vers CABLE Input si nécessaire.' },

    // ─── Two-way transcript ──────────────────────────
    panel_remote:           { vi: 'Người kia',  en: 'Other person',  fr: 'L\'autre' },
    panel_me:               { vi: 'Mình',       en: 'Me',            fr: 'Moi' },
    panel_empty:            { vi: 'Đang chờ âm thanh...', en: 'Waiting for audio...', fr: 'En attente d\'audio...' },
    label_speaker:          { vi: 'Người nói',  en: 'Speaker',       fr: 'Intervenant' },
    label_pending:          { vi: '...',        en: '...',           fr: '...' },

    // ─── Language names ──────────────────────────────
    lang_vi:                { vi: 'Tiếng Việt',     en: 'Vietnamese',    fr: 'Vietnamien' },
    lang_en:                { vi: 'Tiếng Anh',      en: 'English',       fr: 'Anglais' },
    lang_ja:                { vi: 'Tiếng Nhật',     en: 'Japanese',      fr: 'Japonais' },
    lang_ko:                { vi: 'Tiếng Hàn',      en: 'Korean',        fr: 'Coréen' },
    lang_zh:                { vi: 'Tiếng Trung',    en: 'Chinese',       fr: 'Chinois' },
    lang_fr:                { vi: 'Tiếng Pháp',     en: 'French',        fr: 'Français' },
    lang_de:                { vi: 'Tiếng Đức',      en: 'German',        fr: 'Allemand' },
    lang_es:                { vi: 'Tiếng Tây Ban Nha', en: 'Spanish',    fr: 'Espagnol' },
    lang_th:                { vi: 'Tiếng Thái',     en: 'Thai',          fr: 'Thaï' },
    lang_id:                { vi: 'Tiếng Indonesia', en: 'Indonesian',   fr: 'Indonésien' },
};

// ─── UI Apply Function ───────────────────────────────

class I18n {
    constructor() {
        this.currentLang = 'vi';
    }

    /**
     * Get translated string by key
     */
    t(key) {
        const entry = TRANSLATIONS[key];
        if (!entry) return key;
        return entry[this.currentLang] || entry.en || key;
    }

    /**
     * Switch UI language and update all DOM elements
     */
    setLanguage(lang) {
        if (!TRANSLATIONS.status_ready[lang]) {
            console.warn('[i18n] Unsupported language:', lang);
            return;
        }
        this.currentLang = lang;
        this._applyToDOM();
        document.documentElement.lang = lang;
        console.log('[i18n] Language switched to', lang);
    }

    /**
     * Apply all translations to the DOM
     */
    _applyToDOM() {
        // ─── Status ────────────────────────────────
        this._setText('status-text', 'status_ready');

        // ─── Toolbar tooltips ──────────────────────
        this._setTitle('btn-settings', 'tooltip_settings');
        this._setTitle('btn-source-system', 'tooltip_system_audio');
        this._setTitle('btn-source-mic', 'tooltip_microphone');
        this._setTitle('btn-start', 'tooltip_start_stop');
        this._setTitle('btn-tts', 'tooltip_tts');
        this._setTitle('btn-tts-remote-to-me', 'tooltip_tts_remote');
        this._setTitle('btn-tts-me-to-remote', 'tooltip_tts_me');
        this._setTitle('btn-clear', 'tooltip_clear');
        this._setTitle('btn-copy', 'tooltip_copy');
        this._setTitle('btn-open-transcripts', 'tooltip_open');
        this._setTitle('btn-compact', 'tooltip_compact');
        this._setTitle('btn-pin', 'tooltip_pin');
        this._setTitle('btn-minimize', 'tooltip_minimize');
        this._setTitle('btn-close', 'tooltip_close');
        this._setTitle('btn-font-down', 'tooltip_font_down');
        this._setTitle('btn-font-up', 'tooltip_font_up');
        this._setTitle('btn-view-mode', 'tooltip_dual_view');
        this._setTitle('btn-back', 'tooltip_back');
        this._setTitle('btn-save-settings-top', 'tooltip_save_close');
        this._setTitle('btn-toggle-key', 'tooltip_show_hide');
        this._setTitle('btn-toggle-google-key', 'tooltip_show_hide');
        this._setTitle('btn-toggle-elevenlabs-key', 'tooltip_show_hide');
        this._setTitle('btn-add-term', 'tooltip_add_term');

        // Color buttons
        const colorDots = document.querySelectorAll('.color-dot');
        if (colorDots.length >= 3) {
            colorDots[0].title = this.t('tooltip_color_white');
            colorDots[1].title = this.t('tooltip_color_yellow');
            colorDots[2].title = this.t('tooltip_color_cyan');
        }

        // ─── Settings header ────────────────────────
        this._setText('settings-title', 'settings_title');

        // Tab labels
        this._setTextBySelector('.settings-tab[data-tab="tab-translation"]', 'tab_translation');
        this._setTextBySelector('.settings-tab[data-tab="tab-display"]', 'tab_display');
        this._setTextBySelector('.settings-tab[data-tab="tab-tts"]', 'tab_tts');

        // ─── Translation tab ────────────────────────
        this._setTextBySelector('.settings-section:first-child .field-label', 'field_engine');
        this._setTextBySelector('option[value="soniox"]', 'opt_cloud');
        this._setTextBySelector('option[value="local"]', 'opt_local');
        this._setText('hint-mode-soniox', 'hint_soniox_mode');
        this._setText('hint-mode-local', 'hint_local_mode');
        this._setTextBySelector('#section-api-key .field-label', 'field_api_key');
        this._setTextBySelector('.required-badge', 'required_badge');
        this._setPlaceholder('input-api-key', 'api_key_placeholder');
        this._setTextBySelector('#section-api-key .hint', 'hint_get_key');
        this._setTextBySelector('#section-two-way-languages .field:nth-child(1) .field-label', 'field_my_lang');
        this._setTextBySelector('#section-two-way-languages .field:nth-child(2) .field-label', 'field_other_lang');

        // One-way section
        this._setTextBySelector('#section-one-way-languages .field:first-child .field-label', 'field_source');
        this._setTextBySelector('option[value="auto"]', 'opt_auto_detect');
        this._setTextBySelector('#section-one-way-languages .field:last-child .field-label', 'field_target');
        this._setTextBySelector('optgroup[label="Popular"]', 'label_popular', true);
        this._setTextBySelector('optgroup[label="All Languages"]', 'label_all_languages', true);

        // Direction
        this._setTextBySelector('#tab-translation > .settings-section:nth-child(3) .field-label', 'field_direction');
        this._setText('hint-direction-one-way', 'hint_one_way');
        this._setText('hint-direction-two-way', 'hint_two_way');

        // Checkboxes
        this._setTextBySelector('#check-two-way-tts + .checkbox-label', 'checkbox_speak_both');
        this._setTextBySelector('#check-two-way-mute-original-mic + .checkbox-label', 'checkbox_mute_mic');
        this._setTextBySelector('#check-send-original-voice + .checkbox-label', 'checkbox_send_voice');
        this._setTextBySelector('#check-play-original-voice + .checkbox-label', 'checkbox_play_voice');

        // Mic field
        this._setTextBySelector('#section-two-way-languages .field:nth-child(6) .field-label', 'field_mic');
        this._setTextBySelector('#section-two-way-languages .field:nth-child(7) .hint:not(.warning-hint)', 'hint_mic_vb');
        this._setTextBySelector('.warning-hint', 'hint_warning');

        // Audio source
        this._setTextBySelector('#tab-translation > .settings-section:nth-child(5) .field-label', 'field_audio_source');

        // Context
        this._setTextBySelector('#section-soniox-context .field-label', 'field_context');
        this._setTextBySelector('.optional-badge', 'optional_badge');
        this._setPlaceholder('input-context-domain', 'ctx_placeholder');
        this._setTextBySelector('.terms-header .hint', 'hint_terms');

        // ─── Display tab ────────────────────────────
        this._setTextBySelector('#tab-display .slider-field:nth-child(1) .field-label', 'field_opacity');
        this._setTextBySelector('#tab-display .slider-field:nth-child(2) .field-label', 'field_font_size');
        this._setTextBySelector('#tab-display .slider-field:nth-child(3) .field-label', 'field_max_lines');
        this._setTextBySelector('#check-show-original + .checkbox-label', 'checkbox_show_original');

        // ─── TTS tab ────────────────────────────────
        this._setTextBySelector('#tab-tts > .settings-section:first-child .field-label', 'field_provider');
        this._setText('tts-provider-hint', 'hint_tts_edge');
        this._setTextBySelector('#tts-edge-settings .field .field-label', 'field_voice');
        this._setTextBySelector('#tts-edge-settings .slider-field .field-label', 'field_speed');
        this._setTextBySelector('#tts-soniox-settings .field .field-label', 'field_voice');
        this._setTextBySelector('#tts-soniox-settings .hint:first-child', 'hint_tts_soniox');
        this._setTextBySelector('#tts-google-settings > .field-label', 'field_google_api_key');
        this._setTextBySelector('#tts-google-settings .field:first-child .field-label', 'field_voice');
        this._setTextBySelector('#tts-google-settings .slider-field .field-label', 'field_speed');
        this._setTextBySelector('#tts-elevenlabs-settings > .field-label', 'field_elevenlabs_key');
        this._setPlaceholder('input-elevenlabs-key', 'elevenlabs_placeholder');
        this._setTextBySelector('#tts-elevenlabs-settings .hint:first-child', 'hint_elevenlabs');
        this._setTextBySelector('#tts-elevenlabs-settings .field .field-label', 'field_voice');

        // TTS output devices
        this._setTextBySelector('#tts-output-devices > .field-label', 'field_tts_devices');
        this._setTextBySelector('#tts-output-devices > .hint:first-child', 'hint_tts_devices');
        this._setTextBySelector('#tts-output-devices .field:nth-child(3) .field-label', 'label_read_to_me');
        this._setTextBySelector('#tts-output-devices .field:nth-child(4) .field-label', 'label_send_to_remote');

        // ─── Setup modal ────────────────────────────
        this._setText('setup-modal-title', 'setup_title');
        this._setTextBySelector('.modal-desc', 'setup_desc');
        this._setTextBySelector('#step-check .step-text', 'setup_step_python');
        this._setTextBySelector('#step-venv .step-text', 'setup_step_env');
        this._setTextBySelector('#step-packages .step-text', 'setup_step_packages');
        this._setTextBySelector('#step-models .step-text', 'setup_step_models');
        this._setText('setup-status-text', 'setup_preparing');
        this._setTextBySelector('#btn-cancel-setup', 'setup_cancel');

        // ─── Save button ────────────────────────────
        this._setTextBySelector('#btn-save-settings', 'btn_save');

        // ─── Placeholder text ───────────────────────
        const placeholder = document.querySelector('.transcript-placeholder p');
        if (placeholder) placeholder.textContent = this.t('placeholder_text');
        const shortcutHint = document.querySelector('.shortcut-hint');
        if (shortcutHint) shortcutHint.textContent = this.t('shortcut_hint');

        // ─── Two-way transcript panels ──────────────
        const panelHeaders = document.querySelectorAll('.two-way-panel-header');
        if (panelHeaders.length >= 2) {
            panelHeaders[0].textContent = this.t('panel_remote');
            panelHeaders[1].textContent = this.t('panel_me');
        }

        // ─── Language buttons in lang switcher ──────
        const langBtns = document.querySelectorAll('.lang-btn');
        langBtns.forEach(btn => {
            const l = btn.getAttribute('data-lang');
            if (l) btn.title = this.t('lang_' + l);
        });

        // ─── Default option text ────────────────────
        const defaultOptions = document.querySelectorAll('option[value="default"]');
        defaultOptions.forEach(opt => {
            opt.textContent = this.t('option_default');
        });
    }

    /**
     * Set textContent of an element by ID
     */
    _setText(id, key) {
        const el = document.getElementById(id);
        if (el) el.textContent = this.t(key);
    }

    /**
     * Set textContent of elements by CSS selector
     */
    _setTextBySelector(selector, key, useLabel = false) {
        const el = document.querySelector(selector);
        if (el) {
            if (useLabel && el.tagName === 'OPTGROUP') {
                el.label = this.t(key);
            } else {
                el.textContent = this.t(key);
            }
        }
    }

    /**
     * Set title attribute of an element by ID
     */
    _setTitle(id, key) {
        const el = document.getElementById(id);
        if (el) el.title = this.t(key);
    }

    /**
     * Set placeholder attribute of an element by ID
     */
    _setPlaceholder(id, key) {
        const el = document.getElementById(id);
        if (el) el.placeholder = this.t(key);
    }
}

// Singleton
export const i18n = new I18n();