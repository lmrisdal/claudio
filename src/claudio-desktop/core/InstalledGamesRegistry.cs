using System.Text.Json;
using Claudio.Core.Json;
using Claudio.Core.Logging;

namespace Claudio.Core;

internal static class InstalledGamesRegistry
{
    private static readonly Lock Gate = new();

    private static string Failure(string operation, string path, Exception error)
    {
        Log.Error("claudio_core", $"[registry] {operation} failed for {path}: {error.Message}");
        return $"Failed to {operation} the installed games list {path}: {error.Message}";
    }

    private static List<InstalledGame> LoadAll()
    {
        var path = SettingsStore.RegistryPath();
        string contents;
        try
        {
            contents = File.ReadAllText(path);
        }
        catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException)
        {
            return [];
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException(Failure("read", path, error));
        }

        if (string.IsNullOrWhiteSpace(contents))
        {
            Log.Warn("claudio_core", $"[registry] {path} is empty, treating it as no installed games");
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize(contents, CoreJsonContext.Default.ListInstalledGame) ?? [];
        }
        catch (JsonException error)
        {
            throw new CommandException(Failure("parse", path, error));
        }
    }

    private static void SaveAll(List<InstalledGame> games)
    {
        var path = SettingsStore.RegistryPath();
        var tempPath = path + ".tmp";
        try
        {
            var json = CoreJsonContext.SerializePretty(games);
            using (var stream = new FileStream(tempPath, FileMode.Create, FileAccess.Write))
            {
                stream.Write(System.Text.Encoding.UTF8.GetBytes(json));
                stream.Flush(true);
            }

            File.Move(tempPath, path, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException(Failure("write", tempPath, error));
        }
    }

    private static List<InstalledGame> LoadPruned()
    {
        var games = LoadAll();
        games.RemoveAll(game => !PathExists(game.InstallPath));
        SaveAll(games);
        return games;
    }

    private static bool PathExists(string path) => File.Exists(path) || Directory.Exists(path);

    public static List<InstalledGame> List()
    {
        lock (Gate)
        {
            return LoadPruned();
        }
    }

    public static InstalledGame? Get(int remoteGameId)
    {
        lock (Gate)
        {
            return LoadPruned().Find(game => game.RemoteGameId == remoteGameId);
        }
    }

    public static InstalledGame Upsert(InstalledGame installed)
    {
        lock (Gate)
        {
            var games = LoadAll();
            games.RemoveAll(game => game.RemoteGameId == installed.RemoteGameId);
            games.Add(installed);
            games = games.OrderBy(game => game.Title, StringComparer.Ordinal).ToList();
            SaveAll(games);
            return installed;
        }
    }

    public static InstalledGame? Remove(int remoteGameId)
    {
        lock (Gate)
        {
            var games = LoadAll();
            var index = games.FindIndex(game => game.RemoteGameId == remoteGameId);
            InstalledGame? removed = null;
            if (index >= 0)
            {
                removed = games[index];
                games.RemoveAt(index);
            }

            SaveAll(games);
            return removed;
        }
    }
}
