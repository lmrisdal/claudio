mod commands;
mod settings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping::ping,
            commands::get_settings,
            commands::update_settings,
        ])
        .setup(|app| {
            use tauri::Manager;
            let window = app.get_webview_window("main").unwrap();

            // On Windows/Linux, disable native decorations so the React
            // custom title bar is used instead. On macOS, the config sets
            // titleBarStyle: Overlay which shows only the traffic lights.
            #[cfg(not(target_os = "macos"))]
            window.set_decorations(false)?;

            let _ = window;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Claudio");
}
