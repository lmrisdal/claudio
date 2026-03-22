using System.Security.Claims;
using Claudio.Api.Auth;
using Claudio.Api.Data;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Endpoints;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", Register);
        group.MapPost("/login", Login);
        group.MapGet("/proxy", ProxyLogin);
        group.MapGet("/me", GetMe).RequireAuthorization();
        group.MapPut("/change-password", ChangePassword).RequireAuthorization();

        return group;
    }

    private static async Task<IResult> Register(
        LoginRequest request,
        AppDbContext db,
        TokenService tokenService)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest("Username and password are required.");

        if (request.Password.Length < 8)
            return Results.BadRequest("Password must be at least 8 characters.");

        if (await db.Users.AnyAsync(u => u.Username == request.Username))
            return Results.Conflict("Username already taken.");

        var isFirstUser = !await db.Users.AnyAsync();

        var user = new User
        {
            Username = request.Username,
            PasswordHash = PasswordHasher.Hash(request.Password),
            Role = isFirstUser ? UserRole.Admin : UserRole.User,
            CreatedAt = DateTime.UtcNow,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var token = tokenService.GenerateToken(user);
        return Results.Ok(new AuthResponse(token, ToDto(user)));
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        AppDbContext db,
        TokenService tokenService)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);

        if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            return Results.Unauthorized();

        var token = tokenService.GenerateToken(user);
        return Results.Ok(new AuthResponse(token, ToDto(user)));
    }

    private static async Task<IResult> ProxyLogin(
        HttpContext httpContext,
        AppDbContext db,
        TokenService tokenService,
        ClaudioConfig config)
    {
        var header = config.Auth.ProxyAuthHeader;
        if (string.IsNullOrWhiteSpace(header))
            return Results.NotFound();

        var username = httpContext.Request.Headers[header].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(username))
            return Results.Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null)
        {
            if (!config.Auth.ProxyAuthAutoCreate)
                return Results.Unauthorized();

            var isFirstUser = !await db.Users.AnyAsync();
            user = new User
            {
                Username = username,
                PasswordHash = "",
                Role = isFirstUser ? UserRole.Admin : UserRole.User,
                CreatedAt = DateTime.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        var token = tokenService.GenerateToken(user);
        return Results.Ok(new AuthResponse(token, ToDto(user)));
    }

    private static async Task<IResult> GetMe(ClaimsPrincipal principal, AppDbContext db)
    {
        var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await db.Users.FindAsync(userId);
        if (user is null) return Results.NotFound();
        return Results.Ok(ToDto(user));
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TokenService tokenService)
    {
        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
            return Results.BadRequest("New password must be at least 8 characters.");

        var userId = int.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await db.Users.FindAsync(userId);
        if (user is null) return Results.NotFound();

        if (!PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash))
            return Results.BadRequest("Current password is incorrect.");

        user.PasswordHash = PasswordHasher.Hash(request.NewPassword);
        await db.SaveChangesAsync();

        var token = tokenService.GenerateToken(user);
        return Results.Ok(new AuthResponse(token, ToDto(user)));
    }

    private static UserDto ToDto(User user) => new()
    {
        Id = user.Id,
        Username = user.Username,
        Role = user.Role,
        CreatedAt = user.CreatedAt,
    };

    public record LoginRequest(string Username, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record AuthResponse(string Token, UserDto User);
}
