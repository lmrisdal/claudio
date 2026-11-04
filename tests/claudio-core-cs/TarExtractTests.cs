using System.Formats.Tar;
using AwesomeAssertions;

namespace Claudio.Core.Tests;

public class TarExtractTests
{
    private static void Extract(string archive, string destination) =>
        Install.Extract.ArchiveOrCopy(archive, destination, new InstallControl(), "/nonexistent", _ => { });

    private static string WriteTar(string path, params TarEntry[] entries)
    {
        using var file = File.Create(path);
        using var writer = new TarWriter(file, TarEntryFormat.Pax);
        foreach (var entry in entries)
        {
            writer.WriteEntry(entry);
        }

        return path;
    }

    private static PaxTarEntry RegularFile(string name, string content, UnixFileMode mode = (UnixFileMode)0x1A4)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        return new PaxTarEntry(TarEntryType.RegularFile, name) { DataStream = new MemoryStream(bytes), Mode = mode };
    }

    private static PaxTarEntry Link(TarEntryType type, string name, string target) => new(type, name) { LinkName = target };

    [Test]
    public async Task ExtractTarSkipsParentEntriesAndKeepsTheRest()
    {
        using var data = new TestDataDir();
        var output = Path.Combine(data.Root, "out");
        var archive = WriteTar(
            Path.Combine(data.Root, "a.tar"),
            RegularFile("../evil.txt", "evil"),
            RegularFile("Game/../../evil2.txt", "evil"),
            RegularFile("/Game/game.exe", "exe"));

        Extract(archive, output);

        File.ReadAllText(Path.Combine(output, "Game", "game.exe")).Should().Be("exe");
        File.Exists(Path.Combine(data.Root, "evil.txt")).Should().BeFalse();
        File.Exists(Path.Combine(data.Root, "evil2.txt")).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractTarKeepsAbsoluteSymlinkTargets()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        using var data = new TestDataDir();
        var output = Path.Combine(data.Root, "out");
        var archive = WriteTar(
            Path.Combine(data.Root, "a.tar"),
            Link(TarEntryType.SymbolicLink, "Game/lib/libfoo.so", "/usr/lib/libfoo.so"),
            Link(TarEntryType.SymbolicLink, "Game/current", "lib"),
            RegularFile("Game/game.exe", "exe"));

        Extract(archive, output);

        new FileInfo(Path.Combine(output, "Game", "lib", "libfoo.so")).LinkTarget.Should().Be("/usr/lib/libfoo.so");
        new FileInfo(Path.Combine(output, "Game", "current")).LinkTarget.Should().Be("lib");
        File.ReadAllText(Path.Combine(output, "Game", "game.exe")).Should().Be("exe");
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractTarRefusesToWriteThroughALinkOutsideTheDestination()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        using var data = new TestDataDir();
        var outside = data.Child("outside");
        var output = Path.Combine(data.Root, "out");
        var archive = WriteTar(
            Path.Combine(data.Root, "a.tar"),
            Link(TarEntryType.SymbolicLink, "escape", outside),
            RegularFile("escape/planted.txt", "evil"));

        var act = () => Extract(archive, output);

        act.Should().Throw<CommandException>().WithMessage("trying to unpack outside of destination path*");
        File.Exists(Path.Combine(outside, "planted.txt")).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractTarRefusesHardLinksOutsideTheDestination()
    {
        using var data = new TestDataDir();
        var secret = Path.Combine(data.Child("outside"), "secret.txt");
        File.WriteAllText(secret, "secret");
        var output = Path.Combine(data.Root, "out");
        var archive = WriteTar(
            Path.Combine(data.Root, "a.tar"),
            Link(TarEntryType.HardLink, "copy.txt", "../outside/secret.txt"));

        var act = () => Extract(archive, output);

        act.Should().Throw<CommandException>();
        File.Exists(Path.Combine(output, "copy.txt")).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Test]
    public async Task ExtractTarKeepsExecutableBitsAndHardLinkContents()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        using var data = new TestDataDir();
        var output = Path.Combine(data.Root, "out");
        var archive = WriteTar(
            Path.Combine(data.Root, "a.tar"),
            RegularFile("Game/start.sh", "#!/bin/sh", (UnixFileMode)0x1ED),
            Link(TarEntryType.HardLink, "Game/start-copy.sh", "Game/start.sh"));

        Extract(archive, output);

        (File.GetUnixFileMode(Path.Combine(output, "Game", "start.sh")) & UnixFileMode.UserExecute).Should().Be(UnixFileMode.UserExecute);
        File.ReadAllText(Path.Combine(output, "Game", "start-copy.sh")).Should().Be("#!/bin/sh");
        await Task.CompletedTask;
    }

    [Test]
    public async Task RelativePathFollowsTarCrateRules()
    {
        Install.TarExtract.RelativePath("./a//b/./c").Should().Be(Path.Combine("a", "b", "c"));
        Install.TarExtract.RelativePath("/abs/file").Should().Be(Path.Combine("abs", "file"));
        Install.TarExtract.RelativePath("a/../b").Should().BeNull();
        Install.TarExtract.RelativePath("./").Should().BeNull();
        await Task.CompletedTask;
    }
}
