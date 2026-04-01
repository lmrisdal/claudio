mod commands;
mod models;
mod registry;
mod services;
mod settings;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri::webview::PageLoadEvent;

const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon.png");

fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

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
            let window = app.get_webview_window("main").unwrap();
            let window_for_close = window.clone();

            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if settings::load().close_to_tray {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                }
            });

            #[cfg(not(target_os = "macos"))]
            window.set_decorations(false)?;

            #[cfg(target_os = "macos")]
            {

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

            let show_item = MenuItemBuilder::with_id("tray-show", "Show Claudio")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("tray-quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;
            let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_PNG)?.to_owned();

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .tooltip("Claudio")
                .show_menu_on_left_click(true)
                .icon_as_template(cfg!(target_os = "macos"))
                .build(app)?;

            let _ = window;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit("open-settings", ());
                }
                "tray-show" => {
                    restore_main_window(app);
                }
                "tray-quit" => {
                    app.exit(0);
                }
                _ => {}
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
