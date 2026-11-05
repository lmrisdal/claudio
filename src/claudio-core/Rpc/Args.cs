using System.Text.Json.Serialization;

namespace Claudio.Core.Rpc;

internal sealed class GameArgs
{
    [JsonRequired] public RemoteGame Game { get; set; } = new();
}

internal sealed class GameIdArgs
{
    [JsonRequired] public int GameId { get; set; }
}

internal sealed class RemoteGameIdArgs
{
    [JsonRequired] public int RemoteGameId { get; set; }
}

internal sealed class UninstallArgs
{
    [JsonRequired] public int RemoteGameId { get; set; }
    [JsonRequired] public bool DeleteFiles { get; set; }
}

internal sealed class SetGameExeArgs
{
    [JsonRequired] public int RemoteGameId { get; set; }
    [JsonRequired] public string GameExe { get; set; } = "";
}

internal sealed class GameTitleArgs
{
    [JsonRequired] public string GameTitle { get; set; } = "";
}

internal sealed class TargetPathArgs
{
    [JsonRequired] public string TargetPath { get; set; } = "";
}

internal sealed class SettingsArgs
{
    [JsonRequired] public DesktopSettings Settings { get; set; } = new();
}

internal sealed class ConnectionArgs
{
    public string? ServerUrl { get; set; }
    public Dictionary<string, string>? CustomHeaders { get; set; }
    public string? Path { get; set; }
}

internal sealed class LogArgs
{
    [JsonRequired] public string Level { get; set; } = "";
    [JsonRequired] public string Message { get; set; } = "";
    public string? Source { get; set; }
}

internal sealed class DownloadArgs
{
    [JsonRequired] public DownloadPackageInput Input { get; set; } = new();
}

internal sealed class GameLaunchSettingsArgs
{
    [JsonRequired] public int RemoteGameId { get; set; }
    public string? GameExe { get; set; }
    public string? ProtonPath { get; set; }
    [JsonRequired] public GameLaunchOptions Options { get; set; } = new();
}
