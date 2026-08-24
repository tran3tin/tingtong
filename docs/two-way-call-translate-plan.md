# Kế hoạch thêm tùy chọn dịch 2 chiều kiểu AI Call Translate

## 1. Mục tiêu

Thêm một chế độ dịch 2 chiều giống Samsung Galaxy AI Live Translate:

- Khi **người kia nói tiếng Anh** qua âm thanh hệ thống, app hiển thị/nghe **tiếng Việt** cho mình.
- Khi **mình nói tiếng Việt** qua micro, app dịch sang **tiếng Anh** và đọc bằng giọng AI để người kia nghe.

Ứng dụng hiện tại đã có luồng dịch 1 chiều:

```text
Audio Source: System hoặc Microphone
→ Capture PCM 16kHz mono
→ Soniox STT + Translate
→ Hiển thị transcript
→ TTS đọc bản dịch nếu bật
```

Tính năng mới sẽ mở rộng thành 2 luồng song song:

```text
Luồng A — Người kia → Mình
System Audio tiếng Anh
→ Soniox tiếng Anh → tiếng Việt
→ Hiển thị transcript
→ TTS tiếng Việt phát ra loa/tai nghe của mình

Luồng B — Mình → Người kia
Microphone tiếng Việt
→ Soniox tiếng Việt → tiếng Anh
→ Hiển thị transcript
→ TTS tiếng Anh phát ra thiết bị âm thanh dùng làm microphone ảo cho app gọi điện
```

---

## 2. Phạm vi phiên bản đầu tiên

### Có trong phiên bản đầu tiên

1. Thêm tùy chọn **Translation Direction** hoặc **Mode** trong Settings:
   - `1 chiều` — giữ hành vi hiện tại.
   - `2 chiều / Call Translate` — chạy cả System Audio và Microphone cùng lúc.

2. Thêm cấu hình ngôn ngữ cho 2 chiều:
   - **My language**: mặc định `Vietnamese`.
   - **Other person's language**: mặc định `English`.

3. Khi bật chế độ 2 chiều:
   - System Audio được dịch từ `Other language` sang `My language`.
   - Microphone được dịch từ `My language` sang `Other language`.

4. Hiển thị transcript có nhãn rõ ràng:
   - `Người kia` / `Them`
   - `Mình` / `Me`

5. TTS tự chọn voice theo hướng dịch:
   - Dịch sang tiếng Việt → dùng voice tiếng Việt.
   - Dịch sang tiếng Anh → dùng voice tiếng Anh.

6. Tạm thời vẫn phát âm thanh TTS ra output mặc định của máy.
   - Để người kia nghe được bản dịch tiếng Anh, người dùng cần dùng thêm **virtual audio cable / virtual microphone** hoặc cấu hình output phù hợp trong app gọi điện.

### Chưa làm trong phiên bản đầu tiên

1. Chưa tự động inject âm thanh dịch vào cuộc gọi như Samsung ở cấp hệ điều hành.
2. Chưa tự động chọn output device riêng cho từng hướng dịch.
3. Chưa khử echo hoàn chỉnh nếu âm thanh TTS bị capture ngược lại.
4. Chưa tích hợp sâu với app điện thoại/Teams/Zoom/Discord.

---

## 3. Các thay đổi kiến trúc cần làm

## 3.1. Settings

File liên quan:

- `src/js/settings.js`
- `src-tauri/src/settings.rs`
- `src/index.html`
- `src/js/app.js`

Thêm field mới:

```js
translation_direction: 'one_way' | 'two_way'
my_language: 'vi'
other_language: 'en'
two_way_tts_enabled: true
two_way_mute_original_mic: false
```

Trong Rust settings:

```rust
pub translation_direction: String,
pub my_language: String,
pub other_language: String,
pub two_way_tts_enabled: bool,
pub two_way_mute_original_mic: bool,
```

Giá trị mặc định:

