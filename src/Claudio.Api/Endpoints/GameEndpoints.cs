using System.Formats.Tar;
using System.IO.Compression;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
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

        if (!Directory.Exists(game.FolderPath))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

        // Pre-build tar if needed so the download endpoint can serve it immediately
        var singleArchive = FindSingleArchive(game.FolderPath);
        if (singleArchive is null)
            await downloadService.CreateTarAsync(game);

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

        if (!Directory.Exists(game.FolderPath))
            return Results.Problem("Game files not found on disk.", statusCode: 500);

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
        IsArchive = Directory.Exists(game.FolderPath) && FindSingleArchive(game.FolderPath) is not null,
    };

    public record BrowseEntry(string Name, bool IsDirectory, long? Size);
    public record BrowseResult(string Path, bool InsideArchive, List<BrowseEntry> Entries);

    internal static readonly HashSet<string> HiddenNames = new(StringComparer.OrdinalIgnoreCase)
        { "__MACOSX", ".DS_Store", "@eaDir", "#recycle", "Thumbs.db" };

    private static readonly string[] ArchiveExtensions = [".zip", ".tar", ".tar.gz", ".tgz"];

    internal static bool IsArchiveFile(string path)
    {
        var lower = path.ToLowerInvariant();
        return ArchiveExtensions.Any(ext => lower.EndsWith(ext));
    }

    internal static string? FindSingleArchive(string folderPath)
    {
        var dirs = Directory.GetDirectories(folderPath);
        if (dirs.Length > 0) return null;
        var files = Directory.GetFiles(folderPath);
        var archives = files.Where(f => IsArchiveFile(f)).ToArray();
        return archives.Length == 1 ? archives[0] : null;
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
        if (!Directory.Exists(game.FolderPath))
            return Results.Problem("Game folder not found on disk.", statusCode: 404);

        var relativePath = (path ?? "").Replace('\\', '/').Trim('/');
        var segments = relativePath.Length > 0
            ? relativePath.Split('/')
            : Array.Empty<string>();

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
