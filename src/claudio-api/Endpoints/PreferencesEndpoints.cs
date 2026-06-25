using System.Text.Json;
using Claudio.Api.Data;
using Claudio.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Endpoints;

public static class PreferencesEndpoints
{
    private const int GlobalPreferencesId = 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static RouteGroupBuilder MapPreferencesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/preferences")
            .WithTags("Preferences");

        group.MapGet(string.Empty, GetPreferences);
        group.MapPut(string.Empty, UpdatePreferences);

        return group;
    }

    private static async Task<IResult> GetPreferences(
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var preferences = await db.AppPreferences
            .AsNoTracking()
            .SingleOrDefaultAsync(p => p.Id == GlobalPreferencesId, cancellationToken);

        return Results.Ok(DeserializePreferences(preferences?.PreferencesJson));
    }

    private static async Task<IResult> UpdatePreferences(
        AppPreferencesDto request,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var normalized = Normalize(request);

        var preferences = await db.AppPreferences
            .SingleOrDefaultAsync(p => p.Id == GlobalPreferencesId, cancellationToken);

        var serialized = JsonSerializer.Serialize(normalized, JsonOptions);

        if (preferences is null)
        {
            preferences = new AppPreferences
            {
                Id = GlobalPreferencesId,
                PreferencesJson = serialized,
                UpdatedAt = DateTime.UtcNow,
            };
            db.AppPreferences.Add(preferences);
        }
        else
        {
            preferences.PreferencesJson = serialized;
            preferences.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(normalized);
    }

    private static AppPreferencesDto DeserializePreferences(string? preferencesJson)
    {
        if (string.IsNullOrWhiteSpace(preferencesJson))
            return new AppPreferencesDto();

        try
        {
            return Normalize(JsonSerializer.Deserialize<AppPreferencesDto>(preferencesJson, JsonOptions) ?? new AppPreferencesDto());
        }
        catch
        {
            return new AppPreferencesDto();
        }
    }

    private static AppPreferencesDto Normalize(AppPreferencesDto request)
    {
        var platformOrder = request.Library.PlatformOrder
            .Where(platform => !string.IsNullOrWhiteSpace(platform))
            .Select(platform => platform.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new AppPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = platformOrder,
            },
        };
    }

}
