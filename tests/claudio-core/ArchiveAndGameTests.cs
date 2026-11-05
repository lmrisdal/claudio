using System.Formats.Tar;
using System.IO.Compression;
using System.Net;
using System.Diagnostics;
using AwesomeAssertions;

namespace Claudio.Core.Tests;

public class ExtractTests
{
    private static readonly string? SevenZip = new[] { "/usr/bin/7zzs", "/usr/bin/7zz", "/usr/bin/7z" }.FirstOrDefault(File.Exists);

    private static string Source(TestDataDir data)
    {
        var source = data.Child("source");
        Directory.CreateDirectory(Path.Combine(source, "Game", "data"));
        File.WriteAllText(Path.Combine(source, "Game", "game.exe"), "exe");
        File.WriteAllBytes(Path.Combine(source, "Game", "data", "a.bin"), new byte[50_000]);
        return source;
    }

    private static void Extract(string archive, string destination, bool cancelled = false)
    {
        var control = new InstallControl();
        control.SetCancelled(cancelled);
        Install.Extract.ArchiveOrCopy(archive, destination, control, "/nonexistent", _ => { });
    }

    [Test]
    public async Task ExtractArchiveOrCopyExtractsZipArchives()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.zip");
        ZipFile.CreateFromDirectory(Source(data), archive);

        Extract(archive, Path.Combine(data.Root, "out"));

        File.ReadAllText(Path.Combine(data.Root, "out", "Game", "game.exe")).Should().Be("exe");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyExtractsTarGzArchives()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.tar.gz");
        using (var file = File.Create(archive))
        using (var gzip = new GZipStream(file, CompressionLevel.Fastest))
        {
            TarFile.CreateFromDirectory(Source(data), gzip, includeBaseDirectory: false);
        }

        Extract(archive, Path.Combine(data.Root, "out"));

        File.Exists(Path.Combine(data.Root, "out", "Game", "data", "a.bin")).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyRejectsCorruptTarGzTrailers()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.tar.gz");
        using (var file = File.Create(archive))
        using (var gzip = new GZipStream(file, CompressionLevel.Fastest))
        {
            TarFile.CreateFromDirectory(Source(data), gzip, includeBaseDirectory: false);
        }

        var bytes = File.ReadAllBytes(archive);
        bytes[^6] ^= 0xFF;
        File.WriteAllBytes(archive, bytes);

        var extract = () => Extract(archive, Path.Combine(data.Root, "out"));

        extract.Should().Throw<CommandException>();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyRejectsCorruptZipEntries()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.zip");
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        {
            var entry = zip.CreateEntry("file.bin", CompressionLevel.NoCompression);
            using var stream = entry.Open();
            stream.Write(Enumerable.Repeat((byte)7, 20_000).ToArray());
        }

        var bytes = File.ReadAllBytes(archive);
        bytes[5_000] ^= 0xFF;
        File.WriteAllBytes(archive, bytes);

        var extract = () => Extract(archive, Path.Combine(data.Root, "out"));

