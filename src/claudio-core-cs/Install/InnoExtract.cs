using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Claudio.Core.Logging;

namespace Claudio.Core.Install;

internal static class InnoExtract
{
    public static void Run(string installer, string targetDir)
    {
        Log.Info("claudio_core", $"Running innoextract for {installer}");
        var binary = Ensure();
        Log.Info("claudio_core", $"Using innoextract binary: {binary}");
        RunWithBinary(binary, installer, targetDir);
    }

    public static void RunWithBinary(string binary, string installer, string targetDir)
    {
        var info = new ProcessStartInfo(binary)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in new[] { "-d", targetDir, "--gog", installer })
        {
            info.ArgumentList.Add(argument);
        }

        int exitCode;
        try
        {
            using var process = Process.Start(info) ?? throw new CommandException("Failed to run innoextract: process did not start");
            process.StandardInput.Close();
            var output = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            process.WaitForExit();
            Task.WaitAll(output, errors);
            exitCode = process.ExitCode;
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new CommandException($"Failed to run innoextract: {error.Message}");
        }

        if (exitCode != 0)
        {
            throw new CommandException($"innoextract exited with status exit code: {exitCode}.");
        }

        Log.Info("claudio_core", "innoextract succeeded");
        FlattenApp(targetDir);
        var tmp = Path.Combine(targetDir, "tmp");
        if (Directory.Exists(tmp))
        {
            FileOps.TryDeleteTree(tmp);
        }
    }

    private static void FlattenApp(string targetDir)
    {
        var app = Path.Combine(targetDir, "app");
        if (!Directory.Exists(app))
        {
            return;
        }

        foreach (var entry in Directory.EnumerateFileSystemEntries(app).ToList())
        {
            var destination = Path.Combine(targetDir, Path.GetFileName(entry));
            try
            {
                if (Directory.Exists(entry))
                {
                    Directory.Move(entry, destination);
                }
                else
                {
                    File.Move(entry, destination);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new CommandException(FileOps.FormatInstallIoErrorPair("move extracted files", entry, destination, error));
            }
        }

        FileOps.TryDeleteTree(app);
    }

    public static string CachePath() => Path.Combine(SettingsStore.ToolsDir(), "innoextract.exe");

    private static string Ensure()
    {
        if (Responds("innoextract"))
        {
            return "innoextract";
        }

        var cached = CachePath();
        if (File.Exists(cached))
        {
            Log.Info("claudio_core", $"Using cached innoextract: {cached}");
            return cached;
        }

        Log.Info("claudio_core", "innoextract not found, downloading from GitHub releases");
        Download(cached);
        Log.Info("claudio_core", $"innoextract downloaded to {cached}");
        return cached;
    }

    private static bool Responds(string command)
    {
        try
        {
            var info = new ProcessStartInfo(command, "--version")
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(info);
            if (process is null)
            {
                return false;
            }

            process.StandardInput.Close();
            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit();
            return process.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private static void Download(string target)
    {
        using var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Claudio/1.0");
        try
        {
            using var release = JsonDocument.Parse(
                client.GetStringAsync("https://api.github.com/repos/dscharrer/innoextract/releases/latest").GetAwaiter().GetResult());
            var assets = release.RootElement.TryGetProperty("assets", out var array) && array.ValueKind == JsonValueKind.Array
                ? array.EnumerateArray().ToList()
                : throw new CommandException("No assets found in innoextract release");
            var url = assets
                .Where(asset => asset.TryGetProperty("name", out var name) && name.GetString() is { } text
                    && text.Contains("windows", StringComparison.Ordinal) && text.EndsWith(".zip", StringComparison.Ordinal))
                .Select(asset => asset.TryGetProperty("browser_download_url", out var link) ? link.GetString() : null)
                .FirstOrDefault(link => link is not null)
                ?? throw new CommandException("Could not find Windows innoextract release asset");

            var bytes = client.GetByteArrayAsync(url).GetAwaiter().GetResult();
            using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            var entry = archive.Entries.FirstOrDefault(candidate => candidate.FullName.EndsWith("innoextract.exe", StringComparison.Ordinal))
                ?? throw new CommandException("innoextract.exe not found in downloaded release zip");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var output = new FileStream(target, FileMode.Create, FileAccess.Write);
            using var input = entry.Open();
            input.CopyTo(output);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or InvalidDataException or IOException)
        {
            throw new CommandException($"Failed to fetch innoextract: {error.Message}");
        }
    }
}
