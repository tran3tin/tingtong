//! Enumerate active Windows audio endpoints.
//!
//! WebView2 does not implement `AudioContext.setSinkId`, so per-device TTS
//! routing must happen at the OS level. `list_audio_devices` lists the render
//! (output) endpoints the user can choose from in Settings (real headphones for
//! "read-to-me", CABLE Input for "send-to-remote"). `list_microphone_devices`
//! lists capture (input) endpoints so the user can pick their real headset mic
//! for two-way capture instead of the OS default (which may be CABLE Output).

use serde::Serialize;
use windows::core::BSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

#[derive(Serialize, Clone)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// List active audio render (output) endpoints.
/// The first entry is always the system default render endpoint.
#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let devices = enumerate_endpoints(eRender);

        CoUninitialize();
        Ok(devices)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

/// List active audio capture (input) endpoints.
/// The first entry is always the system default capture endpoint.
/// Used by the two-way microphone-device selector so the user can pick their
/// real headset mic instead of the OS default (which may be CABLE Output).
#[tauri::command]
pub fn list_microphone_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let devices = enumerate_endpoints(eCapture);

        CoUninitialize();
        Ok(devices)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

/// Enumerate active endpoints of the given data-flow direction (eRender or
/// eCapture), placing the system default for that direction first.
#[cfg(target_os = "windows")]
unsafe fn enumerate_endpoints(direction: EDataFlow) -> Vec<AudioDeviceInfo> {
    let enumerator: IMMDeviceEnumerator = match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let default_id = match enumerator.GetDefaultAudioEndpoint(direction, eConsole) {
        Ok(dev) => dev.GetId().ok().and_then(|pwstr| pwstr.to_string().ok()),
        Err(_) => None,
    };

    let collection = match enumerator.EnumAudioEndpoints(direction, DEVICE_STATE_ACTIVE) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let count = collection.GetCount().unwrap_or(0);

    let mut devices: Vec<AudioDeviceInfo> = Vec::with_capacity(count as usize);

    // Default endpoint first (if present)
    if let Some(ref def_id) = default_id {
        let id = windows::core::HSTRING::from(def_id);
        if let Ok(dev) = enumerator.GetDevice(&id) {
            if let Some(info) = build_info(&dev, true) {
                devices.push(info);
            }
        }
    }

    for i in 0..count {
        let dev = match collection.Item(i) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let id = match dev.GetId() {
            Ok(pwstr) => pwstr.to_string().unwrap_or_default(),
            Err(_) => continue,
        };
        // Skip the default — already added first
        if let Some(ref def_id) = default_id {
            if def_id.eq_ignore_ascii_case(&id) {
                continue;
            }
        }
        if let Some(info) = build_info(&dev, false) {
            devices.push(info);
        }
    }

    devices
}

/// Build an `AudioDeviceInfo` from an `IMMDevice`, reading the friendly name
/// from its property store.
unsafe fn build_info(dev: &IMMDevice, is_default: bool) -> Option<AudioDeviceInfo> {
    let id = dev.GetId().ok()?.to_string().ok()?;

    let name = match dev.OpenPropertyStore(STGM_READ) {
        Ok(store) => read_friendly_name(&store).unwrap_or_else(|| id.clone()),
        Err(_) => id.clone(),
    };

    Some(AudioDeviceInfo { id, name, is_default })
}

unsafe fn read_friendly_name(store: &IPropertyStore) -> Option<String> {
    let prop = store
        .GetValue(&PKEY_Device_FriendlyName as *const _ as *const _)
        .ok()?;
    let bstr = BSTR::try_from(&prop).ok()?;
    Some(bstr.to_string())
}
