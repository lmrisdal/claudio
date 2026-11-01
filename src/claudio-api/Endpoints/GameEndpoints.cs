using System.Formats.Tar;
using System.IO.Compression;
using System.Buffers;
using System.Globalization;
using System.Text;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SharpCompress.Archives.SevenZip;

namespace Claudio.Api.Endpoints;

public static class GameEndpoints
{
    private const int DownloadBufferSize = 256 * 1024;
    private const string BytesUnit = "bytes";
    private const long DownloadProgressLogIntervalBytes = 64L * 1024 * 1024;
    // Generous timeout for a single read from the source disk. The source is
    // often a spinning NAS drive, which under concurrent access can take many
    // seconds to return a chunk; only a truly stuck read should fail.
    private static readonly TimeSpan DownloadReadTimeout = TimeSpan.FromSeconds(120);

    public static RouteGroupBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/games")
            .WithTags("Games");

        group.MapGet("/", GetAll);
        group.MapGet("/{id:int}", GetById);
        group.MapGet("/{id:int}/executables", ListExecutables);
        group.MapGet("/{id:int}/installer-inspection", InspectInstaller);
        group.MapPost("/{id:int}/download-ticket", CreateDownloadTicket);
        group.MapGet("/{id:int}/download", Download);
        group.MapGet("/{id:int}/download-files-manifest", GetDownloadFilesManifest);
        group.MapGet("/{id:int}/download-files", DownloadFile);
        group.MapGet("/{id:int}/download-file", DownloadFile);
        group.MapGet("/{id:int}/browse", BrowseGameFiles);
        group.MapGet("/{id:int}/emulation", GetEmulationInfo);
        group.MapPost("/{id:int}/emulation/session", CreateEmulationSession);
        group.MapMethods("/{id:int}/emulation/files/{ticket}/{**path}", ["GET", "HEAD"], GetEmulationFile);