        extract.Should().Throw<CommandException>().WithMessage("*checksum mismatch*");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ZipEntriesThatEscapeTheDestinationAreSkipped()
    {
        Install.Extract.EnclosedName("../evil.txt").Should().BeNull();
        Install.Extract.EnclosedName("/abs.txt").Should().BeNull();
        Install.Extract.EnclosedName("a/../../evil").Should().BeNull();
        Install.Extract.EnclosedName("a/./b/../c.txt").Should().Be(Path.Combine("a", "c.txt"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyCopiesDirectorySourcesIntoDestination()
    {
        using var data = new TestDataDir();
        var destination = Path.Combine(data.Root, "out");

        Extract(Source(data), destination);

        File.Exists(Path.Combine(destination, "Game", "game.exe")).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyRespectsPreCancelledCopyRequests()
    {
        using var data = new TestDataDir();
        var file = Path.Combine(data.Root, "readme.txt");
        File.WriteAllText(file, "x");

        var extract = () => Extract(file, Path.Combine(data.Root, "out"), cancelled: true);

        extract.Should().Throw<CommandException>().WithMessage("Install cancelled.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyStopsZipExtractionWhenCancelled()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.zip");
        ZipFile.CreateFromDirectory(Source(data), archive);

        var extract = () => Extract(archive, Path.Combine(data.Root, "out"), cancelled: true);

        extract.Should().Throw<CommandException>().WithMessage("Install cancelled.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyReportsMissingSevenZipBinary()
    {
        using var data = new TestDataDir();
        var archive = Path.Combine(data.Root, "a.7z");
        File.WriteAllText(archive, "x");

        var extract = () => Extract(archive, Path.Combine(data.Root, "out"));

        extract.Should().Throw<CommandException>().WithMessage("7-Zip was not found at*");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractArchiveOrCopyExtractsSevenZipArchivesAndReportsCorruptOnes()
    {
        if (SevenZip is null || !OperatingSystem.IsLinux())
        {
            return;
        }

        using var data = new TestDataDir();
        var source = Source(data);
        var archive = Path.Combine(data.Root, "a.7z");
        Run(SevenZip, "a", archive, "Game", workingDirectory: source);
        var resources = data.Child("resources");
        Directory.CreateDirectory(Path.Combine(resources, "7-zip"));
        File.CreateSymbolicLink(Path.Combine(resources, "7-zip", "7zzs"), SevenZip);

        Install.Extract.ArchiveOrCopy(archive, Path.Combine(data.Root, "out"), new InstallControl(), resources, _ => { });
        File.Exists(Path.Combine(data.Root, "out", "Game", "game.exe")).Should().BeTrue();

        var bytes = File.ReadAllBytes(archive);
        bytes[40] ^= 0xFF;
        File.WriteAllBytes(archive, bytes);
        var extract = () => Install.Extract.ArchiveOrCopy(archive, Path.Combine(data.Root, "out2"), new InstallControl(), resources, _ => { });
        extract.Should().Throw<CommandException>();
        await Task.CompletedTask;
    }

    private static void Run(string program, string command, string archive, string input, string workingDirectory)
    {
        var info = new ProcessStartInfo(program) { WorkingDirectory = workingDirectory, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(command);
        info.ArgumentList.Add(archive);
        info.ArgumentList.Add(input);
        using var process = Process.Start(info)!;
        process.StandardOutput.ReadToEnd();
        process.WaitForExit();
    }
}

[NotInParallel("data")]
public class GameCommandTests
{
    private static InstalledGame WithPrefix(TestDataDir data, int id, string? prefixName = "prefix")
    {
        var game = TestGames.Installed(id, "Game", data.Child("install"));
        game.WinePrefix = prefixName is null ? null : data.Child(prefixName);
        return game;
    }

    [Test]
    public async Task UninstallGameCanPreserveOrDeleteInstallFiles()
    {
        using var data = new TestDataDir();
        var install = data.Child("install");
        File.WriteAllText(Path.Combine(install, "a.txt"), "x");
        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "Game", install));

        Games.UninstallGame(1, deleteFiles: false);
        Directory.Exists(install).Should().BeTrue();
        InstalledGamesRegistry.Upsert(TestGames.Installed(1, "Game", install));
        Games.UninstallGame(1, deleteFiles: true);

        Directory.Exists(install).Should().BeFalse();
        InstalledGamesRegistry.List().Should().BeEmpty();
        await Task.CompletedTask;
    }

    [Test]
    public async Task DeleteInstallArtifactsRemovesInstallDirAndUmuPrefix()
    {
        using var data = new TestDataDir();
        var game = WithPrefix(data, 2);
        InstalledGamesRegistry.Upsert(game);

        Games.UninstallGame(2, deleteFiles: true);

        Directory.Exists(game.InstallPath).Should().BeFalse();
        Directory.Exists(game.WinePrefix!).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task DeleteInstallArtifactsRemovesPrefixUsedAsInstallPath()
    {
        using var data = new TestDataDir();
        var install = data.Child("install");
        Directory.CreateDirectory(Path.Combine(install, "drive_c"));
        var game = TestGames.Installed(3, "Game", install);
        game.WinePrefix = install;
        InstalledGamesRegistry.Upsert(game);

        Games.UninstallGame(3, deleteFiles: true);

        Directory.Exists(install).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task DeleteInstallArtifactsKeepsWinePrefixItDoesNotManage()
    {
        using var data = new TestDataDir();
        var install = data.Child("install");
        Directory.CreateDirectory(Path.Combine(install, "drive_c"));
        Directory.CreateDirectory(Path.Combine(install, "dosdevices"));
        InstalledGamesRegistry.Upsert(TestGames.Installed(4, "Game", install));

        Games.UninstallGame(4, deleteFiles: true);

        Directory.Exists(install).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ListGameExecutablesIncludesBatFilesAndExcludesShellScripts()
    {
        using var data = new TestDataDir();
        var install = data.Child("install");
        File.WriteAllText(Path.Combine(install, "start.bat"), "x");
        File.WriteAllText(Path.Combine(install, "game.exe"), "x");
        File.WriteAllText(Path.Combine(install, "run.sh"), "x");
        InstalledGamesRegistry.Upsert(TestGames.Installed(5, "Game", install));

        GameExecutables.List(5).Should().Equal("game.exe", "start.bat");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ListGameExecutablesIncludesWinePrefixDriveC()
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        using var data = new TestDataDir();
        var install = data.Child("install");
        var prefix = data.Child("prefix");
        Directory.CreateDirectory(Path.Combine(prefix, "pfx", "drive_c", "Games"));
        File.WriteAllText(Path.Combine(prefix, "pfx", "drive_c", "Games", "g.exe"), "x");
        File.WriteAllText(Path.Combine(install, "i.exe"), "x");
        var game = TestGames.Installed(6, "Game", install);
        game.WinePrefix = prefix;
        InstalledGamesRegistry.Upsert(game);

        GameExecutables.List(6).Should().Equal(Path.Combine("Games", "g.exe"), "i.exe");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ListGameExecutablesUsesDriveCWhenInstallPathIsWinePrefix()
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        using var data = new TestDataDir();
        var prefix = data.Child("prefix");
        Directory.CreateDirectory(Path.Combine(prefix, "pfx", "drive_c"));
        File.WriteAllText(Path.Combine(prefix, "pfx", "drive_c", "g.exe"), "x");
        File.WriteAllText(Path.Combine(prefix, "outside.exe"), "x");
        var game = TestGames.Installed(7, "Game", prefix);
        game.WinePrefix = prefix;
        InstalledGamesRegistry.Upsert(game);

        GameExecutables.List(7).Should().Equal("g.exe");
        await Task.CompletedTask;
    }

    [Test]
    public async Task LaunchSettingsPersistAndInvalidExecutableLeavesRegistryUnchanged()
    {
        using var data = new TestDataDir();
        var install = data.Child("install");
        File.WriteAllText(Path.Combine(install, "game.exe"), "x");
        InstalledGamesRegistry.Upsert(TestGames.Installed(8, "Game", install));

        GameExecutables.UpdateLaunchSettings(8, "game.exe", "umu-sniper", new GameLaunchOptions { Parameters = "-a" });
        var invalid = () => GameExecutables.UpdateLaunchSettings(8, "missing.exe", null, new GameLaunchOptions());

        invalid.Should().Throw<CommandException>().WithMessage("Selected executable no longer exists.");
        var saved = InstalledGamesRegistry.Get(8)!;
        saved.GameExe.Should().Be(Path.Combine(install, "game.exe"));
        saved.ProtonPath.Should().Be("umu-sniper");
        saved.LaunchOptions.Parameters.Should().Be("-a");
        await Task.CompletedTask;
    }

    [Test]
    public async Task LinuxExecutableHintResolvesInsidePrefilledDestination()
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        using var data = new TestDataDir();
        var driveC = data.Child("drive_c");
        var destination = Path.Combine(driveC, "Games", "Game");
        Directory.CreateDirectory(destination);
        File.WriteAllText(Path.Combine(destination, "start.exe"), "x");

        LinuxInstallerFlow.ResolveGameExeHint(driveC, @"C:\Games\Game", "start.exe").Should().Be(Path.Combine(destination, "start.exe"));
        LinuxInstallerFlow.ResolveGameExeHint(driveC, @"C:\Games\Game", null).Should().BeNull();
        await Task.CompletedTask;
    }

    [Test]
    public async Task LinuxDestinationStaysInsideThePrefixCDrive()
    {
        PayloadOps.PrefixInstallDirectory("My: Game.").Should().Be(@"C:\Games\My Game");
        PayloadOps.PrefixPayloadDirectory("p", "My: Game").Should().Be(Path.Combine("p", "pfx", "drive_c", "Games", "My Game"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task PortableAutoDetectionSearchesOnlyTheGamePayload()
    {
        using var data = new TestDataDir();
        var extract = data.Child("extract");
        File.WriteAllText(Path.Combine(extract, "game.exe"), "x");
        var payload = Path.Combine(data.Root, "payload");

        var exe = PayloadOps.FinalizePortablePayload(extract, payload, null);

        exe.Should().Be(Path.Combine(payload, "game.exe"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task PortablePayloadMatchesInstallerDestinationForSanitizedTitles()
    {
        PayloadOps.PrefixPayloadDirectory("/p", "A/B").Should().EndWith(Path.Combine("Games", "A_B"));
        PayloadOps.PrefixInstallDirectory("A/B").Should().Be(@"C:\Games\A_B");
        await Task.CompletedTask;
    }

    [Test]
    public async Task HasActiveOperationsIsFalseWhenIdle()
    {
        new InstallState().HasActiveOperations.Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task EnsureNotRunningRejectsAliveProcess()
    {
        var running = new RunningGames();
        running.Upsert(new RunningGameInfo { GameId = 7, Pid = (uint)Environment.ProcessId });

        var ensure = () => running.EnsureNotRunning(7);

        ensure.Should().Throw<CommandException>().WithMessage("This game is already running.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task EnsureNotRunningRemovesStaleProcess()
    {
        var running = new RunningGames();
        running.Upsert(new RunningGameInfo { GameId = 8, Pid = uint.MaxValue });

        running.EnsureNotRunning(8);

        running.ListActive().Should().BeEmpty();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ListActivePrunesDeadProcesses()
    {
        var running = new RunningGames();
        running.Upsert(new RunningGameInfo { GameId = 1, Pid = uint.MaxValue });
        running.Upsert(new RunningGameInfo { GameId = 2, Pid = (uint)Environment.ProcessId });

        running.ListActive().Select(game => game.GameId).Should().Equal(2);
        await Task.CompletedTask;
    }

    [Test]
    public async Task StopGameTerminatesTrackedProcess()
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        var info = new ProcessStartInfo("sleep", "30") { UseShellExecute = false };
        using var process = Process.Start(info)!;
        var running = new RunningGames();
        running.Upsert(new RunningGameInfo { GameId = 3, Pid = (uint)process.Id });

        running.Stop(3);

        process.WaitForExit(5000).Should().BeTrue();
        await Task.CompletedTask;
    }
}

[NotInParallel("data")]
public class ServerConnectionTests
{
    private static async Task<(HttpListener Listener, string Url)> Listen(Func<HttpListenerContext, Task> handler)
    {
        for (var port = 20_000 + Random.Shared.Next(20_000); ; port++)
        {
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            try
            {
                listener.Start();
            }
            catch (HttpListenerException)
            {
                continue;
            }

            _ = Task.Run(async () =>
            {
                while (listener.IsListening)
                {
                    try
                    {
                        await handler(await listener.GetContextAsync());
                    }
                    catch (Exception error) when (error is HttpListenerException or ObjectDisposedException)
                    {
                        return;
                    }
                }
            });
            await Task.CompletedTask;
            return (listener, $"http://127.0.0.1:{port}");
        }
    }

    [Test]
    public async Task NormalizePathRequiresLeadingSlash()
    {
        var normalize = () => ServerConnection.NormalizePath("health");

        normalize.Should().Throw<CommandException>().WithMessage("Connection test path must start with '/'.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task DesktopCheckServerConnectionUsesOverrideHeaders()
    {
        using var data = new TestDataDir();
        string? seen = null;
        var (listener, url) = await Listen(async context =>
        {
            seen = context.Request.Headers["X-Test"];
            context.Response.StatusCode = 200;
            context.Response.ContentType = "application/json";
            await context.Response.OutputStream.WriteAsync("""{"providers":[]}"""u8.ToArray());
            context.Response.Close();
        });
        using (listener)
        {
            var result = await ServerConnection.CheckAsync(new Rpc.ConnectionArgs
            {
                ServerUrl = url,
                CustomHeaders = new Dictionary<string, string> { ["X-Test"] = "ok" },
            });

            result.Ok.Should().BeTrue();
            seen.Should().Be("ok");
        }
    }

    [Test]
    public async Task DesktopCheckServerConnectionUsesSavedSettingsWhenOverridesMissing()
    {
        using var data = new TestDataDir();
        string? seen = null;
        var (listener, url) = await Listen(context =>
        {
            seen = context.Request.Headers["X-Saved"];
            context.Response.StatusCode = 204;
            context.Response.Close();
            return Task.CompletedTask;
        });
        using (listener)
        {
            var settings = DesktopSettings.CreateDefault();
            settings.ServerUrl = url + "/";
            settings.CustomHeaders["X-Saved"] = "yes";
            SettingsStore.Save(settings);

            var result = await ServerConnection.CheckAsync(new Rpc.ConnectionArgs());

            result.Status.Should().Be(204);
            seen.Should().Be("yes");
        }
    }

    [Test]
    public async Task DesktopCheckServerConnectionRejectsHtmlSuccessFromAProxy()
    {
        using var data = new TestDataDir();
        var (listener, url) = await Listen(async context =>
        {
            context.Response.ContentType = "text/html; charset=utf-8";
            await context.Response.OutputStream.WriteAsync("<html></html>"u8.ToArray());
            context.Response.Close();
        });
        using (listener)
        {
            var result = await ServerConnection.CheckAsync(new Rpc.ConnectionArgs { ServerUrl = url });

            result.Ok.Should().BeFalse();
            result.Status.Should().Be(200);
        }
    }

    [Test]
    public async Task DesktopCheckServerConnectionReportsHttpFailureStatus()
    {
        using var data = new TestDataDir();
        var (listener, url) = await Listen(context =>
        {
            context.Response.StatusCode = 503;
            context.Response.Close();
            return Task.CompletedTask;
        });
        using (listener)
        {
            var result = await ServerConnection.CheckAsync(new Rpc.ConnectionArgs { ServerUrl = url });

            result.Ok.Should().BeFalse();
            result.Status.Should().Be(503);
        }
    }
}
