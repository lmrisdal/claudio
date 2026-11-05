using System.Text.Json.Serialization;

namespace Claudio.Core;

[JsonConverter(typeof(JsonStringEnumConverter<InstallType>))]
public enum InstallType
{
    [JsonStringEnumMemberName("portable")]
    Portable,

    [JsonStringEnumMemberName("installer")]
    Installer,
}

public sealed class GameLaunchOptions
{
    public string Parameters { get; set; } = "";
    public bool RunAsAdministrator { get; set; }
    public string? UmuGameId { get; set; }
}

public sealed class RemoteGame
{
    [JsonRequired] public int Id { get; set; }
    [JsonRequired] public string Title { get; set; } = "";
    [JsonRequired] public string Platform { get; set; } = "";
    [JsonRequired] public InstallType InstallType { get; set; }
    public string? InstallerExe { get; set; }
    public string? GameExe { get; set; }
    public string? InstallPath { get; set; }
    public bool? DesktopShortcut { get; set; }
    public bool? AppMenuShortcut { get; set; }
    public bool? SteamShortcut { get; set; }
    public string? ProtonPath { get; set; }
    public bool? RunAsAdministrator { get; set; }
    public bool? ForceInteractive { get; set; }
    public string? Summary { get; set; }
    public string? Genre { get; set; }
    public int? ReleaseYear { get; set; }
    public string? CoverUrl { get; set; }
    public string? HeroUrl { get; set; }
    public string? Developer { get; set; }
    public string? Publisher { get; set; }
    public string? GameMode { get; set; }
    public string? Series { get; set; }
    public string? Franchise { get; set; }
    public string? GameEngine { get; set; }
}

public sealed class DiskSpace
{
    [JsonRequired] public long FreeBytes { get; set; }
    [JsonRequired] public long TotalBytes { get; set; }
}

public sealed class InstalledGame
{
    public GameLaunchOptions LaunchOptions { get; set; } = new();
    [JsonRequired] public int RemoteGameId { get; set; }
    [JsonRequired] public string Title { get; set; } = "";
    [JsonRequired] public string Platform { get; set; } = "";
    [JsonRequired] public InstallType InstallType { get; set; }
    [JsonRequired] public string InstallPath { get; set; } = "";
    public string? GameExe { get; set; }
    public string? WinePrefix { get; set; }
    public string? ProtonPath { get; set; }
    [JsonRequired] public string InstalledAt { get; set; } = "";
    public string? Summary { get; set; }
    public string? Genre { get; set; }
    public int? ReleaseYear { get; set; }
    public string? CoverUrl { get; set; }
    public string? HeroUrl { get; set; }
    public string? Developer { get; set; }
    public string? Publisher { get; set; }
    public string? GameMode { get; set; }
    public string? Series { get; set; }
    public string? Franchise { get; set; }
    public string? GameEngine { get; set; }
}

public sealed class RunningGameInfo
{
    public int GameId { get; set; }
    public uint Pid { get; set; }
    public string ExePath { get; set; } = "";
    public string StartedAt { get; set; } = "";
}

public sealed class ProtonVersionOption
{
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
}

public sealed class PingResponse
{
    public string Version { get; set; } = "";
    public string Platform { get; set; } = "";
}

public sealed class ServerConnectionResult
{
    public bool Ok { get; set; }
    public ushort? Status { get; set; }
}

public sealed class InstallProgress
{
    public int GameId { get; set; }
    public string Status { get; set; } = "";
    public double? Percent { get; set; }
    public bool? Indeterminate { get; set; }
    public string? Detail { get; set; }
    public ulong? BytesDownloaded { get; set; }
    public ulong? TotalBytes { get; set; }
}

public sealed class DownloadPackageInput
{
    [JsonRequired] public int Id { get; set; }
    [JsonRequired] public string Title { get; set; } = "";
    [JsonRequired] public string TargetDir { get; set; } = "";
    [JsonRequired] public bool Extract { get; set; }
}

public sealed class CachedDownloadInfo
{
    public string FilePath { get; set; } = "";
    public bool IsIndividual { get; set; }
}