        return group;
    }

    private static async Task<IResult> GetAll(
        AppDbContext db,
        [FromQuery] string? platform,
        [FromQuery] string? search)
    {
        var query = db.Games.AsQueryable();

        if (!string.IsNullOrWhiteSpace(platform))
            query = query.Where(g => g.Platform == platform);

        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(g => EF.Functions.Like(g.Title, $"%{search}%"));

        var games = await query.OrderBy(g => g.Title).Select(g => ToDto(g)).ToListAsync();
        return Results.Ok(games);
    }

    private static async Task<IResult> GetById(int id, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        return Results.Ok(ToDto(game));
    }

    private static async Task<IResult> ListExecutables(int id, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (!ExistsOnDisk(game))
            return Results.Ok(Array.Empty<string>());

        return Results.Ok(ListGameExecutables(game));
    }

    private static async Task<IResult> InspectInstaller(int id, [FromQuery] string? path, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (!ExistsOnDisk(game))
            return Results.Problem("Game folder not found on disk.", statusCode: 404);

        var normalizedPath = NormalizeRelativePath(path ?? string.Empty);
        if (normalizedPath is null)
            return Results.BadRequest("Invalid installer path.");

        if (!TryOpenGameEntryStream(game, normalizedPath, out var stream))
            return Results.NotFound();

        using (stream)
        {
            var extension = Path.GetExtension(normalizedPath).ToLowerInvariant();
            var requestsElevation = extension == ".exe" && StreamContainsEmbeddedElevationRequest(stream);
            return Results.Ok(new InstallerInspectionResponse(
                InstallerType: extension switch
                {
                    ".exe" => "exe",
                    ".msi" => "msi",
                    _ => "unknown",
                },
                RequestsElevation: requestsElevation,
                CanPatchCopyForNonAdmin: extension == ".exe" && requestsElevation));
        }
    }

    private static async Task<IResult> CreateDownloadTicket(int id, AppDbContext db, DownloadTicketService ticketService)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (game.IsProcessing) return Results.Conflict("Game is currently being processed.");

        if (!ExistsOnDisk(game))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        var ticket = ticketService.CreateTicket(id);

        // Legacy browser flow keeps ticket response shape. Desktop can use
        // /download-files-manifest and /download-files endpoints without tickets.
        var files = BuildLooseFileManifest(game);

        return Results.Ok(new { ticket, files });
    }

    public record DownloadFileManifestEntry(string Path, long Size);

    private static async Task<IResult> GetDownloadFilesManifest(int id, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (game.IsProcessing) return Results.Conflict("Game is currently being processed.");

        if (!ExistsOnDisk(game))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        var files = BuildLooseFileManifest(game);
        return Results.Ok(new { files });
    }

    private static async Task<IResult> Download(
        int id,
        [FromQuery] string? ticket,
        AppDbContext db,
        DownloadService downloadService,
        DownloadTicketService ticketService)
    {
        if (ticket is not null && !ticketService.TryRedeem(ticket, id))
            return Results.Unauthorized();

        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        if (!ExistsOnDisk(game))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        // Standalone archive file — serve it directly
        if (IsStandaloneArchive(game))
        {
            var ext = System.IO.Path.GetExtension(game.FolderPath).ToLowerInvariant();
            var contentType = ext == ".iso" ? "application/x-iso9660-image" : ArchiveContentType(ext);
            var fileName = $"{game.Title}{ext}";
            return StreamPhysicalFile(
                game.FolderPath,
                contentType,
                fileName);
        }

        // If the folder contains a single archive, serve it directly
        var singleArchive = FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
        {
            var ext = System.IO.Path.GetExtension(singleArchive).ToLowerInvariant();
            var contentType = ArchiveContentType(ext);
            var fileName = ext is ".zip" or ".7z" ? $"{game.Title}{ext}" : $"{game.Title}.tar";
            return StreamPhysicalFile(
                singleArchive,
                contentType,
                fileName);
        }

        // Create tar on the fly and serve it
        var tarPath = await downloadService.CreateTarAsync(game);

        return StreamPhysicalFile(
            tarPath,
            "application/x-tar",
            $"{game.Title}.tar");
    }

    private static async Task<IResult> DownloadFile(
        int id,
        [FromQuery] string path,
        AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        var normalizedPath = NormalizeRelativePath(path);
        if (normalizedPath is null)
            return Results.BadRequest("Invalid file path.");

        if (!TryResolveGameFilePath(game, normalizedPath, out var fullPath))
            return Results.NotFound();

        return StreamPhysicalFile(fullPath, "application/octet-stream");
    }

    private static string ArchiveContentType(string extension) => extension switch
    {
        ".zip" => "application/zip",
        ".7z" => "application/x-7z-compressed",
        _ => "application/x-tar",
    };

    private static List<DownloadFileManifestEntry>? BuildLooseFileManifest(Game game)
    {
        // Standalone archives and single-archive folders are served through /download.
        if (IsStandaloneArchive(game) || !Directory.Exists(game.FolderPath) || FindSingleArchive(game.FolderPath) is not null)
            return null;

        return Directory.GetFiles(game.FolderPath, "*", SearchOption.AllDirectories)
            .Where(f => !Path.GetRelativePath(game.FolderPath, f)
                .Split(Path.DirectorySeparatorChar)
                .Any(segment => HiddenNames.Contains(segment)))
            .Select(f =>
            {
                var rel = Path.GetRelativePath(game.FolderPath, f).Replace('\\', '/');
                var size = new FileInfo(f).Length;
                return new DownloadFileManifestEntry(rel, size);
            })
            .OrderBy(e => e.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static GameDto ToDto(Game game) => new()
    {
        Id = game.Id,
        Title = game.Title,
        Platform = game.Platform,
        FolderName = game.FolderName,
        InstallType = game.InstallType,
        Summary = game.Summary,
        Genre = game.Genre,
        ReleaseYear = game.ReleaseYear,
        CoverUrl = game.CoverUrl,
        HeroUrl = game.HeroUrl,
        IgdbId = game.IgdbId,
        IgdbSlug = game.IgdbSlug,
        SizeBytes = game.SizeBytes,
        IsMissing = game.IsMissing,
        InstallerExe = game.InstallerExe,
        GameExe = game.GameExe,
        Developer = game.Developer,
        Publisher = game.Publisher,
        GameMode = game.GameMode,
        Series = game.Series,
        Franchise = game.Franchise,
        GameEngine = game.GameEngine,
        IsProcessing = game.IsProcessing,
        IsArchive = IsStandaloneArchive(game) || (Directory.Exists(game.FolderPath) && FindSingleArchive(game.FolderPath) is not null),
    };

    // Older games often ship upper-case names like RUN.BAT, and globbing is case-sensitive on Linux.
    private static readonly EnumerationOptions ExecutableSearchOptions = new()
    {
        RecurseSubdirectories = true,
        MatchCasing = MatchCasing.CaseInsensitive,
        AttributesToSkip = 0,
        IgnoreInaccessible = false,
    };

    internal static List<string> ListGameExecutables(Game game)
    {
        var exes = new List<string>();
        string[] extensions = [".exe", ".bat", ".iso"];

        var archivePath = IsStandaloneArchive(game)
            ? game.FolderPath
            : FindSingleArchive(game.FolderPath);
        if (archivePath is not null)
        {
            foreach (var (name, _) in ReadArchiveEntries(archivePath))
            {
                if (extensions.Any(ext => name.EndsWith(ext, StringComparison.OrdinalIgnoreCase)))
                    exes.Add(name);
            }
        }
        else
        {
            foreach (var ext in extensions)
            {
                exes.AddRange(
                    Directory.GetFiles(game.FolderPath, $"*{ext}", ExecutableSearchOptions)
                        .Select(f => Path.GetRelativePath(game.FolderPath, f).Replace('\\', '/')));
            }
        }

        return exes.OrderBy(f => f).ToList();
    }

    public record EmulationInfoResponse(
        bool Supported,
        string? Core,
        bool RequiresThreads,
        string? Reason,
        string? PreferredPath,
        List<string> Candidates);

    public record EmulationSessionRequest(string Path);
    public record EmulationSessionResponse(string Ticket, string GameUrl);

    public record BrowseEntry(string Name, bool IsDirectory, long? Size);
    public record BrowseResult(string Path, bool InsideArchive, List<BrowseEntry> Entries);

    internal static readonly HashSet<string> HiddenNames = new(StringComparer.OrdinalIgnoreCase)
        { "__MACOSX", ".DS_Store", "@eaDir", "#recycle", "Thumbs.db", ".claudio" };

    private static readonly string[] ArchiveExtensions = [".zip", ".7z", ".tar", ".tar.gz", ".tgz", ".iso"];

    private static readonly Dictionary<string, EmulationPlatformDefinition> EmulationPlatforms =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["gb"] = new("gb", false, [".gb", ".gbc", ".zip"], [".gbc", ".gb", ".zip"]),
            ["gbc"] = new("gb", false, [".gbc", ".gb", ".zip"], [".gbc", ".gb", ".zip"]),
            ["gba"] = new("gba", false, [".gba", ".zip"], [".gba", ".zip"]),
            ["nes"] = new("nes", false, [".nes", ".fds", ".unf", ".unif", ".zip"], [".nes", ".fds", ".unif", ".unf", ".zip"]),
            ["snes"] = new("snes", false, [".sfc", ".smc", ".fig", ".bs", ".st", ".zip"], [".sfc", ".smc", ".fig", ".bs", ".st", ".zip"]),
            ["n64"] = new("n64", false, [".z64", ".n64", ".v64", ".zip"], [".z64", ".n64", ".v64", ".zip"]),
            ["ds"] = new("nds", false, [".nds", ".zip"], [".nds", ".zip"]),
            ["ps1"] = new("psx", false, [".chd", ".cue", ".pbp", ".m3u", ".ccd", ".iso", ".bin", ".zip"], [".chd", ".cue", ".pbp", ".m3u", ".ccd", ".iso", ".zip", ".bin"]),
            ["psp"] = new("psp", true, [".iso", ".cso", ".pbp", ".zip"], [".iso", ".cso", ".pbp", ".zip"]),
            ["genesis"] = new("segaMD", false, [".md", ".gen", ".bin", ".smd", ".zip"], [".md", ".gen", ".bin", ".smd", ".zip"]),
            ["saturn"] = new("segaSaturn", false, [".chd", ".cue", ".m3u", ".iso", ".zip"], [".chd", ".cue", ".m3u", ".iso", ".zip"]),
        };

    private sealed record EmulationPlatformDefinition(
        string Core,
        bool RequiresThreads,
        string[] Extensions,
        string[] PreferredExtensions);

    internal static bool IsArchiveFile(string path)
    {
        var lower = path.ToLowerInvariant();
        return ArchiveExtensions.Any(ext => lower.EndsWith(ext));
    }

    /// Returns true if the game's FolderPath exists on disk (either as a directory or a standalone archive file).
    internal static bool ExistsOnDisk(Game game)
        => Directory.Exists(game.FolderPath) || File.Exists(game.FolderPath);

    /// Returns true if the game is a standalone archive file (not a folder).
    internal static bool IsStandaloneArchive(Game game)
        => File.Exists(game.FolderPath) && IsArchiveFile(game.FolderPath);

    internal static string? FindSingleArchive(string folderPath)
    {
        var dirs = Directory.GetDirectories(folderPath);
        if (dirs.Length > 0) return null;
        var files = Directory.GetFiles(folderPath);
        var archives = files.Where(f => IsArchiveFile(f)).ToArray();
        return archives.Length == 1 ? archives[0] : null;
    }

    private static async Task<IResult> GetEmulationInfo(int id, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        var info = BuildEmulationInfo(game);
        return Results.Ok(info);
    }

    private static async Task<IResult> CreateEmulationSession(
        int id,
        EmulationSessionRequest request,
        AppDbContext db,
        EmulationTicketService ticketService)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        var info = BuildEmulationInfo(game);
        if (!info.Supported || string.IsNullOrWhiteSpace(info.Core))
            return Results.BadRequest(info.Reason ?? "This game cannot be emulated in the browser.");

        if (!info.Candidates.Contains(request.Path, StringComparer.OrdinalIgnoreCase))
            return Results.BadRequest("Invalid ROM path.");

        var ticket = ticketService.CreateTicket(id);
        var encodedSegments = request.Path
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.EscapeDataString);
        var gameUrl = $"/api/games/{id}/emulation/files/{Uri.EscapeDataString(ticket)}/{string.Join("/", encodedSegments)}";

        return Results.Ok(new EmulationSessionResponse(ticket, gameUrl));
    }

    private static async Task<IResult> GetEmulationFile(
        int id,
        string ticket,
        string path,
        AppDbContext db,
        EmulationTicketService ticketService)
    {
        if (!ticketService.IsValid(ticket, id))
            return Results.Unauthorized();

        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        var info = BuildEmulationInfo(game);
        if (!info.Supported)
            return Results.BadRequest(info.Reason ?? "This game cannot be emulated in the browser.");

        var normalizedPath = NormalizeRelativePath(path);
        if (normalizedPath is null)
            return Results.BadRequest("Invalid path.");

        if (!TryResolveGameFilePath(game, normalizedPath, out var fullPath))
            return Results.NotFound();

        return StreamPhysicalFile(fullPath, "application/octet-stream");
    }

    private static IResult StreamPhysicalFile(string path, string contentType, string? fileDownloadName = null)
        => new StreamingPhysicalFileResult(path, contentType, fileDownloadName);

    private sealed class StreamingPhysicalFileResult(string path, string contentType, string? fileDownloadName) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var logger = httpContext.RequestServices
                .GetRequiredService<ILoggerFactory>()
                .CreateLogger("GameDownload");
            var fileInfo = new FileInfo(path);
            if (!fileInfo.Exists)
            {
                httpContext.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }

            var length = fileInfo.Length;
            var rangeHeader = httpContext.Request.Headers.Range.ToString();
            var range = ParseRange(rangeHeader, length);
            if (range.Invalid)
            {
                httpContext.Response.StatusCode = StatusCodes.Status416RangeNotSatisfiable;
                httpContext.Response.Headers.ContentRange = $"{BytesUnit} */{length}";
                return;
            }

            var start = range.Start ?? 0;
            var end = range.End ?? Math.Max(length - 1, 0);
            var contentLength = length == 0 ? 0 : end - start + 1;

            httpContext.Response.StatusCode = range.Requested
                ? StatusCodes.Status206PartialContent
                : StatusCodes.Status200OK;
            httpContext.Response.ContentType = contentType;
            httpContext.Response.ContentLength = contentLength;
            httpContext.Response.Headers.AcceptRanges = BytesUnit;
            httpContext.Response.Headers.LastModified = fileInfo.LastWriteTimeUtc.ToString("R", CultureInfo.InvariantCulture);

            if (range.Requested)
                httpContext.Response.Headers.ContentRange = $"{BytesUnit} {start}-{end}/{length}";

            if (!string.IsNullOrWhiteSpace(fileDownloadName))
                httpContext.Response.Headers.ContentDisposition = BuildContentDisposition(fileDownloadName);

            if (HttpMethods.IsHead(httpContext.Request.Method) || contentLength == 0)
                return;

            try
            {
                logger.LogInformation(
                    "Download started: {Path} ({Start}-{End}/{Length})",
                    path,
                    start,
                    end,
                    length);
                httpContext.Response.HttpContext.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()?.DisableBuffering();

                await using var stream = new FileStream(path, new FileStreamOptions
                {
                    Mode = FileMode.Open,
                    Access = FileAccess.Read,
                    Share = FileShare.Read,
                    BufferSize = DownloadBufferSize,
                    Options = FileOptions.Asynchronous | FileOptions.RandomAccess,
                });

                stream.Seek(start, SeekOrigin.Begin);
                var copied = await CopyExactBytesAsync(
                    stream,
                    httpContext.Response.Body,
                    contentLength,
                    httpContext.RequestAborted,
                    bytesCopied => logger.LogInformation(
                        "Download progress: {Path} {BytesCopied}/{ContentLength} bytes",
                        path,
                        bytesCopied,
                        contentLength));

                logger.LogInformation(
                    "Download finished: {Path} {BytesCopied}/{ContentLength} bytes",
                    path,
                    copied,
                    contentLength);
            }
            catch (OperationCanceledException)
            {
                logger.LogInformation("Download cancelled by client: {Path}", path);
            }
            catch (IOException ex)
            {
                logger.LogWarning(ex, "Download failed due to I/O error: {Path}", path);
            }
            catch (TimeoutException ex)
            {
                logger.LogWarning(ex, "Download timed out waiting for a read from the source: {Path}", path);
                httpContext.Abort();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Download failed unexpectedly: {Path}", path);
                if (!httpContext.Response.HasStarted)
                    httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
            }
        }

        private static async Task<long> CopyExactBytesAsync(
            Stream source,
            Stream destination,
            long bytesToCopy,
            CancellationToken cancellationToken,
            Action<long> onProgress)
        {
            var buffer = ArrayPool<byte>.Shared.Rent(DownloadBufferSize);
            try
            {
                var remaining = bytesToCopy;
                var copied = 0L;
                var nextProgressAt = Math.Min(DownloadProgressLogIntervalBytes, bytesToCopy);
                while (remaining > 0)
                {
                    var readSize = (int)Math.Min(buffer.Length, remaining);
                    var read = await source
                        .ReadAsync(buffer.AsMemory(0, readSize), cancellationToken)
                        .AsTask()
                        .WaitAsync(DownloadReadTimeout, cancellationToken);
                    if (read == 0)
                        break;

                    // No timeout on the write to the client: a momentarily slow
                    // client must not abort the whole transfer. Kestrel's own
                    // (disabled) minimum data rate and the request cancellation
                    // token are the only things that end a stalled write.
                    await destination
                        .WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    remaining -= read;
                    copied += read;

                    if (copied >= nextProgressAt && copied < bytesToCopy)
                    {
                        onProgress(copied);
                        nextProgressAt += DownloadProgressLogIntervalBytes;
                    }
                }

                return copied;
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }
        }

        private static DownloadRange ParseRange(string rangeHeader, long length)
        {
            if (string.IsNullOrWhiteSpace(rangeHeader))
                return DownloadRange.NotRequested;

            if (!rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
                return DownloadRange.InvalidRange;

            var rangeValue = rangeHeader["bytes=".Length..].Trim();
            if (rangeValue.Contains(','))
                return DownloadRange.InvalidRange;

            var parts = rangeValue.Split('-', 2);
            if (parts.Length != 2)
                return DownloadRange.InvalidRange;

            if (parts[0].Length == 0)
            {
                if (!long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var suffixLength) || suffixLength <= 0)
                    return DownloadRange.InvalidRange;

                if (length == 0)
                    return DownloadRange.InvalidRange;

                var suffixStart = Math.Max(length - suffixLength, 0);
                return new DownloadRange(true, false, suffixStart, length - 1);
            }

            if (!long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var start) || start < 0)
                return DownloadRange.InvalidRange;

            var end = length - 1;
            if (parts[1].Length > 0 &&
                (!long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out end) || end < start))
                return DownloadRange.InvalidRange;

            if (length == 0 || start >= length)
                return DownloadRange.InvalidRange;

            return new DownloadRange(true, false, start, Math.Min(end, length - 1));
        }

        private static string BuildContentDisposition(string fileName)
        {
            var asciiName = fileName
                .Replace("\\", "_", StringComparison.Ordinal)
                .Replace("\"", "_", StringComparison.Ordinal);
            return $"attachment; filename=\"{asciiName}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
        }

        private readonly record struct DownloadRange(bool Requested, bool Invalid, long? Start, long? End)
        {
            public static DownloadRange NotRequested { get; } = new(false, false, null, null);
            public static DownloadRange InvalidRange { get; } = new(false, true, null, null);
        }
    }

    private static EmulationInfoResponse BuildEmulationInfo(Game game)
    {
        if (!ExistsOnDisk(game))
            return new(false, null, false, "Game files are missing from disk.", null, []);

        if (!EmulationPlatforms.TryGetValue(game.Platform, out var definition))
            return new(false, null, false, $"Platform '{game.Platform}' is not mapped to an EmulatorJS core yet.", null, []);

        var candidates = FindEmulationCandidates(game, definition);
        if (candidates.Count == 0)
            return new(false, definition.Core, definition.RequiresThreads, "No supported ROM files were found for this game.", null, []);

        var preferred = candidates[0];
        return new(
            true,
            definition.Core,
            definition.RequiresThreads,
            null,
            preferred,
            candidates);
    }

    private static List<string> FindEmulationCandidates(Game game, EmulationPlatformDefinition definition)
    {
        var candidates = new List<string>();

        if (IsStandaloneArchive(game))
        {
            var ext = GetFullExtension(game.FolderPath);
            if (definition.Extensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
                candidates.Add(Path.GetFileName(game.FolderPath));
            return OrderEmulationCandidates(candidates, definition);
        }

        if (!Directory.Exists(game.FolderPath))
            return [];

        var singleArchive = FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
        {
            var ext = GetFullExtension(singleArchive);
            if (definition.Extensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
                candidates.Add(Path.GetFileName(singleArchive));
            return OrderEmulationCandidates(candidates, definition);
        }

        foreach (var file in Directory.GetFiles(game.FolderPath, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(game.FolderPath, file).Replace('\\', '/');
            if (relativePath.Split('/').Any(HiddenNames.Contains))
                continue;

            var ext = GetFullExtension(relativePath);
            if (!definition.Extensions.Contains(ext, StringComparer.OrdinalIgnoreCase))
                continue;

            candidates.Add(relativePath);
        }

        return OrderEmulationCandidates(candidates, definition);
    }

    private static List<string> OrderEmulationCandidates(
        List<string> candidates,
        EmulationPlatformDefinition definition)
    {
        return candidates
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path =>
            {
                var ext = GetFullExtension(path);
                var idx = Array.FindIndex(
                    definition.PreferredExtensions,
                    preferred => string.Equals(preferred, ext, StringComparison.OrdinalIgnoreCase));
                return idx >= 0 ? idx : int.MaxValue;
            })
            .ThenBy(path => path.Count(c => c == '/'))
            .ThenBy(path => path.Length)
            .ThenBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string GetFullExtension(string path)
    {
        var lower = path.ToLowerInvariant();
        if (lower.EndsWith(".tar.gz"))
            return ".tar.gz";
        return Path.GetExtension(lower);
    }

    private static string? NormalizeRelativePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        string decoded;
        try
        {
            decoded = Uri.UnescapeDataString(path);
        }
        catch
        {
            return null;
        }

        var normalized = decoded.Replace('\\', '/').Trim('/');
        if (normalized.Length == 0)
            return null;

        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(segment => segment is "." or ".."))
            return null;

        return string.Join("/", segments);
    }

    private static bool TryResolveGameFilePath(Game game, string relativePath, out string fullPath)
    {
        fullPath = string.Empty;

        if (IsStandaloneArchive(game))
        {
            var fileName = Path.GetFileName(game.FolderPath);
            if (string.Equals(relativePath, fileName, StringComparison.OrdinalIgnoreCase))
            {
                fullPath = game.FolderPath;
                return true;
            }

            return false;
        }

        if (!Directory.Exists(game.FolderPath))
            return false;

        var singleArchive = FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
        {
            var archiveName = Path.GetFileName(singleArchive);
            if (string.Equals(relativePath, archiveName, StringComparison.OrdinalIgnoreCase))
            {
                fullPath = singleArchive;
                return true;
            }
        }

        var candidate = Path.GetFullPath(Path.Combine(game.FolderPath, relativePath));
        var root = Path.GetFullPath(game.FolderPath);
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(rootWithSeparator, StringComparison.Ordinal) &&
            !string.Equals(candidate, root, StringComparison.Ordinal))
            return false;

        if (!File.Exists(candidate))
            return false;

        fullPath = candidate;
        return true;
    }

    /// Enumerates all (path, size) entries inside a zip, 7z, tar, or tar.gz archive.
    internal static List<(string Name, long Size)> ReadArchiveEntries(string archivePath)
    {
        var entries = new List<(string, long)>();
        var lower = archivePath.ToLowerInvariant();

        try
        {
            if (lower.EndsWith(".zip"))
            {
                using var archive = ZipFile.OpenRead(archivePath);
                foreach (var entry in archive.Entries)
                {
                    var name = entry.FullName.Replace('\\', '/');
                    if (!string.IsNullOrEmpty(name))
                        entries.Add((name, entry.Length));
                }
            }
            else if (lower.EndsWith(".7z"))
            {
                using var archive = SevenZipArchive.Open(archivePath);
                foreach (var entry in archive.Entries)
                {
                    var name = entry.Key?.Replace('\\', '/');
                    if (string.IsNullOrEmpty(name)) continue;

                    entries.Add(entry.IsDirectory ? (name.TrimEnd('/') + '/', 0) : (name, entry.Size));
                }
            }
            else
            {
                // .tar, .tar.gz, .tgz
                Stream stream = File.OpenRead(archivePath);
                if (lower.EndsWith(".gz") || lower.EndsWith(".tgz"))
                    stream = new GZipStream(stream, CompressionMode.Decompress);

                using (stream)
                using (var reader = new TarReader(stream))
                {
                    while (reader.GetNextEntry() is { } entry)
                    {
                        var name = entry.Name.Replace('\\', '/');
                        if (string.IsNullOrEmpty(name)) continue;

                        if (entry.EntryType == TarEntryType.Directory)
                        {
                            if (!name.EndsWith('/')) name += '/';
                            entries.Add((name, 0));
                        }
                        else if (entry.EntryType is TarEntryType.RegularFile or TarEntryType.V7RegularFile)
                        {
                            entries.Add((name, entry.Length));
                        }
                    }
                }
            }
        }
        catch (Exception)
        {
            // Corrupt or unreadable archive — return empty
        }

        return entries;
    }

    private static bool TryOpenGameEntryStream(Game game, string relativePath, out Stream stream)
    {
        stream = Stream.Null;

        if (TryResolveGameFilePath(game, relativePath, out var fullPath))
        {
            stream = File.OpenRead(fullPath);
            return true;
        }

        var archivePath = IsStandaloneArchive(game)
            ? game.FolderPath
            : FindSingleArchive(game.FolderPath);
        if (archivePath is null)
            return false;

        stream = OpenArchiveEntryStream(archivePath, relativePath);
        return stream != Stream.Null;
    }

    private static Stream OpenArchiveEntryStream(string archivePath, string relativePath)
    {
        var lower = archivePath.ToLowerInvariant();

        try
        {
            if (lower.EndsWith(".zip"))
            {
                using var archive = ZipFile.OpenRead(archivePath);
                var entry = archive.Entries.FirstOrDefault(entry =>
                    string.Equals(
                        entry.FullName.Replace('\\', '/').TrimEnd('/'),
                        relativePath,
                        StringComparison.OrdinalIgnoreCase));
                if (entry is null)
                    return Stream.Null;

                var buffer = new MemoryStream();
                using var source = entry.Open();
                source.CopyTo(buffer);
                buffer.Position = 0;
                return buffer;
            }

            if (lower.EndsWith(".7z"))
            {
                using var archive = SevenZipArchive.Open(archivePath);
                var entry = archive.Entries.FirstOrDefault(entry =>
                    !entry.IsDirectory &&
                    string.Equals(
                        entry.Key?.Replace('\\', '/'),
                        relativePath,
                        StringComparison.OrdinalIgnoreCase));
                if (entry is null)
                    return Stream.Null;

                var buffer = new MemoryStream();
                using var source = entry.OpenEntryStream();
                source.CopyTo(buffer);
                buffer.Position = 0;
                return buffer;
            }

            Stream archiveStream = File.OpenRead(archivePath);
            if (lower.EndsWith(".gz") || lower.EndsWith(".tgz"))
                archiveStream = new GZipStream(archiveStream, CompressionMode.Decompress);

            {
                using (archiveStream)
                {
                    using var reader = new TarReader(archiveStream);
                    while (reader.GetNextEntry() is { } entry)
                    {
                        if (!string.Equals(entry.Name.Replace('\\', '/'), relativePath, StringComparison.OrdinalIgnoreCase))
                            continue;
                        if (entry.DataStream is null)
                            return Stream.Null;

                        var buffer = new MemoryStream();
                        entry.DataStream.CopyTo(buffer);
                        buffer.Position = 0;
                        return buffer;
                    }
                }
            }
        }
        catch (Exception)
        {
            return Stream.Null;
        }

        return Stream.Null;
    }

    private static bool StreamContainsEmbeddedElevationRequest(Stream stream)
    {
        stream.Position = 0;

        byte[][] patterns =
        [
            Encoding.UTF8.GetBytes("requireAdministrator"),
            Encoding.UTF8.GetBytes("highestAvailable"),
            Encoding.Unicode.GetBytes("requireAdministrator"),
            Encoding.Unicode.GetBytes("highestAvailable"),
        ];

        var overlap = patterns.Max(pattern => pattern.Length) - 1;
        var buffer = new byte[8192 + overlap];
        var carried = 0;

        while (true)
        {
            var read = stream.Read(buffer, carried, buffer.Length - carried);
            if (read == 0)
                break;

            var total = carried + read;
            var span = buffer.AsSpan(0, total);
            foreach (var pattern in patterns)
            {
                if (span.IndexOf(pattern) >= 0)
                    return true;
            }

            carried = Math.Min(overlap, total);
            if (carried > 0)
                span[^carried..].CopyTo(buffer);
        }

        return false;
    }

    private static List<BrowseEntry> BrowseArchiveEntries(string archivePath, string internalPrefix)
    {
        var rawEntries = ReadArchiveEntries(archivePath);
        var entries = new List<BrowseEntry>();
        var seenDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (rawName, size) in rawEntries)
        {
            if (rawName.Split('/').Any(s => HiddenNames.Contains(s)))
                continue;
            if (internalPrefix.Length > 0 && !rawName.StartsWith(internalPrefix, StringComparison.OrdinalIgnoreCase))
                continue;

            var remainder = rawName[internalPrefix.Length..].TrimEnd('/');
            if (string.IsNullOrEmpty(remainder))
                continue;

            var slashIdx = remainder.IndexOf('/');
            if (slashIdx < 0)
            {
                if (HiddenNames.Contains(remainder)) continue;
                var isDir = rawName.EndsWith('/');
                if (isDir)
                {
                    if (!seenDirs.Add(remainder)) continue;
                    entries.Add(new BrowseEntry(remainder, true, null));
                }
                else
                {
                    entries.Add(new BrowseEntry(remainder, false, size));
                }
            }
            else
            {
                var dirName = remainder[..slashIdx];
                if (HiddenNames.Contains(dirName)) continue;
                if (seenDirs.Add(dirName))
                    entries.Add(new BrowseEntry(dirName, true, null));
            }
        }

        return entries.OrderBy(e => !e.IsDirectory).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static async Task<IResult> BrowseGameFiles(int id, [FromQuery] string? path, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (!ExistsOnDisk(game))
            return Results.Problem("Game folder not found on disk.", statusCode: 404);

        var relativePath = (path ?? "").Replace('\\', '/').Trim('/');
        var segments = relativePath.Length > 0
            ? relativePath.Split('/')
            : Array.Empty<string>();

        // Standalone archive file — browse inside it directly
        if (IsStandaloneArchive(game))
        {
            var internalPrefix = segments.Length > 0 ? string.Join("/", segments) + "/" : "";
            var entries = BrowseArchiveEntries(game.FolderPath, internalPrefix);
            return Results.Ok(new BrowseResult(relativePath, true, entries));
        }

        // Check if the game folder contains a single archive — if so, browse inside it transparently
        var fsPath = game.FolderPath;
        string? archivePath = null;
        var archiveInternalSegments = new List<string>();

        var singleArchive = FindSingleArchive(fsPath);
        if (singleArchive is not null)
        {
            archivePath = singleArchive;
            archiveInternalSegments.AddRange(segments);
        }
        else
        {
            // Walk segments to find where we cross into an archive file
            foreach (var segment in segments)
            {
                if (archivePath is not null)
                {
                    archiveInternalSegments.Add(segment);
                    continue;
                }

                var candidatePath = System.IO.Path.Combine(fsPath, segment);
                var fullCandidate = System.IO.Path.GetFullPath(candidatePath);

                // Security: prevent path traversal
                if (!fullCandidate.StartsWith(System.IO.Path.GetFullPath(game.FolderPath)))
                    return Results.BadRequest("Invalid path.");

                if (Directory.Exists(fullCandidate))
                {
                    fsPath = fullCandidate;
                }
                else if (File.Exists(fullCandidate) && IsArchiveFile(fullCandidate))
                {
                    archivePath = fullCandidate;
                }
                else
                {
                    return Results.BadRequest("Path not found.");
                }
            }
        }

        if (archivePath is not null)
        {
            var internalPrefix = archiveInternalSegments.Count > 0
                ? string.Join("/", archiveInternalSegments) + "/"
                : "";

            var entries = BrowseArchiveEntries(archivePath, internalPrefix);
            return Results.Ok(new BrowseResult(relativePath, true, entries));
        }

        // Browse filesystem
        {
            var dirs = Directory.GetDirectories(fsPath);
            var files = Directory.GetFiles(fsPath);

            // If the folder contains a single archive and no subdirectories, browse into it automatically
            var archive = FindSingleArchive(fsPath);
            if (archive is not null)
            {
                var entries = BrowseArchiveEntries(archive, "");
                return Results.Ok(new BrowseResult(relativePath, true, entries));
            }

            var resultEntries = new List<BrowseEntry>();

            foreach (var dir in dirs)
            {
                var dirName = System.IO.Path.GetFileName(dir);
                if (HiddenNames.Contains(dirName)) continue;
                resultEntries.Add(new BrowseEntry(dirName, true, null));
            }

            foreach (var file in files)
            {
                var fi = new FileInfo(file);
                if (HiddenNames.Contains(fi.Name)) continue;
                var isArchive = IsArchiveFile(fi.Name);
                resultEntries.Add(new BrowseEntry(fi.Name, isArchive, fi.Length));
            }

            return Results.Ok(new BrowseResult(relativePath, false,
                resultEntries.OrderBy(e => !e.IsDirectory).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToList()));
        }
    }

    public record InstallerInspectionResponse(
        string InstallerType,
        bool RequestsElevation,
        bool CanPatchCopyForNonAdmin);
}
