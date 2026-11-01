use super::Context;
use super::params::{
    ConnectionArgs, DownloadArgs, GameArgs, GameIdArgs, GameTitleArgs, LogArgs, RemoteGameIdArgs,
    SetGameExeArgs, SettingsArgs, TargetPathArgs, UninstallArgs, parse,
};
use crate::commands::{self, games};
use serde::Serialize;
use serde_json::Value;

fn to_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())
}

pub(super) async fn dispatch(ctx: &Context, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "install_game" => {
            let args: GameArgs = parse(method, params)?;
            to_value(games::install_game(ctx.host.clone(), &ctx.install, args.game).await?)
        }
        "retry_cached_install" => {
            let args: GameArgs = parse(method, params)?;
            to_value(games::retry_cached_install(ctx.host.clone(), &ctx.install, args.game).await?)
        }
        "download_game_package" => {
            let args: DownloadArgs = parse(method, params)?;
            to_value(
                games::download_game_package(ctx.host.clone(), &ctx.install, args.input).await?,
            )
        }
        "cancel_install" => {
            let args: GameIdArgs = parse(method, params)?;
            games::cancel_install(ctx.host.clone(), &ctx.install, args.game_id)?;
            Ok(Value::Null)
        }
        "restart_install_interactive" => {
            let args: GameIdArgs = parse(method, params)?;
            games::restart_install_interactive(ctx.host.clone(), &ctx.install, args.game_id)?;
            Ok(Value::Null)
        }
        "cleanup_failed_install" => {
            let args: GameArgs = parse(method, params)?;
            blocking(move || games::cleanup_failed_install(args.game)).await??;
            Ok(Value::Null)
        }
        "uninstall_game" => {
            let args: UninstallArgs = parse(method, params)?;
            games::uninstall_game(args.remote_game_id, args.delete_files).await?;
            Ok(Value::Null)
        }
        "validate_install_target" => {
            let args: TargetPathArgs = parse(method, params)?;
            blocking(move || games::validate_install_target(args.target_path)).await??;
            Ok(Value::Null)
        }
        "resolve_install_path" => {
            let args: GameTitleArgs = parse(method, params)?;
            to_value(blocking(move || games::resolve_install_path(args.game_title)).await?)
        }
        "resolve_install_browse_root" => {
            let args: TargetPathArgs = parse(method, params)?;
            to_value(blocking(move || games::resolve_install_browse_root(args.target_path)).await?)
        }
        "resolve_default_download_root" => {
            to_value(blocking(games::resolve_default_download_root).await?)
        }
        "resolve_download_path" => {
            let args: GameTitleArgs = parse(method, params)?;
            to_value(blocking(move || games::resolve_download_path(args.game_title)).await?)
        }
        "open_install_folder" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            games::open_install_folder(args.remote_game_id).await?;
            Ok(Value::Null)
        }
        "list_installed_games" => to_value(games::list_installed_games().await?),
        "get_installed_game" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            to_value(games::get_installed_game(args.remote_game_id).await?)
        }
        "list_game_executables" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            to_value(games::list_game_executables(args.remote_game_id).await?)
        }
        "set_game_exe" => {
            let args: SetGameExeArgs = parse(method, params)?;
            to_value(games::set_game_exe(args.remote_game_id, args.game_exe).await?)
        }
        "add_steam_shortcut" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            games::add_steam_shortcut(args.remote_game_id).await?;
            Ok(Value::Null)
        }
        "launch_game" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            let ctx = ctx.clone();
            blocking(move || games::launch_game(&ctx.running, args.remote_game_id)).await??;
            Ok(Value::Null)
        }
        "stop_game" => {
            let args: RemoteGameIdArgs = parse(method, params)?;
            let ctx = ctx.clone();
            blocking(move || games::stop_game(&ctx.running, args.remote_game_id)).await??;
            Ok(Value::Null)
        }
        "list_running_games" => {
            let ctx = ctx.clone();
            to_value(blocking(move || games::list_running_games(&ctx.running)).await??)
        }
        "list_proton_versions" => blocking(games::list_proton_versions).await,
        "get_settings" => to_value(blocking(commands::get_settings).await??),
        "update_settings" => {
            let args: SettingsArgs = parse(method, params)?;
            blocking(move || commands::update_settings(args.settings)).await??;
            Ok(Value::Null)
        }
        "ping" => to_value(commands::ping::ping()),
        "desktop_check_server_connection" => {
            let args: ConnectionArgs = parse(method, params)?;
            to_value(
                commands::server_connection::desktop_check_server_connection(
                    args.server_url,
                    args.custom_headers,
                    args.path,
                )
                .await?,
            )
        }
        "has_active_operations" => to_value(ctx.install.has_active_operations()),
        "log" => {
            let args: LogArgs = parse(method, params)?;
            write_log(args);
            Ok(Value::Null)
        }
        _ => Err(format!("Command {method} not found")),
    }
}

fn write_log(args: LogArgs) {
    let level = match args.level.to_ascii_lowercase().as_str() {
        "error" => log::Level::Error,
        "warn" | "warning" => log::Level::Warn,
        "debug" => log::Level::Debug,
        "trace" => log::Level::Trace,
        _ => log::Level::Info,
    };
    let target = args.source.as_deref().unwrap_or("shell");
    log::log!(target: target, level, "{}", args.message);
}
