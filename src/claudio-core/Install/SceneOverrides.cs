using Claudio.Core.Logging;

namespace Claudio.Core.Install;

internal static class SceneOverrides
{
    private static readonly string[] SceneGroupFolders =
    [
        "skidrow", "codex", "cpy", "plaza", "reloaded", "rune", "empress", "voksi", "flt", "bat", "prophet",
        "darksiders", "dodi", "hoodlum", "razor1911", "fairlight", "voices38", "crack", "kirigiri",
    ];

    internal static void Apply(string sourceDir, string targetDir)
    {
        IEnumerable<string> entries;
        try
        {
            entries = Directory.EnumerateDirectories(sourceDir).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return;
        }

        foreach (var path in entries)
        {
            var name = Path.GetFileName(path);
            if (SceneGroupFolders.Any(group => group.Equals(name, StringComparison.OrdinalIgnoreCase)))
            {
                Log.Info("claudio_core", $"Applying scene group overrides from '{name}' to {targetDir}");
                FileOps.CopyDirContents(path, targetDir);
            }
        }
    }
}