```text
translation_direction = "one_way"
my_language = "vi"
other_language = "en"
two_way_tts_enabled = true
two_way_mute_original_mic = false
```

---

## 3.2. UI Settings

Trong tab Translation thêm section mới:

```text
Translation Mode
(•) One-way translation
( ) Two-way Call Translate

My language: Vietnamese
Other person's language: English

[ ] Auto-read translated voice for both sides
```

Khi chọn `One-way`, giữ UI hiện tại:

```text
Source
Target
Audio Source: System / Mic
```

Khi chọn `Two-way`, UI nên đổi thành:

```text
My language: Vietnamese
Other person's language: English
Audio sources: System + Microphone required
```

Không nên cho chọn `Audio Source: system/microphone/both` trong 2 chiều, vì chế độ này bắt buộc cần cả hai.

---

## 3.3. Backend audio capture

File hiện tại:

- `src-tauri/src/commands/audio.rs`
- `src-tauri/src/audio/microphone.rs`
- `src-tauri/src/audio/wasapi.rs`
- `src-tauri/src/audio/system_audio.rs`

Hiện tại `start_capture(source, channel)` chỉ chạy **một nguồn** và gọi `stop_capture_inner()` trước khi chạy nguồn mới.

Cần thêm API mới:

```rust
#[tauri::command]
pub fn start_capture_source(
    source: String,
    channel: Channel<Vec<u8>>,
    state: State<'_, AudioState>,
) -> Result<(), String>
```

Hoặc rõ ràng hơn:

```rust
#[tauri::command]
pub fn start_system_capture(channel: Channel<Vec<u8>>, state: State<'_, AudioState>) -> Result<(), String>

#[tauri::command]
pub fn start_microphone_capture(channel: Channel<Vec<u8>>, state: State<'_, AudioState>) -> Result<(), String>

#[tauri::command]
pub fn stop_system_capture(state: State<'_, AudioState>) -> Result<(), String>

#[tauri::command]
pub fn stop_microphone_capture(state: State<'_, AudioState>) -> Result<(), String>
```

Khuyến nghị: dùng API riêng cho từng nguồn để dễ quản lý 2 luồng độc lập.

### Thay đổi state

Hiện tại:

```rust
pub struct AudioState {
    pub system_audio: Mutex<SystemAudioCapture>,
    pub microphone: Mutex<MicCapture>,
    pub active_receiver: Mutex<Option<AudioForwarder>>,
}
```

Đề xuất:

```rust
pub struct AudioState {
    pub system_audio: Mutex<SystemAudioCapture>,
    pub microphone: Mutex<MicCapture>,
    pub system_forwarder: Mutex<Option<AudioForwarder>>,
    pub microphone_forwarder: Mutex<Option<AudioForwarder>>,
}
```

Lý do: chế độ 2 chiều cần system và mic chạy đồng thời; không thể dùng chung `active_receiver`.

---

## 3.4. Soniox client 2 phiên độc lập

File hiện tại:

- `src/js/soniox.js`
- `src/js/app.js`

Hiện tại app dùng singleton:

```js
export const sonioxClient = new SonioxClient();
```

Chế độ 2 chiều cần 2 kết nối WebSocket Soniox riêng:

```js
this.remoteClient = new SonioxClient(); // System audio: other → me
this.localClient = new SonioxClient();  // Mic audio: me → other
```

Hoặc đổi `soniox.js` để vừa export class vừa giữ singleton cho chế độ cũ:

```js
export class SonioxClient { ... }
export const sonioxClient = new SonioxClient();
```

Hiện tại class đã export sẵn, nên có thể import thêm:

```js
import { SonioxClient, sonioxClient } from './soniox.js';
```

### Cấu hình Soniox cho 2 chiều

Luồng người kia → mình:

```js
remoteClient.connect({
  apiKey,
  sourceLanguage: other_language, // en
  targetLanguage: my_language,    // vi
  customContext,
});
```

