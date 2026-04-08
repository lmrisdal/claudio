use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_mica;
#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

pub(crate) fn apply_window_material(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Err(error) = apply_vibrancy(
        window,
        NSVisualEffectMaterial::UnderWindowBackground,
        None,
        None,
    ) {
        log::warn!(
            "Failed to apply vibrancy to window '{}': {}",
            window.label(),
            error
        );
    }

    #[cfg(target_os = "windows")]
    if let Err(error) = apply_mica(window, None) {
        log::warn!(
            "Failed to apply mica to window '{}': {}",
            window.label(),
            error
        );
    }
}
