using AwesomeAssertions;
using Claudio.Core.Linux;
using Claudio.Core.Runtime;

namespace Claudio.Core.Tests;

public class LaunchArgumentsTests
{
    [Test]
    public async Task PreservesQuotedArgumentsAndLiteralShellCharacters()
    {
        LaunchArguments.Parse("""-name "Player One" '' $HOME ; C:\games\save""")
            .Should().Equal("-name", "Player One", "", "$HOME", ";", @"C:\games\save");
        await Task.CompletedTask;
    }

    [Test]
    public async Task RejectsUnclosedQuotes()
    {
        var parse = () => LaunchArguments.Parse("-name \"Player");

        parse.Should().Throw<CommandException>().WithMessage("Launch parameters contain an unclosed quote.");
        await Task.CompletedTask;
    }
}

[NotInParallel("environment")]
public class VersionTests
{
    [Test]
    public async Task DisplayVersionUsesShortCommitShaWhenPresent()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_COMMIT_SHA", "abcdef123456");
        try
        {
            Ping.DisplayVersion().Should().Be("abcdef1");
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_COMMIT_SHA", null);
        }

        await Task.CompletedTask;
    }

    [Test]
    public async Task DisplayVersionFallsBackToPackageVersionWhenEnvMissing()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_COMMIT_SHA", null);

        Ping.DisplayVersion().Should().Be(Ping.PackageVersion());
        await Task.CompletedTask;
    }

    [Test]
    public async Task PingReturnsCurrentPlatformAndVersion()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_COMMIT_SHA", null);

        var response = Ping.Run();

        response.Platform.Should().Be(OperatingSystem.IsWindows() ? "windows" : "linux");
        response.Version.Should().Be(Ping.DisplayVersion());
        await Task.CompletedTask;
    }
}

public class LinuxHostTests
{
    [Test]
    public async Task NestedRuntimePathStripsDistroboxHostRoot()
    {
        HostPaths.NestedRuntimePath("/run/host/var/mnt/games").Should().Be("/var/mnt/games");
        await Task.CompletedTask;
    }

    [Test]
    public async Task NestedRuntimePathKeepsRegularAbsolutePath()
    {
        HostPaths.NestedRuntimePath("/home/lars/Games").Should().Be("/home/lars/Games");
        await Task.CompletedTask;
    }

    [Test]
    public async Task NestedRuntimePathMapsHostRootToRoot()
    {
        HostPaths.NestedRuntimePath("/run/host").Should().Be("/");
        await Task.CompletedTask;
    }

    [Test]
    public async Task BinarySearchDirsIncludeStandardLinuxLocationsWithoutPathEnv()
    {
        Umu.BinarySearchDirs(null).Should().Contain("/usr/bin");
        await Task.CompletedTask;
    }

    [Test]
    public async Task BinarySearchDirsIncludeDistroboxHostLocationsWithoutPathEnv()
    {
        Umu.BinarySearchDirs(null).Should().Contain("/run/host/usr/bin");
        await Task.CompletedTask;
    }

    [Test]
    public async Task BinarySearchDirsKeepPathEntriesBeforeFallbacks()
    {
        Umu.BinarySearchDirs("/custom/bin:/usr/bin").First().Should().Be("/custom/bin");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ManagedUmuDownloadUrlUsesPinnedVersion()
    {
        Umu.DownloadUrl().Should().Contain(Umu.ManagedVersion);
        await Task.CompletedTask;
    }

    [Test]
    [NotInParallel("environment")]
    public async Task CachedManagedUmuRunReturnsPinnedCachedZipapp()
    {
        using var data = new TestDataDir();
        Directory.CreateDirectory(Umu.ManagedDir());
        File.WriteAllText(Umu.ManagedRunPath(), "umu");
        File.WriteAllText(Path.Combine(Umu.ManagedDir(), "VERSION"), Umu.ManagedVersion);

        Umu.ResolveRun().Should().Be(Umu.ManagedRunPath());
        await Task.CompletedTask;
    }

    [Test]
    public async Task SelectedProtonPathFallsBackForUninstalledGeAlias()
    {
        Proton.SelectedPath("GE-Latest").Should().Be("UMU-Latest");
        await Task.CompletedTask;
    }

    [Test]
    public async Task SelectedProtonPathKeepsUmuLatestAlias()
    {
        Proton.SelectedPath("UMU-Latest").Should().Be("UMU-Latest");
        await Task.CompletedTask;
    }

    [Test]
    public async Task MsiUsesMsiexecAndPreservesSpacedPaths()
    {
        var command = UmuCommand.PrefixCommand("umu-run", "/downloads/My Game.MSI", [@"TARGETDIR=C:\Games\My Game"]);

        command.ArgumentList.Should().Equal("msiexec", "/i", "/downloads/My Game.MSI", @"TARGETDIR=C:\Games\My Game");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExeReceivesDestinationAsOneArgument()
    {
        var command = UmuCommand.PrefixCommand("umu-run", "/downloads/setup.exe", [@"/DIR=C:\Games\My Game"]);

        command.ArgumentList.Should().Equal("/downloads/setup.exe", @"/DIR=C:\Games\My Game");
        await Task.CompletedTask;
    }

    [Test]
    public async Task BinaryVdfRoundTripsShortcutFields()
    {
        var shortcut = new VdfObject();
        shortcut.Items["AppName"] = new VdfString("A Game");
        shortcut.Items["appid"] = new VdfInt32(BinaryVdf.Int32, 42);
        var shortcuts = new VdfObject();
        shortcuts.Items["42"] = shortcut;
        var root = new VdfObject();
        root.Items["shortcuts"] = shortcuts;

        var parsed = BinaryVdf.Parse(BinaryVdf.Dump(root));

        parsed.Should().Be(root);
        await Task.CompletedTask;
    }
}
