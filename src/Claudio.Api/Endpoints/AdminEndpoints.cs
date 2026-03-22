using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Endpoints;

public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(UserRole.Admin.ToString()));

        group.MapGet("/users", GetUsers);
        group.MapDelete("/users/{id:int}", DeleteUser);
        group.MapPut("/users/{id:int}/role", UpdateUserRole);
        group.MapPost("/scan", TriggerScan);
        group.MapPost("/scan/igdb", TriggerIgdbScan);
        group.MapPut("/games/{id:int}", UpdateGame);
        group.MapGet("/games/{id:int}/executables", ListExecutables);
        group.MapPost("/games/{id:int}/igdb/search", SearchGameIgdb);
        group.MapPost("/igdb/search", SearchIgdbFreeText);
        group.MapPost("/games/{id:int}/igdb/apply", ApplyGameIgdb);
        group.MapPost("/games/{id:int}/compress", QueueCompression);
        group.MapPost("/games/{id:int}/compress/cancel", CancelCompression);
        group.MapGet("/compress/status", GetCompressionStatus);
        group.MapPost("/games/{id:int}/tag-folder", TagFolder);
        group.MapDelete("/games/{id:int}", DeleteGame);
        group.MapGet("/steamgriddb/search", SearchSteamGridDb);
        group.MapGet("/steamgriddb/{sgdbGameId:long}/covers", GetSteamGridDbCovers);
        group.MapGet("/steamgriddb/{sgdbGameId:long}/heroes", GetSteamGridDbHeroes);
        group.MapPost("/games/{id:int}/upload-image", UploadImage).DisableAntiforgery();

        return group;
    }

    private static async Task<IResult> GetUsers(AppDbContext db)
    {
        var users = await db.Users
            .OrderBy(u => u.Username)
            .Select(u => new UserDto
            {
                Id = u.Id,
                Username = u.Username,
                Role = u.Role,
                CreatedAt = u.CreatedAt,
            })
            .ToListAsync();

        return Results.Ok(users);
    }

    private static async Task<IResult> DeleteUser(int id, AppDbContext db)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return Results.NotFound();

        db.Users.Remove(user);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> UpdateUserRole(int id, RoleUpdateRequest request, AppDbContext db)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return Results.NotFound();

        if (!Enum.TryParse<UserRole>(request.Role, true, out var role))
            return Results.BadRequest("Invalid role.");

        user.Role = role;
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> TriggerScan(LibraryScanService scanService)
    {
        var result = await scanService.ScanAsync();
        return Results.Ok(result);
    }

    private static async Task<IResult> TriggerIgdbScan(IgdbService igdbService)
    {
        var result = await igdbService.ScanAsync();
        return Results.Ok(result);
    }

    private static async Task<IResult> SearchGameIgdb(int id, AppDbContext db, IgdbService igdbService)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        var candidates = await igdbService.SearchCandidatesAsync(game.FolderName ?? game.Title);
        return Results.Ok(candidates);
    }

    private static async Task<IResult> SearchIgdbFreeText(IgdbSearchRequest request, IgdbService igdbService)
    {
        var candidates = await igdbService.SearchCandidatesAsync(request.Query);
        return Results.Ok(candidates);
    }

    private static async Task<IResult> ApplyGameIgdb(int id, IgdbApplyRequest request, IgdbService igdbService, AppDbContext db)
    {
        await igdbService.ApplyMatchAsync(id, request.IgdbId);
        var game = await db.Games.FindAsync(id);
        return Results.Ok(GameEndpoints.ToDto(game!));
    }

    private static async Task<IResult> ListExecutables(int id, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (!GameEndpoints.ExistsOnDisk(game))
            return Results.Ok(Array.Empty<string>());

        if (GameEndpoints.IsStandaloneArchive(game))
            return Results.Ok(Array.Empty<string>());

        var exes = new List<string>();
        string[] extensions = [".exe", ".iso"];

        var singleArchive = GameEndpoints.FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
        {
            // Single-archive game: list executables inside
            foreach (var (name, _) in GameEndpoints.ReadArchiveEntries(singleArchive))
            {
                if (extensions.Any(ext => name.EndsWith(ext, StringComparison.OrdinalIgnoreCase)))
                    exes.Add(name);
            }
        }
        else
        {
            // Regular game folder
            foreach (var ext in extensions)
            {
                exes.AddRange(
                    Directory.GetFiles(game.FolderPath, $"*{ext}", SearchOption.AllDirectories)
                        .Select(f => Path.GetRelativePath(game.FolderPath, f).Replace('\\', '/')));
            }
        }

        return Results.Ok(exes.OrderBy(f => f).ToList());
    }

    private static async Task<IResult> UpdateGame(int id, GameUpdateRequest request, AppDbContext db)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (game.IsProcessing) return Results.Conflict("Game is currently being processed.");

        game.Title = request.Title;
        game.Summary = request.Summary;
        game.Genre = request.Genre;
        game.ReleaseYear = request.ReleaseYear;
        game.CoverUrl = request.CoverUrl;
        game.HeroUrl = request.HeroUrl;
        game.InstallType = request.InstallType;
        game.InstallerExe = request.InstallerExe;
        game.GameExe = request.GameExe;
        game.Developer = request.Developer;
        game.Publisher = request.Publisher;
        game.GameMode = request.GameMode;
        game.Series = request.Series;
        game.Franchise = request.Franchise;
        game.GameEngine = request.GameEngine;
        game.IgdbId = request.IgdbId;
        game.IgdbSlug = request.IgdbId is null ? null : request.IgdbSlug;
        await db.SaveChangesAsync();

        return Results.Ok(GameEndpoints.ToDto(game));
    }

    private static async Task<IResult> QueueCompression(
        int id, [FromQuery] string? format, AppDbContext db, CompressionService compressionService)
    {
        var fmt = format ?? "zip";
        if (fmt is not "zip" and not "tar")
            return Results.BadRequest("Format must be 'zip' or 'tar'.");

        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();
        if (game.IsProcessing) return Results.Conflict("Game is already being processed.");

        if (!GameEndpoints.ExistsOnDisk(game))
            return Results.Problem("Game folder not found on disk.", statusCode: 404);

        if (GameEndpoints.IsStandaloneArchive(game))
            return Results.BadRequest("Game is already a standalone archive.");

        var singleArchive = GameEndpoints.FindSingleArchive(game.FolderPath);
        if (singleArchive is not null)
            return Results.BadRequest("Game is already a single archive.");

        await compressionService.QueueCompressionAsync(id, fmt);
        return Results.Accepted();
    }

    private static async Task<IResult> CancelCompression(int id, CompressionService compressionService)
    {
        await compressionService.CancelCompressionAsync(id);
        return Results.NoContent();
    }

    private static IResult GetCompressionStatus(CompressionService compressionService)
    {
        return Results.Ok(compressionService.GetStatus());
    }

    private static async Task<IResult> TagFolder(int id, AppDbContext db, ILogger<AppDbContext> logger)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        if (game.IgdbId is null)
            return Results.BadRequest("Game has no IGDB match.");

        var tag = $"(igdb-{game.IgdbId})";

        // Already tagged?
        if (game.FolderName.Contains(tag, StringComparison.OrdinalIgnoreCase))
            return Results.Ok(GameEndpoints.ToDto(game));

        if (!GameEndpoints.ExistsOnDisk(game))
            return Results.Problem("Game not found on disk.", statusCode: 404);

        var isFile = GameEndpoints.IsStandaloneArchive(game);
        var parentDir = Path.GetDirectoryName(game.FolderPath)!;
        string newFolderName;
        if (isFile)
        {
            var ext = Path.GetExtension(game.FolderName);
            var baseName = Path.GetFileNameWithoutExtension(game.FolderName);
            newFolderName = $"{baseName} {tag}{ext}";
        }
        else
        {
            newFolderName = $"{game.FolderName} {tag}";
        }
        var newFolderPath = Path.Combine(parentDir, newFolderName);

        if (Directory.Exists(newFolderPath) || File.Exists(newFolderPath))
            return Results.Problem("Target already exists.", statusCode: 409);

        if (isFile)
            File.Move(game.FolderPath, newFolderPath);
        else
            Directory.Move(game.FolderPath, newFolderPath);

        game.FolderName = newFolderName;
        game.FolderPath = newFolderPath;
        await db.SaveChangesAsync();

        logger.LogInformation("Tagged folder: {OldName} -> {NewName}", game.FolderName, newFolderName);
        return Results.Ok(GameEndpoints.ToDto(game));
    }

    public record GameUpdateRequest(
        string Title,
        string? Summary,
        string? Genre,
        int? ReleaseYear,
        string? CoverUrl,
        string? HeroUrl,
        InstallType InstallType,
        string? InstallerExe,
        string? GameExe,
        string? Developer,
        string? Publisher,
        string? GameMode,
        string? Series,
        string? Franchise,
        string? GameEngine,
        long? IgdbId,
        string? IgdbSlug);
    public record IgdbApplyRequest(long IgdbId);
    public record IgdbSearchRequest(string Query);

    private static async Task<IResult> DeleteGame(
        int id,
        [FromQuery] bool deleteFiles,
        AppDbContext db,
        ILoggerFactory loggerFactory)
    {
        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        if (deleteFiles && GameEndpoints.ExistsOnDisk(game))
        {
            loggerFactory.CreateLogger("AdminEndpoints").LogWarning("Deleting game files from disk: {Path}", game.FolderPath);
            if (GameEndpoints.IsStandaloneArchive(game))
                File.Delete(game.FolderPath);
            else
                Directory.Delete(game.FolderPath, recursive: true);
        }

        db.Games.Remove(game);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> SearchSteamGridDb(
        [FromQuery] string query, ClaudioConfig config, IHttpClientFactory httpClientFactory)
    {
        if (string.IsNullOrEmpty(config.Steamgriddb.ApiKey))
            return Results.BadRequest("SteamGridDB API key not configured.");

        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var searchRes = await client.GetAsync($"https://www.steamgriddb.com/api/v2/search/autocomplete/{Uri.EscapeDataString(query)}");
        if (!searchRes.IsSuccessStatusCode)
            return Results.Problem("SteamGridDB search failed.", statusCode: 502);

        var searchJson = await searchRes.Content.ReadAsStringAsync();
        var searchResult = JsonSerializer.Deserialize<SteamGridDbResponse<List<SteamGridDbGame>>>(searchJson);

        var results = (searchResult?.Data ?? []).Select(g => new
        {
            g.Id,
            g.Name,
            Year = g.ReleaseDate is > 0
                ? DateTimeOffset.FromUnixTimeSeconds(g.ReleaseDate.Value).Year
                : (int?)null,
        });
        return Results.Ok(results);
    }

    private static async Task<IResult> GetSteamGridDbCovers(
        long sgdbGameId, ClaudioConfig config, IHttpClientFactory httpClientFactory)
    {
        if (string.IsNullOrEmpty(config.Steamgriddb.ApiKey))
            return Results.BadRequest("SteamGridDB API key not configured.");

        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var gridsRes = await client.GetAsync($"https://www.steamgriddb.com/api/v2/grids/game/{sgdbGameId}?dimensions=600x900&types=static,animated");
        if (!gridsRes.IsSuccessStatusCode)
            return Results.Ok(Array.Empty<string>());

        var gridsJson = await gridsRes.Content.ReadAsStringAsync();
        var gridsResult = JsonSerializer.Deserialize<SteamGridDbResponse<List<SteamGridDbGrid>>>(gridsJson);

        var urls = gridsResult?.Data?.Select(g => g.Url).Where(u => u is not null).ToList() ?? [];
        return Results.Ok(urls);
    }

    private static async Task<IResult> GetSteamGridDbHeroes(
        long sgdbGameId, ClaudioConfig config, IHttpClientFactory httpClientFactory)
    {
        if (string.IsNullOrEmpty(config.Steamgriddb.ApiKey))
            return Results.BadRequest("SteamGridDB API key not configured.");

        var client = httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Steamgriddb.ApiKey);

        var heroesRes = await client.GetAsync($"https://www.steamgriddb.com/api/v2/heroes/game/{sgdbGameId}?types=static,animated");
        if (!heroesRes.IsSuccessStatusCode)
            return Results.Ok(Array.Empty<string>());

        var heroesJson = await heroesRes.Content.ReadAsStringAsync();
        var heroesResult = JsonSerializer.Deserialize<SteamGridDbResponse<List<SteamGridDbGrid>>>(heroesJson);

        var urls = heroesResult?.Data?.Select(g => g.Url).Where(u => u is not null).ToList() ?? [];
        return Results.Ok(urls);
    }

    private class SteamGridDbResponse<T>
    {
        [JsonPropertyName("data")]
        public T? Data { get; set; }
    }

    private class SteamGridDbGame
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }

        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("release_date")]
        public long? ReleaseDate { get; set; }
    }

    private class SteamGridDbGrid
    {
        [JsonPropertyName("url")]
        public string? Url { get; set; }
    }

    private static async Task<IResult> UploadImage(
        int id,
        [FromQuery] string type,
        IFormFile file,
        AppDbContext db,
        ClaudioConfig config)
    {
        if (type is not "cover" and not "hero")
            return Results.BadRequest("Type must be 'cover' or 'hero'.");

        var game = await db.Games.FindAsync(id);
        if (game is null) return Results.NotFound();

        // Validate content type
        if (!file.ContentType.StartsWith("image/"))
            return Results.BadRequest("File must be an image.");

        if (file.Length > 10 * 1024 * 1024)
            return Results.BadRequest("File must be under 10 MB.");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not ".jpg" and not ".jpeg" and not ".png" and not ".webp" and not ".gif")
            return Results.BadRequest("Supported formats: jpg, png, webp, gif.");

        // Store in /config/images/ (same volume as database)
        var configDir = Path.GetDirectoryName(config.Database.SqlitePath) ?? "/config";
        var imagesDir = Path.Combine(configDir, "images");
        Directory.CreateDirectory(imagesDir);

        // Filename: {gameId}-{type}{ext}
        var fileName = $"{id}-{type}{ext}";
        var filePath = Path.Combine(imagesDir, fileName);

        // Delete previous upload for this game+type if different extension
        foreach (var existing in Directory.GetFiles(imagesDir, $"{id}-{type}.*"))
        {
            if (existing != filePath) File.Delete(existing);
        }

        await using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        var url = $"/images/{fileName}";
        return Results.Ok(new { url });
    }

    public record RoleUpdateRequest(string Role);
}
