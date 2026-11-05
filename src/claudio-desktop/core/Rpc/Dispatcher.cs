using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Claudio.Core.Commands;
using Claudio.Core.Json;
using Claudio.Core.Logging;

namespace Claudio.Core.Rpc;

internal sealed class Dispatcher(RpcHost host)
{
    private static readonly ResultWriter Null = writer => writer.WriteNullValue();

    private readonly InstallState install = new();
    private readonly RunningGames running = new();

    private static ResultWriter Value<T>(T value, JsonTypeInfo<T> typeInfo) =>
        writer => JsonSerializer.Serialize(writer, value, typeInfo);

    private static T Parse<T>(string method, JsonElement parameters, JsonTypeInfo<T> typeInfo) =>
        Params.Parse(method, parameters, typeInfo);

    public async Task<ResultWriter> DispatchAsync(string method, JsonElement parameters)
    {
        var context = CoreJsonContext.Default;
        switch (method)
        {
            case "install_game":
                var installGame = Parse(method, parameters, context.GameArgs);
                return Value(await GameInstaller.InstallAsync(host, install, installGame.Game), context.InstalledGame);
            case "retry_cached_install":
                var retryGame = Parse(method, parameters, context.GameArgs);
                return Value(await GameInstaller.RetryCachedAsync(host, install, retryGame.Game), context.InstalledGame);
            case "download_game_package":
                var download = Parse(method, parameters, context.DownloadArgs);
                return Value(await PackageInstall.DownloadAsync(host, install, download.Input), context.String);
            case "cancel_install":
                install.Cancel(host, Parse(method, parameters, context.GameIdArgs).GameId);
                return Null;
            case "restart_install_interactive":
                install.RestartInteractive(host, Parse(method, parameters, context.GameIdArgs).GameId);
                return Null;
            case "cleanup_failed_install":
                await Task.Run(() => Games.CleanupFailedInstall(Parse(method, parameters, context.GameArgs).Game));
                return Null;
            case "uninstall_game":
                var uninstall = Parse(method, parameters, context.UninstallArgs);
                await Task.Run(() => Games.UninstallGame(uninstall.RemoteGameId, uninstall.DeleteFiles));
                return Null;
            case "validate_install_target":
                var target = Parse(method, parameters, context.TargetPathArgs);
                await Task.Run(() => InstallPaths.ValidateInstallTarget(target.TargetPath));
                return Null;
            case "resolve_install_path":
                var installTitle = Parse(method, parameters, context.GameTitleArgs);
                return Value(await Task.Run(() => InstallPaths.ResolveInstallPath(installTitle.GameTitle)), context.String);
            case "resolve_install_browse_root":
                var browse = Parse(method, parameters, context.TargetPathArgs);
                return Value(await Task.Run(() => InstallPaths.ResolveInstallBrowseRoot(browse.TargetPath)), context.String);
            case "get_disk_space":
                var space = Parse(method, parameters, context.TargetPathArgs);
                return Value(await Task.Run(() => InstallPaths.GetDiskSpace(space.TargetPath)), context.DiskSpace);
            case "resolve_default_download_root":
                return Value(await Task.Run(InstallPaths.ResolveDefaultDownloadRoot), context.String);
            case "resolve_download_path":
                var downloadTitle = Parse(method, parameters, context.GameTitleArgs);
                return Value(await Task.Run(() => InstallPaths.ResolveDownloadPath(downloadTitle.GameTitle)), context.String);
            case "list_installed_games":
                return Value(await Task.Run(InstalledGamesRegistry.List), context.ListInstalledGame);
            case "get_installed_game":
                var get = Parse(method, parameters, context.RemoteGameIdArgs);
                return Value(await Task.Run(() => InstalledGamesRegistry.Get(get.RemoteGameId)), context.InstalledGame);
            case "open_install_folder":
                var open = Parse(method, parameters, context.RemoteGameIdArgs);
                await Task.Run(() => GameExecutables.OpenInstallFolder(open.RemoteGameId));
                return Null;
            case "list_game_executables":
                var listExes = Parse(method, parameters, context.RemoteGameIdArgs);
                return Value(await Task.Run(() => GameExecutables.List(listExes.RemoteGameId)), context.ListString);
            case "add_steam_shortcut":
                var steam = Parse(method, parameters, context.RemoteGameIdArgs);
                await Task.Run(() => SteamShortcutCommand.Add(steam.RemoteGameId));
                return Null;
            case "update_game_launch_settings":
                var launchSettings = Parse(method, parameters, context.GameLaunchSettingsArgs);
                return Value(
                    await Task.Run(() => GameExecutables.UpdateLaunchSettings(
                        launchSettings.RemoteGameId,
                        launchSettings.GameExe,
                        launchSettings.ProtonPath,
                        launchSettings.Options)),
                    context.InstalledGame);
            case "launch_game":
                var launch = Parse(method, parameters, context.RemoteGameIdArgs);
                await Task.Run(() => running.Launch(launch.RemoteGameId));
                return Null;
            case "set_game_exe":
                var setExe = Parse(method, parameters, context.SetGameExeArgs);
                return Value(await Task.Run(() => GameExecutables.SetExe(setExe.RemoteGameId, setExe.GameExe)), context.InstalledGame);
            case "stop_game":
                var stop = Parse(method, parameters, context.RemoteGameIdArgs);
                await Task.Run(() => running.Stop(stop.RemoteGameId));
                return Null;
            case "list_running_games":
                return Value(await Task.Run(running.ListActive), context.ListRunningGameInfo);
            case "list_proton_versions":
                return Value(ProtonVersions.List(), context.ListProtonVersionOption);
            case "get_settings":
                return Value(await Task.Run(SettingsStore.Load), context.DesktopSettings);
            case "update_settings":
                var update = Parse(method, parameters, context.SettingsArgs);
                await Task.Run(() => SettingsStore.Save(update.Settings));
                return Null;
            case "ping":
                return Value(Ping.Run(), context.PingResponse);
            case "desktop_check_server_connection":
                var connection = Parse(method, parameters, context.ConnectionArgs);
                return Value(await ServerConnection.CheckAsync(connection), context.ServerConnectionResult);
            case "has_active_operations":
                var active = install.HasActiveOperations;
                return writer => writer.WriteBooleanValue(active);
            case "log":
                WriteLog(Parse(method, parameters, context.LogArgs));
                return Null;
            default:
                throw new CommandException($"Command {method} not found");
        }
    }

    private static void WriteLog(LogArgs args)
    {
        var level = args.Level.ToLowerInvariant() switch
        {
            "error" => LogLevel.Error,
            "warn" or "warning" => LogLevel.Warn,
            "debug" => LogLevel.Debug,
            "trace" => LogLevel.Trace,
            _ => LogLevel.Info,
        };
        Log.Write(level, args.Source ?? "shell", args.Message);
    }
}
