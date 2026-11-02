using AwesomeAssertions;
using Claudio.Core.Logging;

namespace Claudio.Core.Tests;

[NotInParallel("data")]
public class SettingsTests
{
    [Test]
    public async Task SaveAndLoadUseOverriddenDataDir()
    {
        using var data = new TestDataDir();
        var settings = DesktopSettings.CreateDefault();
        settings.ServerUrl = "http://example";

        SettingsStore.Save(settings);

        SettingsStore.Load().ServerUrl.Should().Be("http://example");
        File.Exists(Path.Combine(data.DataDir, "settings.json")).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task InvalidLogLevelDefaultsToInfo()
    {
        SettingsStore.NormalizeLogLevel("loud").Should().Be("info");
        await Task.CompletedTask;
    }

    [Test]
    public async Task WarningAliasNormalizesToWarn()
    {
        SettingsStore.NormalizeLogLevel(" WARNING ").Should().Be("warn");
        await Task.CompletedTask;
    }

    [Test]
    public async Task SanitizeCustomHeadersRemovesForbiddenEntries()
    {
        var headers = new Dictionary<string, string> { ["Host"] = "x", ["Content-Length"] = "1", ["X-Token"] = "t" };

        SettingsStore.SanitizeHeaders(headers).Should().BeEquivalentTo(new Dictionary<string, string> { ["X-Token"] = "t" });
        await Task.CompletedTask;
    }

    [Test]
    public async Task DefaultInstallRootPrefersConfiguredPath()
    {
        var settings = DesktopSettings.CreateDefault();
        settings.DefaultInstallPath = "/custom/games";

        SettingsStore.DefaultInstallRoot(settings).Should().Be("/custom/games");
        await Task.CompletedTask;
    }

    [Test]
    public async Task DefaultDownloadRootPrefersConfiguredPath()
    {
        var settings = DesktopSettings.CreateDefault();
        settings.DefaultDownloadPath = "/custom/downloads";

        SettingsStore.DefaultDownloadRoot(settings).Should().Be("/custom/downloads");
        await Task.CompletedTask;
    }

    [Test]
    public async Task DefaultDownloadRootFallsBackToAppDataDownloadsSubdir()
    {
        using var data = new TestDataDir();

        SettingsStore.DefaultDownloadRoot(DesktopSettings.CreateDefault()).Should().Be(Path.Combine(data.DataDir, "downloads"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task ToolsDirIsCreatedUnderOverriddenDataDir()
    {
        using var data = new TestDataDir();

        SettingsStore.ToolsDir().Should().Be(Path.Combine(data.DataDir, "tools"));
        Directory.Exists(Path.Combine(data.DataDir, "tools")).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task LoadKeepsSettingsSavedWithRemovedLinuxRuntimeBackend()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        File.WriteAllText(
            Path.Combine(data.DataDir, "settings.json"),
            """{"serverUrl":"http://old","windowWidth":1,"windowHeight":2,"linuxRuntimeBackend":"wine"}""");

        SettingsStore.Load().ServerUrl.Should().Be("http://old");
        await Task.CompletedTask;
    }

    [Test]
    public async Task LoadFallsBackToDefaultsWithoutWindowDimensions()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        File.WriteAllText(Path.Combine(data.DataDir, "settings.json"), """{"serverUrl":"http://old"}""");

        var settings = SettingsStore.Load();

        settings.ServerUrl.Should().BeNull();
        settings.WindowWidth.Should().Be(1280);
        await Task.CompletedTask;
    }

    [Test]
    public async Task SavedFloatsKeepTheirDecimalPoint()
    {
        using var data = new TestDataDir();
        var settings = DesktopSettings.CreateDefault();
        settings.WindowWidth = 1;
        settings.DownloadSpeedLimitKbs = 512.5;

        SettingsStore.Save(settings);

        var text = File.ReadAllText(Path.Combine(data.DataDir, "settings.json"));
        text.Should().Contain("\"windowWidth\": 1.0");
        text.Should().Contain("\"downloadSpeedLimitKbs\": 512.5");
        await Task.CompletedTask;
    }
}

[NotInParallel("data")]
public class RegistryTests
{
    [Test]
    public async Task UpsertSortsGamesByTitle()
    {
        using var data = new TestDataDir();
        var zebra = data.Child("zebra");
        var alpha = data.Child("alpha");

        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "Zebra", zebra));
        InstalledGamesRegistry.Upsert(TestGames.Installed(2, "Alpha", alpha));

        InstalledGamesRegistry.List().Select(game => game.Title).Should().Equal("Alpha", "Zebra");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ListPrunesMissingInstallPaths()
    {
        using var data = new TestDataDir();
        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "Kept", data.Child("kept")));
        InstalledGamesRegistry.Upsert(TestGames.Installed(2, "Gone", Path.Combine(data.Root, "gone")));

        InstalledGamesRegistry.List().Select(game => game.Title).Should().Equal("Kept");
        await Task.CompletedTask;
    }

