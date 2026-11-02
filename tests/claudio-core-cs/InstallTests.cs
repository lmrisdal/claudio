using System.Text;
using AwesomeAssertions;
using Claudio.Core.Windows;

namespace Claudio.Core.Tests;

public class FileOpsTests
{
    [Test]
    public async Task SanitizeSegmentReplacesColonsWithSingleSpaces()
    {
        FileOps.SanitizeSegment("Game: The   Sequel").Should().Be("Game The Sequel");
        await Task.CompletedTask;
    }

    [Test]
    public async Task SanitizeSegmentReplacesInvalidPathCharacters()
    {
        FileOps.SanitizeSegment("a/b\\c*d?e\"f<g>h|i").Should().Be("a_b_c_d_e_f_g_h_i");
        FileOps.SanitizeSegment("   ").Should().Be("game");
        await Task.CompletedTask;
    }

    [Test]
    public async Task VisibleEntriesSkipsMacosMetadata()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        Directory.CreateDirectory(Path.Combine(root, "__MACOSX"));
        File.WriteAllText(Path.Combine(root, ".DS_Store"), "x");
        File.WriteAllText(Path.Combine(root, "game.exe"), "x");

        FileOps.VisibleEntries(root).Select(Path.GetFileName).Should().Equal("game.exe");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ClearExistingPathRemovesExistingFile()
    {
        using var data = new TestDataDir();
        var file = Path.Combine(data.Root, "a.txt");
        File.WriteAllText(file, "x");

        FileOps.ClearExistingPath(file);

        File.Exists(file).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task DeleteTreeRemovesReadOnlyFiles()
    {
        using var data = new TestDataDir();
        var directory = data.Child("tree");
        var file = Path.Combine(directory, "locked.txt");
        File.WriteAllText(file, "x");
        File.SetAttributes(file, FileAttributes.ReadOnly);

        FileOps.DeleteTree(directory);

        Directory.Exists(directory).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task DeleteTreeRemovesSymlinksWithoutFollowingThem()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        using var data = new TestDataDir();
        var outside = data.Child("outside");
        var protectedFile = Path.Combine(outside, "keep.txt");
        File.WriteAllText(protectedFile, "keep");
        var prefix = data.Child("prefix");
        Directory.CreateDirectory(Path.Combine(prefix, "dosdevices"));
        File.CreateSymbolicLink(Path.Combine(prefix, "dosdevices", "z:"), outside);
        File.CreateSymbolicLink(Path.Combine(prefix, "dangling"), Path.Combine(data.Root, "missing"));

        FileOps.DeleteTree(prefix);

        Directory.Exists(prefix).Should().BeFalse();
        File.ReadAllText(protectedFile).Should().Be("keep");
        await Task.CompletedTask;
    }

    [Test]
    public async Task MoveVisibleEntriesIntoDirMovesEntriesAndFlattensSingleRoot()
    {
        using var data = new TestDataDir();
        var source = data.Child("source");
        var root = Path.Combine(source, "Game");
        Directory.CreateDirectory(Path.Combine(root, "data"));
        File.WriteAllText(Path.Combine(root, "game.exe"), "x");
        var destination = data.Child("destination");

        var moved = FileOps.MoveVisibleEntriesIntoDir(source, destination);

        moved.Select(Path.GetFileName).Should().BeEquivalentTo("data", "game.exe");
        File.Exists(Path.Combine(destination, "game.exe")).Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task NormalizeIntoFinalDirFlattensSingleExtractedRoot()
    {
        using var data = new TestDataDir();
        var staging = data.Child("staging");
        Directory.CreateDirectory(Path.Combine(staging, "Game"));
        File.WriteAllText(Path.Combine(staging, "Game", "game.exe"), "x");
        var final = Path.Combine(data.Root, "final");

        PayloadOps.NormalizeIntoFinalDir(staging, final);

        File.Exists(Path.Combine(final, "game.exe")).Should().BeTrue();
        Directory.Exists(staging).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task BuildInstallDirUsesSanitizedTitle()
    {
        Path.Combine("games", FileOps.SanitizeSegment("A: B")).Should().Be(Path.Combine("games", "A B"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task InstallDownloadRootUsesConfiguredDownloadRootAndSanitizedTitle()
    {
        InstallPaths.DownloadWorkspaceRoot("downloads", 7, "A/B").Should().Be(Path.Combine("downloads", "A_B-7"));
        await Task.CompletedTask;
    }

    [Test]
    public async Task FormatInstallIoErrorMapsAccessDeniedToFriendlyMessage()
    {
        var message = FileOps.FormatInstallIoError("write", "/target", new UnauthorizedAccessException());

        message.Should().StartWith("Claudio couldn't write to /target while trying to write.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task FormatInstallIoErrorPairMapsAccessDeniedToFriendlyMessage()
    {
        var message = FileOps.FormatInstallIoErrorPair("move", "/a", "/b", new UnauthorizedAccessException());

        message.Should().StartWith("Claudio couldn't move files from /a to /b while trying to move.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ResolveInstallBrowseRootPathUsesNearestReadableParent()
    {
        using var data = new TestDataDir();

        InstallPaths.ResolveInstallBrowseRoot(Path.Combine(data.Root, "missing", "deeper", "game"))
            .Should().Be(data.Root);
        await Task.CompletedTask;
    }

    [Test]
    public async Task ValidateInstallTargetPathAllowsWritableParent()
    {
        using var data = new TestDataDir();

        var validate = () => InstallPaths.ValidateInstallTargetPath(Path.Combine(data.Root, "games", "New"));

        validate.Should().NotThrow();
        Directory.GetFileSystemEntries(Path.Combine(data.Root, "games")).Should().BeEmpty();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ValidateInstallTargetPathRejectsExistingTarget()
    {
        using var data = new TestDataDir();

        var validate = () => InstallPaths.ValidateInstallTargetPath(data.Root);

        validate.Should().Throw<CommandException>().WithMessage($"Install target already exists: {data.Root}");
        await Task.CompletedTask;
    }

    [Test]
    public async Task InferFilenamePrefersUtf8ContentDispositionName()
    {
        using var message = new HttpResponseMessage();
        message.Content = new ByteArrayContent([]);
        message.Content.Headers.TryAddWithoutValidation("Content-Disposition", "attachment; filename*=UTF-8''Pok%C3%A9mon.zip; filename=\"plain.zip\"");

        DownloadHttp.InferFilename(message.Content.Headers).Should().Be("Pok%C3%A9mon.zip");
        await Task.CompletedTask;
    }

    [Test]
    public async Task UrlEncodeKeepsSlashesAndEncodesTheRest()
    {
        DownloadHttp.UrlEncode("Game/a b+é.bin").Should().Be("Game/a%20b%2B%C3%A9.bin");
        await Task.CompletedTask;
    }

    [Test]
    public async Task BuildHeadersAppliesCustomHeadersAndIgnoresForbiddenEntries()
    {
        using var request = DownloadHttp.Request(HttpMethod.Get, "http://x/", new Dictionary<string, string> { ["X-Token"] = "t", ["Host"] = "evil" });

        request.Headers.GetValues("X-Token").Should().Equal("t");
        request.Headers.Contains("Host").Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task InvalidCustomHeadersAreReturnedAsErrors()
    {
        var build = () => DownloadHttp.Request(HttpMethod.Get, "http://x/", new Dictionary<string, string> { ["Bad Name"] = "t" });

        build.Should().Throw<CommandException>();
        await Task.CompletedTask;
    }

    [Test]
    public async Task CachedDownloadInfoRoundTripsCompletedPackage()
    {
        using var data = new TestDataDir();
        var root = data.Child("cache");
        var package = Path.Combine(root, "game.tar");
        File.WriteAllText(package, "package");
        File.WriteAllText(
            Path.Combine(root, ".claudio-download-complete.json"),
            Claudio.Core.Json.CoreJsonContext.SerializePretty(new CachedDownloadInfo { FilePath = package }));

        GameInstaller.ReadMarker(root).FilePath.Should().Be(package);
        await Task.CompletedTask;
    }

    [Test]
    public async Task CachedDownloadInfoFailsWhenMarkerIsMissing()
    {
        using var data = new TestDataDir();

        var read = () => GameInstaller.ReadMarker(data.Child("empty"));

        read.Should().Throw<CommandException>().WithMessage("*downloaded package is no longer available*");
        await Task.CompletedTask;
    }
}

public class InstallerDetectTests
{
    private static string Touch(string root, string relative, string contents = "MZ")
    {
        var path = Path.Combine(root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, contents);
        return path;
    }

    [Test]
    public async Task DetectInstallerFindsNamedSetupsWithoutSelectingUninstallers()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        Touch(root, "unins000.exe");
        Touch(root, "uninstall.exe");
        var setup = Touch(root, "Setup.exe");

        InstallerDetect.Detect(root).Should().Be(setup);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerPrefersTopLevelSetupOverNestedDependencies()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        Touch(root, "redist/setup.exe");
        var top = Touch(root, "setup.exe");

        InstallerDetect.Detect(root).Should().Be(top);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerAndWindowsExecutableFindSortedMatches()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        Touch(root, Path.Combine("b", "game.exe"));
        var first = Touch(root, Path.Combine("a", "game.exe"));

        PayloadOps.DetectWindowsExecutable(root).Should().Be(first);
        await Task.CompletedTask;
    }

    [Test]
    public async Task ResolveInstallerPathUsesHintWhenPresent()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        Touch(root, "setup.exe");
        var hinted = Touch(root, "custom/run-me.exe");

        InstallerDetect.ResolveInstallerPath(root, "custom/run-me.exe").Should().Be(hinted);
        await Task.CompletedTask;
    }

    [Test]
    public async Task ResolveInstallerPathIgnoresDirectoryHint()
    {
        using var data = new TestDataDir();
        var root = data.Child("root");
        var setup = Touch(root, "setup.exe");
        Directory.CreateDirectory(Path.Combine(root, "dir"));

        InstallerDetect.ResolveInstallerPath(root, "dir").Should().Be(setup);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerTypeIdentifiesGogInnoSetupFromAsciiMarker()
    {
        using var data = new TestDataDir();
        var path = Touch(data.Root, "a.exe", "MZ Inno Setup GOG.com");

        InstallerDetect.DetectType(path).Should().Be(InstallerType.GogInnoSetup);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerTypeIdentifiesGogInnoSetupFromUtf16Marker()
    {
        using var data = new TestDataDir();
        var path = Path.Combine(data.Root, "a.exe");
        File.WriteAllBytes(path, [.. "Inno Setup"u8, .. Encoding.Unicode.GetBytes("GOG.com")]);

        InstallerDetect.DetectType(path).Should().Be(InstallerType.GogInnoSetup);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerTypeFallsBackToPlainInnoWithoutGogMarker()
    {
        using var data = new TestDataDir();

        InstallerDetect.DetectType(Touch(data.Root, "a.exe", "Inno Setup")).Should().Be(InstallerType.InnoSetup);
        await Task.CompletedTask;
    }

    [Test]
    public async Task DetectInstallerTypeRequiresInnoMarkerForGogClassification()
    {
        using var data = new TestDataDir();

        InstallerDetect.DetectType(Touch(data.Root, "a.exe", "GOG.com only")).Should().Be(InstallerType.Unknown);
        InstallerDetect.DetectType(Touch(data.Root, "b.exe", "Nullsoft")).Should().Be(InstallerType.Nsis);
        InstallerDetect.DetectType(Touch(data.Root, "c.msi", "x")).Should().Be(InstallerType.Msi);
        await Task.CompletedTask;
    }

    [Test]
    public async Task StreamRequestsElevationDetectsAsciiAndUtf16Markers()
    {
        InstallerDetect.StreamRequestsElevation(new MemoryStream(Encoding.ASCII.GetBytes("xxrequireAdministratorxx"))).Should().BeTrue();
        InstallerDetect.StreamRequestsElevation(new MemoryStream(Encoding.Unicode.GetBytes("highestAvailable"))).Should().BeTrue();
        InstallerDetect.StreamRequestsElevation(new MemoryStream(Encoding.ASCII.GetBytes("asInvoker"))).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task StreamRequestsElevationFindsMarkersSplitAcrossReads()
    {
        var padding = new byte[8190];
        var marker = Encoding.ASCII.GetBytes("requireAdministrator");

        InstallerDetect.StreamRequestsElevation(new MemoryStream([.. padding, .. marker])).Should().BeTrue();
        await Task.CompletedTask;
    }
}

public class InstallerArgumentsTests
{
    private const string Target = @"C:\Games\My Game";

    [Test]
    public async Task SilentInstallersKeepTheirAutomationFlagsAndDestination()
    {
        InstallerArguments.Build(InstallerType.InnoSetup, Target, false)
            .Should().Equal("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NOSOUND", $"/DIR={Target}");
        InstallerArguments.Build(InstallerType.Nsis, Target, false).Should().Equal("/S", $"/D={Target}");
        InstallerArguments.Build(InstallerType.Msi, Target, false).Should().Equal("/qn", $"TARGETDIR={Target}");
        await Task.CompletedTask;
    }

    [Test]
    public async Task InteractiveWizardsReceiveDestinationWithoutSilentFlags()
    {
        InstallerArguments.Build(InstallerType.GogInnoSetup, Target, true).Should().Equal($"/DIR={Target}");
        await Task.CompletedTask;
    }

    [Test]
    public async Task UnknownInstallersReceiveNoGuessedArguments()
    {
        InstallerArguments.Build(InstallerType.Unknown, Target, false).Should().BeEmpty();
        await Task.CompletedTask;
    }

    [Test]
    public async Task InnoDestinationWithSpacesIsQuotedAsOneArgument()
    {
        var args = InstallerArguments.Build(InstallerType.InnoSetup, Target, true);

        InstallerArguments.WindowsArgumentLine(InstallerType.InnoSetup, args).Should().Be($"\"/DIR={Target}\"");
        await Task.CompletedTask;
    }

    [Test]
    public async Task NsisDestinationWithSpacesIsUnquotedAndLast()
    {
        var args = InstallerArguments.Build(InstallerType.Nsis, Target, false);

        InstallerArguments.WindowsArgumentLine(InstallerType.Nsis, args).Should().Be($"/S /D={Target}");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ElevatedMsiArgumentsPreservePackageAndDestinationPaths()
    {
        var args = InstallerArguments.Build(InstallerType.Msi, Target, true);
        args.InsertRange(0, ["/i", @"C:\dl\My Game.msi"]);

        InstallerArguments.WindowsArgumentLine(InstallerType.Msi, args)
            .Should().Be($"/i \"C:\\dl\\My Game.msi\" \"TARGETDIR={Target}\"");
        await Task.CompletedTask;
    }

    [Test]
    public async Task QuotingEscapesEmbeddedQuotesAndTrailingBackslashes()
    {
        InstallerArguments.QuoteWindowsArgument("a\"b").Should().Be("\"a\\\"b\"");
        InstallerArguments.QuoteWindowsArgument(@"dir with space\").Should().Be("\"dir with space\\\\\"");
        InstallerArguments.QuoteWindowsArgument("").Should().Be("\"\"");
        await Task.CompletedTask;
    }
}

public class InstallerRetryTests
{
    private static InstallerAttemptConfig Start(bool interactive = false) => new(interactive, false, false);

    [Test]
    public async Task RunInstallerWithRetriesRestartsInteractivelyAfterSilentFailure()
    {
        var attempts = new List<InstallerAttemptConfig>();
        var restarts = 0;

        InstallerRetry.Run(
            Start(),
            attempt =>
            {
                attempts.Add(attempt);
                if (!attempt.ForceInteractive)
                {
                    throw new RunInstallerException(RunInstallerOutcome.Failed, "silent failed");
                }
            },
            () => restarts++,
            () => false);

        attempts.Select(attempt => attempt.ForceInteractive).Should().Equal(false, true);
        restarts.Should().Be(1);
        await Task.CompletedTask;
    }

    [Test]
    public async Task InteractiveFailureIsReturnedWithoutRetry()
    {
        var run = () => InstallerRetry.Run(
            Start(interactive: true),
            _ => throw new RunInstallerException(RunInstallerOutcome.Failed, "boom"),
            () => { },
            () => false);

        run.Should().Throw<CommandException>().WithMessage("boom");
        await Task.CompletedTask;
    }

    [Test]
    public async Task CancelledReportsInstallCancelled()
    {
        var run = () => InstallerRetry.Run(
            Start(),
            _ => throw new RunInstallerException(RunInstallerOutcome.Cancelled),
            () => { },
            () => false);

        run.Should().Throw<CommandException>().WithMessage("Install cancelled.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ElevationRequiredRetriesAsAdministratorWhenConfirmed()
    {
        var attempts = new List<InstallerAttemptConfig>();

        InstallerRetry.Run(
            new InstallerAttemptConfig(false, false, true),
            attempt =>
            {
                attempts.Add(attempt);
                if (!attempt.RunAsAdministrator)
                {
                    throw new RunInstallerException(RunInstallerOutcome.RequiresAdministrator);
                }
            },
            () => { },
            () => true);

        attempts.Last().Should().Be(new InstallerAttemptConfig(false, true, false));
        await Task.CompletedTask;
    }

    [Test]
    public async Task ElevationRequiredCancelsWhenDeclined()
    {
        var run = () => InstallerRetry.Run(
            Start(),
            _ => throw new RunInstallerException(RunInstallerOutcome.RequiresAdministrator),
            () => { },
            () => false);

        run.Should().Throw<CommandException>().WithMessage("Install cancelled.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task RestartRequestSwitchesToInteractiveMode()
    {
        var modes = new List<bool>();

        InstallerRetry.Run(
            Start(),
            attempt =>
            {
                modes.Add(attempt.ForceInteractive);
                if (modes.Count == 1)
                {
                    throw new RunInstallerException(RunInstallerOutcome.RestartInteractiveRequested);
                }
            },
            () => { },
            () => false);

        modes.Should().Equal(false, true);
        await Task.CompletedTask;
    }

    [Test]
    public async Task InstallerAttemptConfigForcesRunAsInvokerOnlyWhenElevationIsRequestedWithoutAdmin()
    {
        InstallerAttemptConfig.Create(false, false, true).ForceRunAsInvoker.Should().BeTrue();
        InstallerAttemptConfig.Create(false, true, true).ForceRunAsInvoker.Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExpandProcessTreeFindsDescendantsAcrossMultipleLevels()
    {
        var entries = new List<(uint, uint)> { (2, 1), (3, 2), (4, 3), (9, 8) };

        ProcessTree.Expand(entries, [1]).Should().BeEquivalentTo<uint>([1, 2, 3, 4]);
        ProcessTree.IsInstallerLeftover("setup.TMP").Should().BeTrue();
        await Task.CompletedTask;
    }

    [Test]
    public async Task CleanupFailedInstallerStateRemovesTargetAndStagingDirs()
    {
        using var data = new TestDataDir();
        var target = data.Child("target");
        var staging = data.Child("staging");
        File.WriteAllText(Path.Combine(target, "a"), "x");

        InstallerCleanup.CleanupDirectory(target, "partial install directory");
        InstallerCleanup.CleanupDirectory(staging, "installer staging directory");

        Directory.Exists(target).Should().BeFalse();
        Directory.Exists(staging).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ScenePackOverridesAreCopiedOverTheInstall()
    {
        using var data = new TestDataDir();
        var source = data.Child("disc");
        Directory.CreateDirectory(Path.Combine(source, "Codex", "bin"));
        File.WriteAllText(Path.Combine(source, "Codex", "bin", "patched.dll"), "patched");
        Directory.CreateDirectory(Path.Combine(source, "Extras"));
        File.WriteAllText(Path.Combine(source, "Extras", "ignored.txt"), "x");
        var target = data.Child("target");

        SceneOverrides.Apply(source, target);

        File.Exists(Path.Combine(target, "bin", "patched.dll")).Should().BeTrue();
        File.Exists(Path.Combine(target, "ignored.txt")).Should().BeFalse();
        await Task.CompletedTask;
    }
}
