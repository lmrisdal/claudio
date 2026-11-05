using System.Text.Json;
using Claudio.Core.Json;
using Claudio.Core.Rpc;

namespace Claudio.Core.Install;

internal static class Progress
{
    public static void Emit(RpcHost host, InstallProgress progress) =>
        host.Emit("install-progress", writer => JsonSerializer.Serialize(writer, progress, CoreJsonContext.Default.InstallProgress));

    public static void Emit(RpcHost host, int gameId, string status, double? percent, string? detail) =>
        Emit(host, new InstallProgress { GameId = gameId, Status = status, Percent = percent, Detail = detail });

    public static void EmitIndeterminate(RpcHost host, int gameId, string status, double? percent, string? detail, bool indeterminate) =>
        Emit(host, new InstallProgress
        {
            GameId = gameId,
            Status = status,
            Percent = percent,
            Indeterminate = indeterminate,
            Detail = detail,
        });

    public static string CurrentTimestamp() => DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
}
