using System.Formats.Tar;
using System.IO.Compression;
using System.Security.Claims;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Endpoints;

public static class GameEndpoints
{
    public static RouteGroupBuilder MapGameEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/games")
            .WithTags("Games")
            .RequireAuthorization();

        group.MapGet("/", GetAll);
        group.MapGet("/{id:int}", GetById);
        group.MapPost("/{id:int}/download-ticket", CreateDownloadTicket);
        group.MapGet("/{id:int}/download", Download).AllowAnonymous();
        group.MapGet("/{id:int}/browse", BrowseGameFiles);
        group.MapGet("/{id:int}/emulation", GetEmulationInfo);
        group.MapPost("/{id:int}/emulation/session", CreateEmulationSession);
        group.MapMethods("/{id:int}/emulation/files/{ticket}/{**path}", ["GET", "HEAD"], GetEmulationFile).AllowAnonymous();

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

    private static async Task<IResult> CreateDownloadTicket(int id, AppDbContext db, DownloadTicketService ticketService, DownloadService downloadService)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (game.IsProcessing) return Results.Conflict("Game is currently being processed.");

        if (!ExistsOnDisk(game))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        // Pre-build tar if needed so the download endpoint can serve it immediately
        if (!IsStandaloneArchive(game))
        {
            var singleArchive = FindSingleArchive(game.FolderPath);
            if (singleArchive is null)
                await downloadService.CreateTarAsync(game);
        }

        var ticket = ticketService.CreateTicket(id);
        return Results.Ok(new { ticket });
    }

    private static async Task<IResult> Download(
        int id,
        [FromQuery] string? ticket,
        AppDbContext db,
        DownloadService downloadService,
        DownloadTicketService ticketService,
        HttpContext httpContext)
    {
        // Require either normal auth or a valid single-use ticket
        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated == true;
        var hasValidTicket = ticket is not null && ticketService.TryRedeem(ticket, id);

        if (!isAuthenticated && !hasValidTicket)
            return Results.Unauthorized();

        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        if (!ExistsOnDisk(game))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        // Standalone archive file — serve it directly
        if (IsStandaloneArchive(game))
        {
            var ext = System.IO.Path.GetExtension(game.FolderPath).ToLowerInvariant();
            var contentType = ext == ".zip" ? "application/zip" : ext == ".iso" ? "application/x-iso9660-image" : "application/x-tar";
            var fileName = $"{game.Title}{ext}";
            return Results.File(
                game.FolderPath,
                contentType: contentType,
                fileDownloadName: fileName,
                enableRangeProcessing: true);
        }

        // If the folder contains a single archive, serve it directly
        var singleArchive = FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
        {
            var ext = System.IO.Path.GetExtension(singleArchive).ToLowerInvariant();
            var contentType = ext == ".zip" ? "application/zip" : "application/x-tar";
            var fileName = ext == ".zip" ? $"{game.Title}.zip" : $"{game.Title}.tar";
            return Results.File(
                singleArchive,
                contentType: contentType,
                fileDownloadName: fileName,
                enableRangeProcessing: true);
        }

        // Create tar on the fly and serve it
        var tarPath = await downloadService.CreateTarAsync(game);

        return Results.File(
            tarPath,
            contentType: "application/x-tar",
            fileDownloadName: $"{game.Title}.tar",
            enableRangeProcessing: true);
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
        { "__MACOSX", ".DS_Store", "@eaDir", "#recycle", "Thumbs.db" };

    private static readonly string[] ArchiveExtensions = [".zip", ".tar", ".tar.gz", ".tgz", ".iso"];

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
        EmulationTicketService ticketService,
        HttpContext httpContext)
    {
        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated == true;
        if (!isAuthenticated && !ticketService.IsValid(ticket, id))
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

        return Results.File(fullPath, "application/octet-stream", enableRangeProcessing: true);
    }

    private static int? GetUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(value, out var userId) ? userId : null;
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

    /// Enumerates all (path, size) entries inside a zip, tar, or tar.gz archive.
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
}
