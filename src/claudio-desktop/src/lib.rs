mod auth;
mod commands;
mod models;
mod protocol;
mod registry;
mod services;
mod settings;
#[cfg(target_os = "windows")]
mod windows_integration;

#[cfg(target_os = "macos")]
use tauri::menu::SubmenuBuilder;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager};

const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon.png");

#[cfg(target_os = "macos")]
fn set_dock_visibility(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    let _ = app.set_activation_policy(policy);
}

#[cfg(not(target_os = "macos"))]
fn set_dock_visibility(_app: &AppHandle, _visible: bool) {}

fn restore_main_window(app: &AppHandle) {
    set_dock_visibility(app, true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle, logged_in: bool) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_updates_item =
        MenuItemBuilder::with_id("check-updates", "Check for Updates...").build(app)?;

    let mut app_submenu = SubmenuBuilder::new(app, "Claudio").about(None).separator();
    if logged_in {
        app_submenu = app_submenu.item(&settings_item);
    }

    let app_submenu = app_submenu
        .item(&check_updates_item)
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
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu(_app: &AppHandle, _logged_in: bool) -> tauri::Result<()> {
    Ok(())
}

pub(crate) fn refresh_auth_state_ui(app: &AppHandle, logged_in: bool) -> Result<(), String> {
    build_app_menu(app, logged_in).map_err(|error| error.to_string())?;

    if !logged_in {
        if let Some(window) = app.get_webview_window("settings") {
            let _ = window.close();
        }
    }

    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("claudio", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = protocol::handle_request(&app, request).await;
                responder.respond(response);
            });
        })
        .manage(services::game_install::InstallState::default())
        .manage(services::game_runtime::RunningGamesState::default())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(10 * 1024 * 1024) // 10 MB
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["settings"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::games::cancel_install,
            commands::games::get_installed_game,
            commands::games::install_game,
            commands::games::launch_game,
            commands::games::list_game_executables,
            commands::games::list_installed_games,
            commands::games::list_running_games,
            commands::games::restart_install_interactive,
            commands::games::resolve_install_path,
            commands::games::open_install_folder,
            commands::games::set_game_exe,
            commands::games::stop_game,
            commands::games::uninstall_game,
            commands::desktop_complete_external_login,
            commands::desktop_get_session,
            commands::desktop_login,
            commands::desktop_logout,
            commands::desktop_proxy_login,
            commands::ping::ping,
            commands::get_settings,
            commands::update_settings,
            commands::restart_app,
            commands::open_settings_window,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let window_for_close = window.clone();

            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let current_settings = settings::load();
                    if current_settings.close_to_tray {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                        if current_settings.hide_dock_icon {
                            set_dock_visibility(&window_for_close.app_handle(), false);
                        }
                    }
                }
            });

            #[cfg(not(target_os = "macos"))]
            window.set_decorations(false)?;

            let logged_in =
                tauri::async_runtime::block_on(auth::restore_session(&settings::load()))
                    .map(|session| session.is_logged_in)
                    .unwrap_or(false);
            build_app_menu(app.handle(), logged_in)?;

            let show_item = MenuItemBuilder::with_id("tray-show", "Show Claudio")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let check_updates_item =
                MenuItemBuilder::with_id("tray-check-updates", "Check for Updates").build(app)?;
            let quit_item = MenuItemBuilder::with_id("tray-quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&check_updates_item)
                .separator()
                .item(&quit_item)
                .build()?;
            let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_PNG)?.to_owned();

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .tooltip("Claudio")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        restore_main_window(tray.app_handle());
                    }
                })
                .icon_as_template(cfg!(target_os = "macos"))
                .build(app)?;

            let _ = window;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                tauri::async_runtime::spawn(commands::open_settings_window(app.clone()));
            }
            "check-updates" | "tray-check-updates" => {
                let _ = app.emit("check-for-updates", ());
            }
            "tray-show" => {
                restore_main_window(app);
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let window = webview.window().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    let _ = window.show();
                    let _ = window.set_focus();
                });
            }

            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
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
        .build(tauri::generate_context!())
        .expect("error while building Claudio");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if matches!(event, tauri::RunEvent::Reopen { .. }) {
            restore_main_window(app);
        }
    });
}