    [Test]
    public async Task CorruptRegistryIsReportedAndLeftInPlace()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        var path = Path.Combine(data.DataDir, "installed-games.json");
        File.WriteAllText(path, "{broken");

        var list = () => InstalledGamesRegistry.List();

        list.Should().Throw<CommandException>().WithMessage("Failed to parse the installed games list*");
        File.ReadAllText(path).Should().Be("{broken");
        await Task.CompletedTask;
    }

    [Test]
    public async Task UpsertRecoversFromEmptyRegistryFile()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        File.WriteAllText(Path.Combine(data.DataDir, "installed-games.json"), "");

        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "A", data.Child("a")));

        InstalledGamesRegistry.List().Should().HaveCount(1);
        await Task.CompletedTask;
    }

    [Test]
    public async Task GetLoadsEntriesSavedWithRemovedBottlesFields()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        var install = data.Child("legacy");
        File.WriteAllText(
            Path.Combine(data.DataDir, "installed-games.json"),
            $$"""[{"remoteGameId":7,"title":"Legacy","platform":"linux","installType":"portable","installPath":{{System.Text.Json.JsonSerializer.Serialize(install)}},"installedAt":"1","bottleName":"x","linuxRuntimeBackend":"wine"}]""");

        InstalledGamesRegistry.Get(7)!.Title.Should().Be("Legacy");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ConcurrentListAndUpsertKeepEveryGame()
    {
        using var data = new TestDataDir();
        var upserts = Enumerable.Range(1, 25).Select(id =>
        {
            var path = data.Child($"g{id}");
            return Task.Run(() =>
            {
                InstalledGamesRegistry.Upsert(TestGames.Installed(id, $"Game {id:D2}", path));
                InstalledGamesRegistry.List();
            });
        });

        await Task.WhenAll(upserts);

        InstalledGamesRegistry.List().Should().HaveCount(25);
    }

    [Test]
    public async Task SaveLeavesNoTemporaryFile()
    {
        using var data = new TestDataDir();

        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "A", data.Child("a")));

        File.Exists(Path.Combine(data.DataDir, "installed-games.json.tmp")).Should().BeFalse();
        await Task.CompletedTask;
    }
}

[NotInParallel("log")]
public class LoggingTests
{
    [Test]
    public async Task FormatsEpochAndLeapDayTimestamps()
    {
        Log.FormatTimestamp(DateTime.UnixEpoch).Should().Be("1970-01-01T00:00:00Z");
        Log.FormatTimestamp(new DateTime(2024, 2, 29, 23, 59, 58, DateTimeKind.Utc)).Should().Be("2024-02-29T23:59:58Z");
        await Task.CompletedTask;
    }

    [Test]
    public async Task WritesRecordsAtOrBelowTheLevel()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        Log.Init(data.DataDir, LogLevel.Warn, mirror: false);

        Log.Error("t", "an error");
        Log.Warn("t", "a warning");
        Log.Info("t", "an info");

        var text = File.ReadAllText(Path.Combine(data.DataDir, "claudio.log"));
        text.Should().Contain("[ERROR][t] an error").And.Contain("[WARN][t] a warning").And.NotContain("an info");
        await Task.CompletedTask;
    }

    [Test]
    public async Task RotatesOnceAndKeepsASingleOldFile()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(data.DataDir);
        Log.Init(data.DataDir, LogLevel.Info, maxLogBytes: 200, mirror: false);

        for (var index = 0; index < 20; index++)
        {
            Log.Info("t", new string('x', 40));
        }

        File.Exists(Path.Combine(data.DataDir, "claudio.old.log")).Should().BeTrue();
        new FileInfo(Path.Combine(data.DataDir, "claudio.log")).Length.Should().BeLessThanOrEqualTo(300);
        Directory.GetFiles(data.DataDir, "claudio*.log").Should().HaveCount(2);
        await Task.CompletedTask;
    }
}
