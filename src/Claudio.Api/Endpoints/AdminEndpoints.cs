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
        group.MapDelete("/games/{id:int}", DeleteGame);

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

        var candidates = await igdbService.SearchCandidatesAsync(game.Title);
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
        if (!Directory.Exists(game.FolderPath))
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

        game.Title = request.Title;
        game.Summary = request.Summary;
        game.Genre = request.Genre;
        game.ReleaseYear = request.ReleaseYear;
        game.CoverUrl = request.CoverUrl;
        game.InstallType = request.InstallType;
        game.InstallerExe = request.InstallerExe;
        game.GameExe = request.GameExe;
        game.Developer = request.Developer;
        game.Publisher = request.Publisher;
        game.GameMode = request.GameMode;
        game.Series = request.Series;
        game.Franchise = request.Franchise;
        game.GameEngine = request.GameEngine;
        await db.SaveChangesAsync();

        return Results.Ok(GameEndpoints.ToDto(game));
    }

    public record GameUpdateRequest(
        string Title,
        string? Summary,
        string? Genre,
        int? ReleaseYear,
        string? CoverUrl,
        InstallType InstallType,
        string? InstallerExe,
        string? GameExe,
        string? Developer,
        string? Publisher,
        string? GameMode,
        string? Series,
        string? Franchise,
        string? GameEngine);
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

        if (deleteFiles && Directory.Exists(game.FolderPath))
        {
            loggerFactory.CreateLogger("AdminEndpoints").LogWarning("Deleting game files from disk: {Path}", game.FolderPath);
            Directory.Delete(game.FolderPath, recursive: true);
        }

        db.Games.Remove(game);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    public record RoleUpdateRequest(string Role);
}
