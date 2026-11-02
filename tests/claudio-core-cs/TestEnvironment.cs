namespace Claudio.Core.Tests;

internal sealed class TestDataDir : IDisposable
{
    private readonly string? previous = Environment.GetEnvironmentVariable("XDG_DATA_HOME");

    public TestDataDir()
    {
        Root = Path.Combine(Path.GetTempPath(), $"claudio-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(Root);
        Environment.SetEnvironmentVariable("XDG_DATA_HOME", Root);
        SettingsStore.DataDirOverride = DataDir;
    }

    public string Root { get; }

    public string DataDir => Path.Combine(Root, "claudio");

    public string Child(string name)
    {
        var path = Path.Combine(Root, name);
        Directory.CreateDirectory(path);
        return path;
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("XDG_DATA_HOME", previous);
        SettingsStore.DataDirOverride = null;
        Claudio.Core.Logging.Log.Shutdown();
        try
        {
            Directory.Delete(Root, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}

internal static class TestGames
{
    public static InstalledGame Installed(int id, string title, string installPath) => new()
    {
        RemoteGameId = id,
        Title = title,
        Platform = "windows",
        InstallType = InstallType.Portable,
        InstallPath = installPath,
        InstalledAt = "1",
    };
}
