global using Claudio.Core.Commands;
global using Claudio.Core.Install;
global using Claudio.Core.Runtime;
using Claudio.Core.Logging;
using Claudio.Core.Rpc;

namespace Claudio.Core;

internal static class Program
{
    private static string ResourceDirFromArgs(string[] args)
    {
        for (var index = 0; index < args.Length; index++)
        {
            if (args[index] == "--resource-dir")
            {
                return index + 1 < args.Length ? args[index + 1] : "";
            }

            if (args[index].StartsWith("--resource-dir=", StringComparison.Ordinal))
            {
                return args[index]["--resource-dir=".Length..];
            }
        }

        return "";
    }

    private static async Task<int> Main(string[] args)
    {
        if (OperatingSystem.IsWindowsVersionAtLeast(6, 1))
        {
            Windows.NativeProcess.DisableStandardHandleInheritance();
        }

        var settings = SettingsStore.Load();
        Log.Init(SettingsStore.DataDir(), Log.ParseLevel(settings.LogLevel));
        Log.Info("claudio_core", $"claudio-core {Ping.PackageVersion()} started");

        await RpcServer.ServeAsync(
            Console.OpenStandardInput(),
            Console.OpenStandardOutput(),
            ResourceDirFromArgs(args));

        Log.Info("claudio_core", "claudio-core stdin closed, exiting");
        return 0;
    }
}
