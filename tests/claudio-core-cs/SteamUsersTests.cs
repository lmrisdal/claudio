using AwesomeAssertions;
using Claudio.Core.Linux;

namespace Claudio.Core.Tests;

public class SteamUsersTests
{
    private const string LoginUsers = """
        "users"
        {
        	"76561197960265729"
        	{
        		"AccountName"		"older"
        		"timestamp"		"100"
        	}
        	"76561198009896654"
        	{
        		"AccountName"		"newer"
        		"timestamp"		"200"
        	}
        }
        """;

    private static string ShortcutsFor(string userdata, string account) => Path.Combine(userdata, account, "config", "shortcuts.vdf");

    [Test]
    public async Task LoginUsersPreferMostRecentThenTimestamp()
    {
        SteamUsers.ParseLoginUsers(LoginUsers).Should().Equal(
            new SteamUsers.LoginUser(76_561_197_960_265_729, false, 100),
            new SteamUsers.LoginUser(76_561_198_009_896_654, false, 200));

        var marked = LoginUsers.Replace("\"timestamp\"\t\t\"100\"", "\"timestamp\"\t\t\"100\"\n\"MostRecent\"\t\t\"1\"");
        SteamUsers.ParseLoginUsers(marked)[0].MostRecent.Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ShortcutsPathUsesTheLoggedInAccountNotFolderZero()
    {
        using var data = new TestDataDir();
        var steamRoot = Path.Combine(data.Root, ".steam", "steam");
        var userdata = Path.Combine(steamRoot, "userdata");
        foreach (var account in new[] { "0", "1", "49630926" })
        {
            Directory.CreateDirectory(Path.Combine(userdata, account));
        }

        Directory.CreateDirectory(Path.Combine(steamRoot, "config"));
        File.WriteAllText(Path.Combine(steamRoot, "config", "loginusers.vdf"), LoginUsers);

        SteamUsers.ShortcutsPath(data.Root).Should().Be(ShortcutsFor(userdata, "49630926"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task ShortcutsPathSkipsFolderZeroWithoutLoginUsers()
    {
        using var data = new TestDataDir();
        var userdata = Path.Combine(data.Root, ".local", "share", "Steam", "userdata");
        Directory.CreateDirectory(Path.Combine(userdata, "0"));
        Directory.CreateDirectory(Path.Combine(userdata, "1234"));

        SteamUsers.ShortcutsPath(data.Root).Should().Be(ShortcutsFor(userdata, "1234"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task ShortcutsPathIsNullWhenOnlyFolderZeroExists()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(Path.Combine(data.Root, ".steam", "steam", "userdata", "0"));

        SteamUsers.ShortcutsPath(data.Root).Should().BeNull();
        await Task.CompletedTask;
    }
}
