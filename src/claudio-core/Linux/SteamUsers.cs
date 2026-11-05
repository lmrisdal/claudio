using System.Text;

namespace Claudio.Core.Linux;

internal static class SteamUsers
{
    private const ulong SteamId64Base = 76_561_197_960_265_728;

    internal sealed record LoginUser(ulong SteamId, bool MostRecent, ulong Timestamp);

    public static string? ShortcutsPath(string home)
    {
        foreach (var steamRoot in new[]
        {
            Path.Combine(home, ".steam", "steam"),
            Path.Combine(home, ".local", "share", "Steam"),
            Path.Combine(home, ".var", "app", "com.valvesoftware.Steam", ".steam", "steam"),
        })
        {
            var userdata = Path.Combine(steamRoot, "userdata");
            var recent = MostRecentAccount(steamRoot);
            var account = recent is not null && Directory.Exists(Path.Combine(userdata, recent))
                ? recent
                : FirstAccountDir(userdata);
            if (account is not null)
            {
                return Path.Combine(userdata, account, "config", "shortcuts.vdf");
            }
        }

        return null;
    }

    private static string? FirstAccountDir(string userdata)
    {
        if (!Directory.Exists(userdata))
        {
            return null;
        }

        try
        {
            return Directory.EnumerateDirectories(userdata)
                .Select(Path.GetFileName)
                .Where(name => !string.IsNullOrEmpty(name) && name != "0" && name.All(char.IsAsciiDigit))
                .Order(StringComparer.Ordinal)
                .FirstOrDefault();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string? MostRecentAccount(string steamRoot)
    {
        string text;
        try
        {
            text = File.ReadAllText(Path.Combine(steamRoot, "config", "loginusers.vdf"));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }

        var user = ParseLoginUsers(text)
            .OrderByDescending(user => user.MostRecent)
            .ThenByDescending(user => user.Timestamp)
            .FirstOrDefault();
        return user is not null && user.SteamId > SteamId64Base ? (user.SteamId - SteamId64Base).ToString() : null;
    }

    internal static List<LoginUser> ParseLoginUsers(string text)
    {
        var tokens = Tokenize(text);
        var users = new List<LoginUser>();
        var depth = 0;
        LoginUser? current = null;
        for (var index = 0; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token == "{")
            {
                depth++;
            }
            else if (token == "}")
            {
                if (depth == 2 && current is not null)
                {
                    users.Add(current);
                    current = null;
                }

                depth = Math.Max(0, depth - 1);
            }
            else if (depth == 1 && index + 1 < tokens.Count && tokens[index + 1] == "{")
            {
                current = ulong.TryParse(token, out var steamId) ? new LoginUser(steamId, false, 0) : null;
            }
            else if (depth == 2 && index + 1 < tokens.Count)
            {
                var value = tokens[++index];
                if (current is null)
                {
                    continue;
                }

                if (token.Equals("MostRecent", StringComparison.OrdinalIgnoreCase))
                {
                    current = current with { MostRecent = value == "1" };
                }
                else if (token.Equals("Timestamp", StringComparison.OrdinalIgnoreCase))
                {
                    current = current with { Timestamp = ulong.TryParse(value, out var timestamp) ? timestamp : 0 };
                }
            }
        }

        return users;
    }

    private static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        for (var index = 0; index < text.Length; index++)
        {
            var ch = text[index];
            if (ch is '{' or '}')
            {
                tokens.Add(ch.ToString());
            }
            else if (ch == '"')
            {
                var token = new StringBuilder();
                for (index++; index < text.Length && text[index] != '"'; index++)
                {
                    if (text[index] == '\\' && index + 1 < text.Length)
                    {
                        index++;
                    }

                    token.Append(text[index]);
                }

                tokens.Add(token.ToString());
            }
            else if (ch == '/' && index + 1 < text.Length && text[index + 1] == '/')
            {
                while (index < text.Length && text[index] != '\n')
                {
                    index++;
                }
            }
        }

        return tokens;
    }
}