Luồng mình → người kia:

```js
localClient.connect({
  apiKey,
  sourceLanguage: my_language,    // vi
  targetLanguage: other_language, // en
  customContext,
});
```

---

## 3.5. App controller

File chính:

- `src/js/app.js`

Thêm state:

```js
this.translationDirection = 'one_way';
this.remoteClient = null;
this.localClient = null;
this.systemAudioChannel = null;
this.microphoneAudioChannel = null;
```

Thêm method:

```js
async _startTwoWayMode(settings) {}
async _stopTwoWayMode() {}
_configureTwoWayCallbacks(settings) {}
_speakForDirection(text, direction) {}
```

Trong `start()`:

```js
if (settings.translation_direction === 'two_way') {
    await this._startTwoWayMode(settings);
} else if (this.translationMode === 'local') {
    await this._startLocalMode(settings);
} else {
    await this._startSonioxMode(settings);
}
```

Lưu ý: phiên bản đầu tiên nên chỉ hỗ trợ 2 chiều với Soniox cloud. Local MLX có độ trễ 3-4s và hiện pipeline chỉ có một hướng, không phù hợp cho call translate realtime.

---

## 3.6. Transcript UI

File liên quan:

- `src/js/ui.js`
- `src/styles/main.css`

### Yêu cầu UI mới cho chế độ 2 chiều

Chế độ 2 chiều **không nên gộp transcript chung như hiện tại**. Thay vào đó, giao diện nên tách thành **2 cửa sổ / 2 panel riêng biệt**:

```text
┌──────────────────────────────┬──────────────────────────────┐
│ Người kia                    │ Mình                         │
│                              │                              │
│ original tiếng Anh — chữ mờ  │ original tiếng Việt — chữ mờ │
│ dịch tiếng Việt — chữ đậm    │ dịch tiếng Anh — chữ đậm     │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

Luồng hiển thị:

1. Khi **người kia nói**:
   - Panel `Người kia` nhận câu gốc của họ.
   - Câu gốc tiếng Anh hiển thị bằng **chữ mờ / nhỏ hơn**.
   - Bản dịch sang tiếng Việt hiển thị bằng **chữ đậm / nổi bật**.

2. Khi **mình nói**:
   - Panel `Mình` nhận câu gốc của mình.
   - Câu gốc tiếng Việt hiển thị bằng **chữ mờ / nhỏ hơn**.
   - Bản dịch sang tiếng Anh hiển thị bằng **chữ đậm / nổi bật**.

Mục tiêu là người dùng nhìn vào sẽ hiểu ngay:

- Cột trái: bên kia đang nói gì và mình hiểu gì.
- Cột phải: mình đã nói gì và app sẽ phát/dịch gì cho bên kia.

### Cấu trúc dữ liệu đề xuất

Hiện tại segment có:

```js
{ original, translation, status, speaker }
```

Đề xuất thêm `direction`:

```js
{
  original,
  translation,
  status,
  speaker,
  direction: 'remote_to_me' | 'me_to_remote'
}
```

### API UI đề xuất

Giữ method cũ cho chế độ 1 chiều:

```js
addOriginal(text, speaker)
addTranslation(text)
setProvisional(text, speaker)
```

Thêm method riêng cho chế độ 2 chiều:

```js
addOriginalForDirection(text, speaker, direction)
addTranslationForDirection(text, direction)
setProvisionalForDirection(text, speaker, direction)
```

Trong `_render()`, nếu chế độ là `two_way`, render thành 2 panel:

```text
remote_to_me  → panel Người kia
me_to_remote  → panel Mình
```

### CSS đề xuất

Thêm class:

```css
.two-way-transcript-grid {}
.two-way-panel {}
.two-way-panel-header {}
.two-way-original {}
.two-way-translation {}
.two-way-panel-remote {}
.two-way-panel-me {}
```

Style:

```css
.two-way-original {
  opacity: 0.55;
  font-size: 0.85em;
  font-weight: 400;
}

