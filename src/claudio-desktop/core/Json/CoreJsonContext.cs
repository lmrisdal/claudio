using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Claudio.Core.Json;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    RespectNullableAnnotations = true,
    Converters = [typeof(RustFloatConverter)])]
[JsonSerializable(typeof(DesktopSettings))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(List<InstalledGame>))]
[JsonSerializable(typeof(InstalledGame))]
[JsonSerializable(typeof(RemoteGame))]
[JsonSerializable(typeof(PingResponse))]
[JsonSerializable(typeof(CachedDownloadInfo))]
[JsonSerializable(typeof(Windows.UninstallConfig))]
[JsonSerializable(typeof(InstallProgress))]
[JsonSerializable(typeof(DownloadPackageInput))]
[JsonSerializable(typeof(Rpc.DownloadArgs))]
[JsonSerializable(typeof(ServerConnectionResult))]
[JsonSerializable(typeof(List<ProtonVersionOption>))]
[JsonSerializable(typeof(List<RunningGameInfo>))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(Rpc.GameIdArgs))]
[JsonSerializable(typeof(Rpc.RemoteGameIdArgs))]
[JsonSerializable(typeof(Rpc.GameArgs))]
[JsonSerializable(typeof(Rpc.UninstallArgs))]
[JsonSerializable(typeof(Rpc.SetGameExeArgs))]
[JsonSerializable(typeof(Rpc.GameTitleArgs))]
[JsonSerializable(typeof(Rpc.TargetPathArgs))]
[JsonSerializable(typeof(Rpc.SettingsArgs))]
[JsonSerializable(typeof(Rpc.ConnectionArgs))]
[JsonSerializable(typeof(Rpc.LogArgs))]
[JsonSerializable(typeof(Rpc.GameLaunchSettingsArgs))]
internal sealed partial class CoreJsonContext : JsonSerializerContext
{
    private static readonly Lazy<JsonSerializerOptions> LazyFileOptions = new(() => new(Default!.Options)
    {
        WriteIndented = true,
        IndentSize = 2,
        NewLine = "\n",
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        TypeInfoResolver = Default!,
    });

    public static JsonSerializerOptions FileOptions => LazyFileOptions.Value;

    public static string SerializePretty<T>(T value) =>
        JsonSerializer.Serialize(value, (JsonTypeInfo<T>)FileOptions.GetTypeInfo(typeof(T))!);
}
