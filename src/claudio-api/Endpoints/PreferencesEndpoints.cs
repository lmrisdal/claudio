using System.Security.Claims;
using System.Text.Json;
using Claudio.Api.Data;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Claudio.Api.Endpoints;

public static class PreferencesEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static RouteGroupBuilder MapPreferencesEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/preferences")
            .WithTags("Preferences")
            .RequireAuthorization();

        group.MapGet(string.Empty, GetPreferences);
        group.MapPut(string.Empty, UpdatePreferences);

        return group;
    }

    private static async Task<IResult> GetPreferences(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = GetUserId(principal);
        if (userId is null)
            return Results.Unauthorized();

        var preferences = await db.UserPreferences
            .AsNoTracking()
            .SingleOrDefaultAsync(p => p.UserId == userId.Value, cancellationToken);

        return Results.Ok(DeserializePreferences(preferences?.PreferencesJson));
    }

    private static async Task<IResult> UpdatePreferences(
        UserPreferencesDto request,
        ClaimsPrincipal principal,
        AppDbContext db,
        UserManager<ApplicationUser> userManager,
        CancellationToken cancellationToken)
    {
        var userId = GetUserId(principal);
        if (userId is null)
            return Results.Unauthorized();

        var normalized = Normalize(request);
        var user = await EnsureUserAsync(userId.Value, principal, userManager);

        var preferences = await db.UserPreferences
            .SingleOrDefaultAsync(p => p.UserId == userId.Value, cancellationToken);

        var serialized = JsonSerializer.Serialize(normalized, JsonOptions);

        if (preferences is null)
        {
            preferences = new UserPreferences
            {
                UserId = user.Id,
                PreferencesJson = serialized,
                UpdatedAt = DateTime.UtcNow,
            };
            db.UserPreferences.Add(preferences);
        }
        else
        {
            preferences.PreferencesJson = serialized;
            preferences.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(normalized);
    }

    private static int? GetUserId(ClaimsPrincipal principal)
    {
        var userId = principal.FindFirstValue(OpenIddictConstants.Claims.Subject);
        return int.TryParse(userId, out var value) ? value : null;
    }

    private static UserPreferencesDto DeserializePreferences(string? preferencesJson)
    {
        if (string.IsNullOrWhiteSpace(preferencesJson))
            return new UserPreferencesDto();

        try
        {
            return Normalize(JsonSerializer.Deserialize<UserPreferencesDto>(preferencesJson, JsonOptions) ?? new UserPreferencesDto());
        }
        catch
        {
            return new UserPreferencesDto();
        }
    }

    private static UserPreferencesDto Normalize(UserPreferencesDto request)
    {
        var platformOrder = request.Library.PlatformOrder
            .Where(platform => !string.IsNullOrWhiteSpace(platform))
            .Select(platform => platform.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new UserPreferencesDto
        {
            Library = new LibraryPreferencesDto
            {
                PlatformOrder = platformOrder,
            },
        };
    }

    private static async Task<ApplicationUser> EnsureUserAsync(
        int userId,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager)
    {
        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is not null)
            return user;

        var username = principal.Identity?.Name;
        var createdUser = new ApplicationUser
        {
            Id = userId,
            UserName = string.IsNullOrWhiteSpace(username) ? $"user{userId}" : username,
            Role = principal.IsInRole("admin") ? UserRole.Admin : UserRole.User,
            CreatedAt = DateTime.UtcNow,
        };

        var result = await userManager.CreateAsync(createdUser);
        if (!result.Succeeded)
            throw new InvalidOperationException(result.Errors.FirstOrDefault()?.Description ?? "Failed to create user for preferences.");

        return createdUser;
    }
}