.two-way-translation {
  opacity: 1;
  font-size: 1em;
  font-weight: 700;
}
```

### Tương thích với chế độ hiện tại

- Chế độ `one_way`: giữ layout transcript hiện tại.
- Chế độ `two_way`: tự động chuyển sang layout 2 panel.
- Nút `dual view` hiện tại nếu đang dùng cho split original/translation cần được kiểm tra lại để không xung đột với layout 2 chiều.

---

## 3.7. TTS theo từng hướng

File liên quan:

- `src/js/edge-tts.js`
- `src/js/google-tts.js`
- `src/js/elevenlabs-tts.js`
- `src/js/audio-player.js`
- `src-tauri/src/commands/edge_tts.rs`

Hiện tại chỉ có một active TTS provider/voice từ Settings.

Trong 2 chiều cần chọn voice theo target language:

- `remote_to_me`: target = `my_language` → voice tiếng Việt.
- `me_to_remote`: target = `other_language` → voice tiếng Anh.

Với Edge TTS, có thể map mặc định:

```js
const EDGE_VOICE_BY_LANG = {
  vi: 'vi-VN-HoaiMyNeural',
  en: 'en-US-JennyNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
};
```

Phiên bản đầu tiên nên dùng Edge TTS cho 2 chiều vì:

- miễn phí,
- không cần API key,
- backend Rust đã có command `edge_tts_speak`,
- dễ đổi voice theo từng câu.

### Vấn đề quan trọng: phát âm thanh cho bên kia nghe

Máy tính không thể tự động gửi âm thanh TTS vào microphone của app gọi điện nếu không có virtual audio device.

Với Windows, giải pháp thực tế nhất là dùng **VB-Audio Virtual Cable** hoặc thiết bị audio ảo tương đương.

Cần phân biệt rõ 2 thiết bị của VB-CABLE:

```text
CABLE Input  = loa ảo / output device
CABLE Output = microphone ảo / input device
```

Luồng âm thanh đề xuất:

```text
MyTranslator phát TTS tiếng Anh vào: CABLE Input
Zoom/Meet/Discord/app gọi điện chọn microphone: CABLE Output
Người kia nghe âm thanh đi qua CABLE Output
```

Ví dụ chiều `Mình nói tiếng Việt → Người kia nghe tiếng Anh`:

```text
Micro thật của mình
→ MyTranslator thu âm
→ Soniox nhận diện tiếng Việt
→ dịch sang tiếng Anh
→ TTS đọc tiếng Anh
→ phát vào CABLE Input
→ app gọi điện đang chọn CABLE Output làm microphone
→ người kia nghe tiếng Anh
```

Các app phổ biến thường cho chọn `CABLE Output` làm microphone:

| App | Có chọn CABLE Output làm microphone không? | Nơi chọn |
| --- | --- | --- |
| Zoom | Có | Audio Settings → Microphone |
| Google Meet | Có | Menu chọn microphone trong Meet hoặc quyền microphone của trình duyệt |
| Discord | Có | User Settings → Voice & Video → Input Device |
| Microsoft Teams | Có | Settings → Devices → Microphone |
| Skype | Có | Audio & Video → Microphone |
| Zalo PC / Telegram Desktop | Thường có | Tùy phiên bản, chọn input device trong cài đặt audio |
| Messenger web / WhatsApp web | Thường có | Thường chọn qua trình duyệt / site microphone permission |

Lưu ý quan trọng:

- Nếu app gọi điện chọn `CABLE Output` làm microphone, app gọi điện sẽ **không tự nghe micro thật** nữa.
- Vì vậy MyTranslator phải là app thu micro thật, dịch, rồi phát bản dịch vào `CABLE Input`.
- Giai đoạn 1 chỉ nên hướng dẫn người dùng cấu hình thiết bị thủ công trong app gọi điện, chưa tự động can thiệp cài đặt của Zoom/Meet/Discord.

Với bản đầu tiên, trong app nên hiển thị hướng dẫn:

```text
Để người kia nghe bản dịch, hãy cài VB-Audio Virtual Cable.
Trong MyTranslator, chọn output TTS là CABLE Input.
Trong Zoom/Meet/Discord/app gọi điện, chọn microphone là CABLE Output.
```

Nếu muốn làm sâu hơn sau này, có thể thêm chọn output device trong app.

---

## 3.8. Chống lặp âm thanh / echo loop

Rủi ro lớn nhất của chế độ 2 chiều:

1. App phát TTS tiếng Việt cho mình nghe.
2. System Audio capture lại tiếng TTS đó.
3. Soniox dịch tiếp lần nữa.
4. Vòng lặp vô hạn.

Hoặc ở chiều ngược lại:

1. App phát TTS tiếng Anh vào `CABLE Input` để người kia nghe.
2. Nếu routing không đúng, audio này có thể bị microphone/system audio capture lại.
3. App lại nhận diện chính giọng AI vừa phát.
4. Tạo echo loop / tự dịch lặp.

### Giải pháp giai đoạn 1: hướng dẫn cấu hình, chưa xử lý kỹ thuật sâu

Giai đoạn 1 ưu tiên làm tính năng 2 chiều chạy được ổn định với cấu hình đơn giản:

- Khuyến nghị dùng tai nghe để tránh loa ngoài bị micro thu lại.
- Hướng dẫn rõ cách dùng VB-Audio Virtual Cable:
  - MyTranslator phát TTS cho người kia vào `CABLE Input`.
  - App gọi điện chọn microphone là `CABLE Output`.
- Hiển thị cảnh báo khi bật chế độ 2 chiều:

```text
Nên dùng tai nghe và cấu hình virtual cable đúng cách để tránh app dịch lại giọng AI của chính nó.
```

Không triển khai chống echo loop bằng thuật toán trong giai đoạn 1 để tránh làm phức tạp start/stop audio và làm tăng độ trễ.

### Giải pháp kỹ thuật giai đoạn 2

Chuyển các xử lý kỹ thuật chống lặp âm thanh sang giai đoạn 2:

- Tạm dừng gửi system audio lên Soniox trong lúc app đang phát TTS tiếng Việt cho mình nghe.
- Tạm dừng gửi microphone audio trong lúc app đang phát TTS tiếng Anh nếu output đi vào virtual mic.
- Thêm `audioPlayer.isPlaying` hoặc callback `onPlaybackStart/onPlaybackEnd` để mute capture theo hướng.
- Đánh dấu timestamp đoạn TTS vừa phát để bỏ qua audio thu lại trong một khoảng thời gian ngắn.
- Có thể thêm VAD / audio fingerprint đơn giản để phát hiện audio vừa phát bị thu lại.

Ý tưởng kỹ thuật giai đoạn 2:

```js
this.suppressSystemUntil = Date.now() + estimatedTtsDurationMs;
this.suppressMicUntil = Date.now() + estimatedTtsDurationMs;
```

Khi channel audio gửi lên Soniox:

```js
if (Date.now() < this.suppressSystemUntil) return;
```

Phần này không bắt buộc cho MVP, nhưng nên thiết kế code theo hướng dễ bổ sung sau.

---

## 4. Flow chi tiết chế độ 2 chiều

## 4.1. Start

```text
User bấm Start
→ App đọc settings
→ Nếu translation_direction = two_way:
    1. Kiểm tra Soniox API key
    2. Tạo remoteClient: other → my
    3. Tạo localClient: my → other
    4. Bind callback transcript/TTS cho từng client
    5. Connect cả 2 WebSocket
    6. Start system capture → gửi audio tới remoteClient
    7. Start microphone capture → gửi audio tới localClient
    8. Status = Listening 2-way
