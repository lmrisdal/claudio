mod commands;
mod models;
mod registry;
mod services;
mod settings;

use tauri::webview::PageLoadEvent;

pub fn run() {
    tauri::Builder::default()
        .manage(services::game_install::InstallState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::games::cancel_install,
            commands::games::get_installed_game,
            commands::games::install_game,
            commands::games::list_installed_games,
            commands::games::open_install_folder,
            commands::games::uninstall_game,
            commands::ping::ping,
            commands::get_settings,
            commands::update_settings,
        ])
        .setup(|app| {
            use tauri::Manager;
            let window = app.get_webview_window("main").unwrap();

            #[cfg(not(target_os = "macos"))]
            window.set_decorations(false)?;

            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

                let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;

                let app_submenu = SubmenuBuilder::new(app, "Claudio")
                    .about(None)
                    .separator()
                    .item(&settings_item)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .maximize()
                    .close_window()
                    .separator()
                    .fullscreen()
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()?;

                app.set_menu(menu)?;
            }

            let _ = window;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                use tauri::Emitter;
                let _ = app.emit("open-settings", ());
            }
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = webview.window().show();

                #[cfg(target_os = "macos")]
                {
                    use objc2::msg_send;
                    use objc2::runtime::AnyObject;
                    let _ = webview.with_webview(|wv| unsafe {
                        let ptr = wv.inner() as *mut AnyObject;
                        if ptr.is_null() {
                            return;
                        }
                        let config: *mut AnyObject = msg_send![&*ptr, configuration];
                        if config.is_null() {
                            return;
                        }
                        let prefs: *mut AnyObject = msg_send![&*config, preferences];
                        if prefs.is_null() {
                            return;
                        }
                        let _: () = msg_send![&*prefs, setElementFullscreenEnabled: true];
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Claudio");
}
