using System.Security.Claims;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Claudio.Api.Endpoints;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", Register);
        group.MapPost("/remote", ProxyLogin);
        group.MapGet("/me", GetMe).RequireAuthorization();
        group.MapPut("/change-password", ChangePassword).RequireAuthorization();

        return group;
    }

    private static async Task<IResult> Register(
        LoginRequest request,
        UserManager<ApplicationUser> userManager,
        AppDbContext db)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest("Username and password are required.");

        if (request.Password.Length < 8)
            return Results.BadRequest("Password must be at least 8 characters.");

        var isFirstUser = !await db.Users.AnyAsync();

        var user = new ApplicationUser
        {
            UserName = request.Username,
            Role = isFirstUser ? UserRole.Admin : UserRole.User,
            CreatedAt = DateTime.UtcNow,
        };

        var result = await userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var error = result.Errors.FirstOrDefault();
            return error?.Code == "DuplicateUserName"
                ? Results.Conflict("Username already taken.")
                : Results.BadRequest(error?.Description ?? "Registration failed.");
        }

        return Results.Ok(ToDto(user));
    }

    private static async Task<IResult> ProxyLogin(
        HttpContext httpContext,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ProxyNonceStore nonceStore,
        ClaudioConfig config)
    {
        var header = config.Auth.ProxyAuthHeader;
        if (string.IsNullOrWhiteSpace(header))
            return Results.NotFound();

        var username = httpContext.Request.Headers[header].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(username))
            return Results.Unauthorized();

        var user = await userManager.FindByNameAsync(username);
        if (user is null)
        {
            if (!config.Auth.ProxyAuthAutoCreate)
                return Results.Unauthorized();

            var isFirstUser = !await db.Users.AnyAsync();
            user = new ApplicationUser
            {
                UserName = username,
                Role = isFirstUser ? UserRole.Admin : UserRole.User,
                CreatedAt = DateTime.UtcNow,
            };
            var result = await userManager.CreateAsync(user);
            if (!result.Succeeded)
                return Results.Problem("Failed to create proxy user.");
        }

        var nonce = nonceStore.CreateNonce(user.Id);
        return Results.Ok(new ProxyNonceResponse(nonce));
    }

    private static async Task<IResult> GetMe(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager)
    {
        var userId = principal.FindFirstValue(OpenIddictConstants.Claims.Subject);
        if (userId is null) return Results.Unauthorized();
        var user = await userManager.FindByIdAsync(userId);
        if (user is null) return Results.NotFound();
        return Results.Ok(ToDto(user));
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
            return Results.BadRequest("New password must be at least 8 characters.");

        var userId = principal.FindFirstValue(OpenIddictConstants.Claims.Subject);
        if (userId is null) return Results.Unauthorized();
        var user = await userManager.FindByIdAsync(userId);
        if (user is null) return Results.NotFound();

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
            return Results.BadRequest(result.Errors.FirstOrDefault()?.Description ?? "Password change failed.");

        return Results.NoContent();
    }

    private static UserDto ToDto(ApplicationUser user) => new()
    {
        Id = user.Id,
        Username = user.UserName!,
        Role = user.Role,
        CreatedAt = user.CreatedAt,
    };

    public record LoginRequest(string Username, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record ProxyNonceResponse(string Nonce);
}