```

## 4.2. Khi người kia nói

```text
System audio chunk
→ remoteClient.sendAudio()
→ Soniox trả original tiếng Anh
→ Transcript: Người kia: ...
→ Soniox trả translation tiếng Việt
→ Transcript: Bạn nghe: ...
→ Edge TTS tiếng Việt đọc cho mình
```

## 4.3. Khi mình nói

```text
Microphone chunk
→ localClient.sendAudio()
→ Soniox trả original tiếng Việt
→ Transcript: Mình: ...
→ Soniox trả translation tiếng Anh
→ Transcript: Người kia nghe: ...
→ Edge TTS tiếng Anh phát ra output configured
```

## 4.4. Stop

```text
User bấm Stop
→ stop_system_capture
→ stop_microphone_capture
→ remoteClient.disconnect
→ localClient.disconnect
→ stop TTS/audioPlayer
→ auto-save transcript
```

---

## 5. File cần sửa

### Frontend

1. `src/index.html`
   - Thêm UI chọn `One-way / Two-way Call Translate`.
   - Thêm chọn `My language`, `Other person's language`.
   - Thêm hint về tai nghe/virtual cable.

2. `src/js/settings.js`
   - Thêm default settings mới.

3. `src/js/app.js`
   - Thêm state/method cho two-way mode.
   - Tạo 2 Soniox clients.
   - Start 2 capture channels.
   - TTS theo từng hướng.

