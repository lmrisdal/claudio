using System.Globalization;
using System.Text;

namespace Claudio.Core.Logging;

internal enum LogLevel
{
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

internal static class Log
{
    public const long MaxLogBytes = 10L * 1024 * 1024;

    private static readonly object Gate = new();
    private static FileStream? file;
    private static string path = "";
    private static string rotatedPath = "";
    private static long maxBytes = MaxLogBytes;
    private static LogLevel level = LogLevel.Info;
    private static bool mirrorToStderr = true;

    public static void Init(string dir, LogLevel filter, long maxLogBytes = MaxLogBytes, bool mirror = true)
    {
        lock (Gate)
        {
            file?.Dispose();
            path = Path.Combine(dir, "claudio.log");
            rotatedPath = Path.Combine(dir, "claudio.old.log");
            level = filter;
            maxBytes = maxLogBytes;
            mirrorToStderr = mirror;
            file = Open();
        }
    }

    public static void Shutdown()
    {
        lock (Gate)
        {
            file?.Dispose();
            file = null;
        }
    }

    public static LogLevel ParseLevel(string value) =>
        value switch
        {
            "error" => LogLevel.Error,
            "warn" => LogLevel.Warn,
            "debug" => LogLevel.Debug,
            "trace" => LogLevel.Trace,
            _ => LogLevel.Info,
        };

    public static void Error(string target, string message) => Write(LogLevel.Error, target, message);

    public static void Warn(string target, string message) => Write(LogLevel.Warn, target, message);

    public static void Info(string target, string message) => Write(LogLevel.Info, target, message);

    public static void Debug(string target, string message) => Write(LogLevel.Debug, target, message);

    public static void Write(LogLevel messageLevel, string target, string message)
    {
        if (messageLevel > level)
        {
            return;
        }

        var line = $"[{FormatTimestamp(DateTime.UtcNow)}][{messageLevel.ToString().ToUpperInvariant()}][{target}] {message}\n";
        lock (Gate)
        {
            Append(line);
            if (mirrorToStderr)
            {
                using var stderr = Console.OpenStandardError();
                var bytes = Encoding.UTF8.GetBytes(line);
                stderr.Write(bytes);
            }
        }
    }

    public static string FormatTimestamp(DateTime utc) =>
        utc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static void Append(string line)
    {
        var bytes = Encoding.UTF8.GetBytes(line);
        if (file is { Length: > 0 } && file.Length + bytes.Length > maxBytes)
        {
            file.Dispose();
            file = null;
            TryMove();
            file = Open();
        }

        if (file is null)
        {
            return;
        }

        try
        {
            file.Write(bytes);
            file.Flush();
        }
        catch (IOException)
        {
        }
    }

    private static void TryMove()
    {
        try
        {
            File.Move(path, rotatedPath, overwrite: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static FileStream? Open()
    {
        try
        {
            return new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}
