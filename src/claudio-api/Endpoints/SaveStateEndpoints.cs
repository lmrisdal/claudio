using System.Diagnostics;
using System.Security.Claims;
using Claudio.Api.Data;
using Claudio.Api.Models;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Claudio.Api.Endpoints;

public static class SaveStateEndpoints
{
    public static RouteGroupBuilder MapSaveStateEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/games/{gameId:int}/save-states")
            .WithTags("SaveStates")
            .RequireAuthorization();

        group.MapGet("/", ListSaveStates);
        group.MapPost("/", CreateSaveState).DisableAntiforgery();
        group.MapPut("/{saveId:int}", UpdateSaveState).DisableAntiforgery();
        group.MapGet("/{saveId:int}/state", GetStateData);
        group.MapGet("/{saveId:int}/screenshot", GetScreenshot).AllowAnonymous();
        group.MapDelete("/{saveId:int}", DeleteSaveState);

        return group;
    }

    private static async Task<IResult> ListSaveStates(int gameId, ClaimsPrincipal principal, AppDbContext db)
    {
        var userId = GetUserId(principal);
        if (userId is null) return Results.Unauthorized();

        var saves = await db.SaveStates
            .Where(s => s.GameId == gameId && s.UserId == userId.Value)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new SaveStateDto
            {
                Id = s.Id,
                GameId = s.GameId,
                ScreenshotUrl = $"/api/games/{gameId}/save-states/{s.Id}/screenshot",
                CreatedAt = s.CreatedAt,
            })
            .ToListAsync();

        return Results.Ok(saves);
    }

    private static async Task<IResult> CreateSaveState(
        int gameId,
        HttpRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        ClaudioConfig config)
    {
        var userId = GetUserId(principal);
        if (userId is null) return Results.Unauthorized();

        var form = await request.ReadFormAsync();
        var stateFile = form.Files.GetFile("state");
        var screenshotFile = form.Files.GetFile("screenshot");

        if (stateFile is null)
            return Results.BadRequest("Missing 'state' file.");

        byte[] stateData;
        using (var ms = new MemoryStream())
        {
            await stateFile.CopyToAsync(ms);
            stateData = ms.ToArray();
        }

        byte[] screenshotData = [];
        if (screenshotFile is not null)
        {
            using var ms = new MemoryStream();
            await screenshotFile.CopyToAsync(ms);
            var pngData = ms.ToArray();
            screenshotData = await ConvertToAvifAsync(pngData);
        }

        // Enforce limit if configured
        var maxSaves = config.Emulation.MaxSaveStatesPerGame;
        if (maxSaves is > 0)
        {
            var existingCount = await db.SaveStates
                .CountAsync(s => s.GameId == gameId && s.UserId == userId.Value);

            if (existingCount >= maxSaves.Value)
            {
                var toDelete = await db.SaveStates
                    .Where(s => s.GameId == gameId && s.UserId == userId.Value)
                    .OrderBy(s => s.CreatedAt)
                    .Take(existingCount - maxSaves.Value + 1)
                    .ToListAsync();

                db.SaveStates.RemoveRange(toDelete);
            }
        }

        var saveState = new SaveState
        {
            GameId = gameId,
            UserId = userId.Value,
            StateData = stateData,
            ScreenshotData = screenshotData,
            CreatedAt = DateTime.UtcNow,
        };

        db.SaveStates.Add(saveState);
        await db.SaveChangesAsync();

        return Results.Created($"/api/games/{gameId}/save-states/{saveState.Id}", new SaveStateDto
        {
            Id = saveState.Id,
            GameId = saveState.GameId,
            ScreenshotUrl = $"/api/games/{gameId}/save-states/{saveState.Id}/screenshot",
            CreatedAt = saveState.CreatedAt,
        });
    }

    private static async Task<IResult> UpdateSaveState(
        int gameId,
        int saveId,
        HttpRequest request,
        ClaimsPrincipal principal,
        AppDbContext db)
    {
        var userId = GetUserId(principal);
        if (userId is null) return Results.Unauthorized();

        var save = await db.SaveStates
            .FirstOrDefaultAsync(s => s.Id == saveId && s.GameId == gameId && s.UserId == userId.Value);

        if (save is null) return Results.NotFound();

        var form = await request.ReadFormAsync();
        var stateFile = form.Files.GetFile("state");
        var screenshotFile = form.Files.GetFile("screenshot");

        if (stateFile is null)
            return Results.BadRequest("Missing 'state' file.");

        using (var ms = new MemoryStream())
        {
            await stateFile.CopyToAsync(ms);
            save.StateData = ms.ToArray();
        }

        if (screenshotFile is not null)
        {
            using var ms = new MemoryStream();
            await screenshotFile.CopyToAsync(ms);
            var pngData = ms.ToArray();
            save.ScreenshotData = await ConvertToAvifAsync(pngData);
        }

        save.CreatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Results.Ok(new SaveStateDto
        {
            Id = save.Id,
            GameId = save.GameId,
            ScreenshotUrl = $"/api/games/{gameId}/save-states/{save.Id}/screenshot",
            CreatedAt = save.CreatedAt,
        });
    }

    private static async Task<IResult> GetStateData(int gameId, int saveId, ClaimsPrincipal principal, AppDbContext db)
    {
        var userId = GetUserId(principal);
        if (userId is null) return Results.Unauthorized();

        var save = await db.SaveStates
            .Where(s => s.Id == saveId && s.GameId == gameId && s.UserId == userId.Value)
            .Select(s => s.StateData)
            .FirstOrDefaultAsync();

        if (save is null) return Results.NotFound();
        return Results.File(save, "application/octet-stream");
    }

    private static async Task<IResult> GetScreenshot(int gameId, int saveId, AppDbContext db)
    {
        var screenshot = await db.SaveStates
            .Where(s => s.Id == saveId && s.GameId == gameId)
            .Select(s => s.ScreenshotData)
            .FirstOrDefaultAsync();

        if (screenshot is null || screenshot.Length == 0) return Results.NotFound();
        return Results.File(screenshot, "image/avif");
    }

    private static async Task<IResult> DeleteSaveState(int gameId, int saveId, ClaimsPrincipal principal, AppDbContext db)
    {
        var userId = GetUserId(principal);
        if (userId is null) return Results.Unauthorized();

        var save = await db.SaveStates
            .FirstOrDefaultAsync(s => s.Id == saveId && s.GameId == gameId && s.UserId == userId.Value);

        if (save is null) return Results.NotFound();

        db.SaveStates.Remove(save);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<byte[]> ConvertToAvifAsync(byte[] pngData)
    {
        var inputPath = Path.GetTempFileName();
        var outputPath = Path.ChangeExtension(inputPath, ".avif");

        try
        {
            await File.WriteAllBytesAsync(inputPath, pngData);

            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = "avifenc",
                ArgumentList =
                {
                    "--speed", "6",
                    "--qcolor", "40",
                    "--qalpha", "40",
                    inputPath,
                    outputPath,
                },
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            process.Start();
            await process.WaitForExitAsync();

            if (process.ExitCode != 0 || !File.Exists(outputPath))
                return pngData;

            return await File.ReadAllBytesAsync(outputPath);
        }
        catch
        {
            // avifenc not available — store original PNG
            return pngData;
        }
        finally
        {
            if (File.Exists(inputPath)) File.Delete(inputPath);
            if (File.Exists(outputPath)) File.Delete(outputPath);
        }
    }

    private static int? GetUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(OpenIddictConstants.Claims.Subject);
        return int.TryParse(value, out var userId) ? userId : null;
    }
}

public class SaveStateDto
{
    public int Id { get; set; }
    public int GameId { get; set; }
    public string ScreenshotUrl { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