4. `src/js/ui.js`
   - Thêm direction label cho transcript.
   - Giữ tương thích với code 1 chiều hiện tại.

5. `src/styles/main.css`
   - CSS cho two-way settings.
   - CSS cho transcript label `Mình` / `Người kia`.

### Backend Rust

6. `src-tauri/src/settings.rs`
   - Thêm fields settings mới.

7. `src-tauri/src/commands/audio.rs`
   - Tách forwarder system/microphone.
   - Thêm command start/stop riêng từng nguồn.
   - Giữ command `start_capture/stop_capture` hiện tại để không phá chế độ 1 chiều.

8. `src-tauri/src/lib.rs`
   - Register commands mới.

---

## 6. Rủi ro kỹ thuật

### 6.1. Hai nguồn audio đồng thời

Hiện `AudioState` chỉ giữ một `active_receiver`. Nếu không sửa backend, khi start mic sẽ stop system hoặc ngược lại.

Cần refactor cẩn thận để:

- One-way vẫn hoạt động như cũ.
- Two-way chạy system + mic đồng thời.
- Stop không bị deadlock.

### 6.2. Chi phí Soniox

Chế độ 2 chiều dùng 2 WebSocket realtime song song, chi phí có thể gần gấp đôi.

Nên hiển thị hint:

```text
Two-way mode uses two realtime streams and may cost roughly 2x.
```

### 6.3. Echo loop

Nếu không dùng tai nghe hoặc virtual cable đúng cách, app có thể dịch lại âm thanh của chính nó.

Cần có cảnh báo UI và cơ chế suppress đơn giản.

### 6.4. TTS output routing

Đây là phần khó nhất nếu muốn giống Samsung thật sự.

Phiên bản đầu tiên chỉ nên:

- Phát TTS ra output mặc định.
- Ghi rõ hướng dẫn dùng VB-Audio Cable.

Sau đó mới nâng cấp chọn output device trong app.

---

## 7. Thứ tự triển khai đề xuất

### Bước 1 — Settings + UI

- Thêm fields settings mới vào JS/Rust.
- Thêm UI chọn One-way/Two-way.
- Save/load settings.
- Ẩn/hiện section phù hợp.

### Bước 2 — Backend capture độc lập

- Refactor `AudioState` có `system_forwarder` và `microphone_forwarder`.
- Thêm command:
  - `start_system_capture`
  - `start_microphone_capture`
  - `stop_system_capture`
  - `stop_microphone_capture`
- Giữ `start_capture` cho chế độ cũ.

