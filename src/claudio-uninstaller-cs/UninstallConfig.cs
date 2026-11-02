using System.Text.Json.Serialization;

namespace Claudio.Uninstaller;

internal sealed class UninstallConfig
{
    [JsonRequired] public string GameTitle { get; set; } = "";
    [JsonRequired] public string InstallPath { get; set; } = "";
    [JsonRequired] public string RegistryKeyName { get; set; } = "";
    public string? ShortcutPath { get; set; }
    public string? DesktopShortcutPath { get; set; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, RespectNullableAnnotations = true)]
[JsonSerializable(typeof(UninstallConfig))]
internal sealed partial class UninstallJsonContext : JsonSerializerContext;
