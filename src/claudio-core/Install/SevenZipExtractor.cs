using System.Diagnostics;
using System.Text;

namespace Claudio.Core.Install;

internal static class SevenZipExtractor
{
    public static string BinaryPath(string resourceDir) =>
        Path.Combine(resourceDir, "7-zip", OperatingSystem.IsWindows() ? "7za.exe" : "7zzs");

    public static void Extract(string source, string destination, InstallControl control, string resourceDir, Action<double> progress)
    {
        var binary = BinaryPath(resourceDir);
        if (!File.Exists(binary))
        {
            Logging.Log.Error("claudio_core", $"[installer] 7-Zip binary not found at {binary}");
            throw new CommandException($"7-Zip was not found at {binary}. Reinstall Claudio to restore it.");
        }

        try
        {
            Directory.CreateDirectory(destination);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            FileOps.LogIoFailure("create 7z extraction destination", destination, error);
            throw new CommandException(FileOps.FormatInstallIoError("create the 7z extraction destination", destination, error));
        }

        var info = new ProcessStartInfo(binary)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in new[] { "x", "-y", "-aoa", "-bsp1", "-bso0", "-bse2", "-sccUTF-8", $"-o{destination}", source })
        {
            info.ArgumentList.Add(argument);
        }

        using var process = StartProcess(info, binary);
        process.StandardInput.Close();
        var errors = new StringBuilder();
        var errorReader = Task.Run(() =>
        {
            string? line;
            while ((line = process.StandardError.ReadLine()) is not null)
            {
                errors.AppendLine(line);
            }
        });
        var outputReader = Task.Run(() => ReadProgress(process, progress));

        while (!process.WaitForExit(100))
        {
            if (control.IsCancelled)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit();
                throw new CommandException("Install cancelled.");
            }
        }

        process.WaitForExit();
        outputReader.Wait();
        errorReader.Wait();

        if (control.IsCancelled)
        {
            throw new CommandException("Install cancelled.");
        }

        if (process.ExitCode != 0)
        {
            var detail = errors.ToString().Trim();
            Logging.Log.Error("claudio_core", $"[installer] extract 7z archive failed for {source} into {destination}: exit {process.ExitCode}: {detail}");
            throw new CommandException($"Failed to extract 7z archive {source}: 7-Zip exited with code {process.ExitCode}. {detail}".TrimEnd());
        }

        progress(1.0);
    }

    private static Process StartProcess(ProcessStartInfo info, string binary)
    {
        try
        {
            return Process.Start(info) ?? throw new CommandException($"Failed to start 7-Zip at {binary}.");
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new CommandException($"Failed to start 7-Zip at {binary}: {error.Message}");
        }
    }

    private static void ReadProgress(Process process, Action<double> progress)
    {
        var digits = new StringBuilder();
        var lastReport = Stopwatch.StartNew();
        int next;
        while ((next = process.StandardOutput.Read()) >= 0)
        {
            var ch = (char)next;
            if (char.IsAsciiDigit(ch))
            {
                digits.Append(ch);
            }
            else if (ch == '%' && digits.Length > 0 && int.TryParse(digits.ToString(), out var percent))
            {
                digits.Clear();
                if (lastReport.ElapsedMilliseconds > 100)
                {
                    progress(Math.Clamp(percent, 0, 100) / 100.0);
                    lastReport.Restart();
                }
            }
            else
            {
                digits.Clear();
            }
        }
    }
}
