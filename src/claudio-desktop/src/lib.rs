mod auth;
mod commands;
mod deep_link;
mod http_client;
#[cfg(feature = "integration-tests")]
pub mod integration_test_api;
mod models;
mod protocol;
mod registry;
mod services;
mod settings;
#[cfg(any(test, feature = "integration-tests"))]
mod test_support;
mod version;
#[cfg(target_os = "windows")]
mod windows_integration;

#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadataBuilder;
#[cfg(target_os = "macos")]
use tauri::menu::SubmenuBuilder;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::{DeepLinkExt, OpenUrlEvent};
#[cfg(target_os = "windows")]
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray-icon.png");
#[cfg(target_os = "macos")]
const ABOUT_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

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

pub(crate) fn restore_main_window(app: &AppHandle) {
    set_dock_visibility(app, true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn should_confirm_exit_for_active_install(app: &AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        return app
            .try_state::<services::game_install::InstallState>()
            .map(|state| state.has_active_operations())
            .unwrap_or(false);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

fn confirm_exit_for_active_install(app: &AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        return app
            .dialog()
            .message(
                "A download or installation is still in progress. Closing Claudio will stop it. Quit anyway?",
            )
            .title("Quit Claudio?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Quit".to_string(),
                "Keep Running".to_string(),
            ))
            .blocking_show();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        true
    }
}

fn request_app_exit(app: &AppHandle) {
    if should_confirm_exit_for_active_install(app) && !confirm_exit_for_active_install(app) {
        return;
    }

    if let Some(state) = app.try_state::<services::game_install::InstallState>() {
        state.approve_exit();
    }
    app.exit(0);
}

#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle, logged_in: bool) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_updates_item =
        MenuItemBuilder::with_id("check-updates", "Check for Updates...").build(app)?;

    let about_icon = tauri::image::Image::from_bytes(ABOUT_ICON_PNG)?;
    let about_metadata = AboutMetadataBuilder::new()
        .version(Some(version::display_version()))
        .icon(Some(about_icon))
        .build();

    let mut app_submenu = SubmenuBuilder::new(app, "Claudio")
        .about(Some(about_metadata))
        .separator();
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

    if !logged_in && let Some(window) = app.get_webview_window("settings") {
        let _ = window.close();
    }

    Ok(())
}

pub fn run() {
    let initial_settings = settings::load();
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
                .level(settings::log_level_filter(&initial_settings))
                .max_file_size(10 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: settings::data_dir(),
                        file_name: Some("claudio".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            restore_main_window(app);
        }))
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
            commands::games::cleanup_failed_install,
            commands::games::download_game_package,
            commands::games::get_installed_game,
            commands::games::install_game,
            commands::games::launch_game,
            commands::games::list_game_executables,
            commands::games::list_installed_games,
            commands::games::list_running_games,
            commands::games::restart_install_interactive,
            commands::games::resolve_install_path,
            commands::games::validate_install_target,
            commands::games::resolve_default_download_root,
            commands::games::resolve_download_path,
            commands::games::open_install_folder,
            commands::games::set_game_exe,
            commands::games::stop_game,
            commands::games::uninstall_game,
            commands::desktop_complete_external_login,
            commands::desktop_get_session,
            commands::desktop_open_external_login,
            commands::desktop_login,
            commands::desktop_logout,
            commands::desktop_proxy_login,
            commands::ping::ping,
            commands::server_connection::desktop_check_server_connection,
            commands::get_settings,
            commands::update_settings,
            commands::restart_app,
            commands::open_settings_window,
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or(tauri::Error::WindowNotFound)?;
            let window_for_close = window.clone();

            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let current_settings = settings::load();
                    if current_settings.close_to_tray {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                        if current_settings.hide_dock_icon {
                            set_dock_visibility(window_for_close.app_handle(), false);
                        }
                    } else {
                        api.prevent_close();
                        request_app_exit(window_for_close.app_handle());
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

            let deep_link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event: OpenUrlEvent| {
                deep_link::handle_auth_callback_urls(&deep_link_handle, event.urls().iter());
            });
            deep_link::handle_initial_url(app.handle());

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
                request_app_exit(app);
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

    app.run(|_app, _event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &_event
            && let Some(state) = _app.try_state::<services::game_install::InstallState>()
        {
            if state.take_exit_approval() {
                return;
            }

            if should_confirm_exit_for_active_install(_app) {
                api.prevent_exit();
                request_app_exit(_app);
                return;
            }
        }

        #[cfg(target_os = "macos")]
        if matches!(_event, tauri::RunEvent::Reopen { .. }) {
            restore_main_window(_app);
        }
    });
}