### Bước 3 — Two Soniox clients

- Import `SonioxClient` trong `app.js`.
- Tạo 2 clients cho 2 hướng.
- Gửi system audio vào remoteClient.
- Gửi mic audio vào localClient.

### Bước 4 — Transcript direction labels

- Cập nhật `TranscriptUI` hỗ trợ direction.
- Hiển thị `Mình` và `Người kia` rõ ràng.

### Bước 5 — TTS theo hướng

- Thêm hàm map language → Edge TTS voice.
- Khi remote → me: đọc bằng voice tiếng Việt.
- Khi me → remote: đọc bằng voice tiếng Anh.

### Bước 6 — Echo suppression cơ bản

- Khi app phát TTS, tạm bỏ qua audio chunk tương ứng trong 0.5-2 giây.
- Thêm cảnh báo nên dùng tai nghe.

### Bước 7 — Test

Test từng trường hợp:

1. One-way system audio vẫn hoạt động.
2. One-way mic vẫn hoạt động.
3. Two-way start được cả 2 capture.
4. System audio dịch EN → VI.
5. Microphone dịch VI → EN.
6. Stop dừng cả 2 nguồn.
7. Save transcript có cả 2 hướng.
8. Không lỗi khi thiếu API key.
9. Không crash khi một nguồn audio không khả dụng.

---

## 8. Gợi ý nâng cấp sau phiên bản đầu tiên

1. **Chọn output device cho từng hướng TTS**
   - Ví dụ:
     - Vietnamese voice → speaker/headphone của mình.
     - English voice → VB-Cable để gửi vào app gọi điện.

2. **Virtual microphone tích hợp**
   - Cần nghiên cứu driver/audio routing riêng, phức tạp hơn nhiều.

3. **Push-to-talk cho hướng mình nói**
   - Tránh micro luôn thu và dịch nhầm.

4. **Auto language pair quick presets**
   - Vietnamese ↔ English
   - Vietnamese ↔ Japanese
   - Vietnamese ↔ Korean
   - Vietnamese ↔ Chinese

5. **Noise gate / VAD**
   - Chỉ gửi audio khi phát hiện có giọng nói.
   - Giảm chi phí Soniox và giảm dịch nhầm.

6. **Separate volume controls**
   - Âm lượng tiếng dịch cho mình.
   - Âm lượng tiếng dịch gửi cho người kia.

7. **Delay/buffer tuning**
   - Tùy chọn ưu tiên tốc độ hoặc độ chính xác.

---

## 9. Câu hỏi cần bạn góp ý trước khi triển khai

1. Bạn muốn tên chế độ hiển thị là gì?
   - `Dịch 2 chiều`
   - `Call Translate`
   - `AI Call Translate`

2. Bạn muốn mặc định cặp ngôn ngữ nào?
   - `Mình: Tiếng Việt` / `Khách: Tiếng Anh`
   - Hay cặp khác?

3. Khi mình nói tiếng Việt, bạn muốn app:
   - chỉ hiển thị bản dịch tiếng Anh,
   - hay đọc tiếng Anh ra loa luôn?

4. Bạn có muốn mình thiết kế sẵn hướng dẫn dùng **VB-Audio Virtual Cable** trong app không?

5. Bạn muốn chế độ 2 chiều chỉ dùng **Soniox Cloud** trước, hay vẫn muốn cố hỗ trợ **Local MLX** dù độ trễ cao?

---

## 10. Khuyến nghị của mình

Nên làm phiên bản đầu tiên theo hướng:

```text
Two-way Call Translate = Soniox Cloud only + Edge TTS + transcript direction labels + warning dùng tai nghe/virtual cable
```

Lý do:

- Ít rủi ro nhất.
- Nhanh có bản chạy được.
- Giữ nguyên tính năng 1 chiều hiện tại.
- Dễ nâng cấp tiếp output device/virtual mic sau.
