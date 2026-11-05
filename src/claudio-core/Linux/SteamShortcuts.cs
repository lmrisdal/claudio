namespace Claudio.Core.Linux;

internal static class SteamShortcuts
{
    public static void Write(InstalledGame installed, string umuRun)
    {
        var exe = installed.GameExe ?? throw new CommandException("No game executable is set.");
        var prefix = installed.WinePrefix ?? throw new CommandException("No Wine prefix is set.");
        var proton = installed.ProtonPath ?? "UMU-Latest";
        WriteCommand(
            installed,
            "\"/usr/bin/env\"",
            $"WINEPREFIX={Quote(prefix)} PROTONPATH={Quote(proton)} GAMEID=umu-default STORE=none {Quote(umuRun)} {Quote(exe)}");
    }

    public static void WriteCommand(InstalledGame installed, string exeCommand, string launchOptions)
    {
        var shortcutPath = SteamUsers.ShortcutsPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))
            ?? throw new CommandException("No Steam userdata folder was found for shortcut creation.");
        var exe = installed.GameExe ?? installed.InstallPath;
        var startDir = Path.GetDirectoryName(exe) is { Length: > 0 } parent ? parent : ".";
        var root = Load(shortcutPath);
        var shortcuts = EnsureObject(root, "shortcuts");
        var entryKey = shortcuts.Items
            .Where(pair => pair.Value is VdfObject { Items: var items }
                && items.GetValueOrDefault("AppName") is VdfString name && name.Value == installed.Title)
            .Select(pair => pair.Key)
            .FirstOrDefault() ?? NextAppId(shortcuts).ToString();
        var appId = shortcuts.Items.GetValueOrDefault(entryKey) is VdfObject existing
            && existing.Items.GetValueOrDefault("appid") is VdfInt32 id
                ? id.Value
                : int.TryParse(entryKey, out var parsed) ? parsed : NextAppId(shortcuts);

        var entry = new VdfObject();
        SetInt(entry, "AllowDesktopConfig", 1);
        SetInt(entry, "AllowOverlay", 1);
        SetString(entry, "AppName", installed.Title);
        SetInt(entry, "Devkit", 0);
        SetString(entry, "DevkitGameID", "");
        SetString(entry, "Exe", exeCommand);
        SetString(entry, "FlatpakAppID", "");
        SetInt(entry, "IsHidden", 0);
        SetInt(entry, "LastPlayTime", 0);
        SetString(entry, "LaunchOptions", launchOptions);
        SetInt(entry, "OpenVR", 0);
        SetString(entry, "ShortcutPath", "");
        SetString(entry, "StartDir", startDir);
        SetInt(entry, "appid", appId);
        SetString(entry, "icon", "");
        shortcuts.Items[entryKey] = entry;
        Save(shortcutPath, root);
    }

    private static void SetString(VdfObject target, string key, string value) => target.Items[key] = new VdfString(value);

    private static void SetInt(VdfObject target, string key, int value) => target.Items[key] = new VdfInt32(BinaryVdf.Int32, value);

    private static VdfObject Load(string path)
    {
        if (!File.Exists(path))
        {
            return Default();
        }

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to read Steam shortcuts {path}: {error.Message}");
        }

        if (bytes.Length == 0)
        {
            return Default();
        }

        try
        {
            return BinaryVdf.Parse(bytes);
        }
        catch (FormatException error)
        {
            throw new CommandException($"Failed to parse Steam shortcuts {path}. Leaving it unchanged: {error.Message}");
        }
    }

    private static VdfObject Default()
    {
        var root = new VdfObject();
        root.Items["shortcuts"] = new VdfObject();
        return root;
    }

    private static void Save(string path, VdfObject root)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to create Steam shortcut directory {Path.GetDirectoryName(path)}: {error.Message}");
        }

        if (File.Exists(path))
        {
            try
            {
                File.Copy(path, Path.ChangeExtension(path, "vdf.claudio.bak"), overwrite: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new CommandException($"Failed to back up Steam shortcuts {path}: {error.Message}");
            }
        }

        var temp = Path.ChangeExtension(path, "vdf.claudio.tmp");
        try
        {
            File.WriteAllBytes(temp, BinaryVdf.Dump(root));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to write temporary Steam shortcuts {temp}: {error.Message}");
        }

        try
        {
            File.Move(temp, path, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CommandException($"Failed to replace Steam shortcuts {path}: {error.Message}");
        }
    }

    private static VdfObject EnsureObject(VdfObject root, string key)
    {
        if (root.Items.GetValueOrDefault(key) is VdfObject existing)
        {
            return existing;
        }

        var created = new VdfObject();
        root.Items[key] = created;
        return created;
    }

    private static int NextAppId(VdfObject shortcuts) =>
        shortcuts.Items.Keys.Select(key => int.TryParse(key, out var value) ? value : (int?)null)
            .Where(value => value is not null).Select(value => value!.Value).DefaultIfEmpty(0).Max() is var max
            && max < int.MaxValue ? max + 1 : int.MaxValue;

    private static string Quote(string value) =>
        value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '/' or '.' or '-' or '_' or ':')
            ? value
            : $"'{value.Replace("'", "'\\''")}'";
}
