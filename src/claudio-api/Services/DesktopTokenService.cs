using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Claudio.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace Claudio.Api.Services;

public sealed class DesktopTokenService(AppDbContext db, SecurityKey signingKey)
{
    private static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    public async Task<TokenPair> IssueTokensAsync(ApplicationUser user, CancellationToken cancellationToken = default)
    {
        var refreshToken = CreateOpaqueToken();
        var refreshTokenEntity = new DesktopRefreshToken
        {
            UserId = user.Id,
            TokenHash = ComputeHash(refreshToken),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.Add(RefreshTokenLifetime),
        };

        db.DesktopRefreshTokens.Add(refreshTokenEntity);
        await db.SaveChangesAsync(cancellationToken);

        return new TokenPair(CreateAccessToken(user), refreshToken);
    }

    public async Task<TokenPair?> RefreshAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        var tokenHash = ComputeHash(refreshToken);
        var existingToken = await db.DesktopRefreshTokens
            .Include(token => token.User)
            .SingleOrDefaultAsync(token => token.TokenHash == tokenHash, cancellationToken);

        if (existingToken is null || !IsActive(existingToken))
            return null;

        var replacementValue = CreateOpaqueToken();
        var replacement = new DesktopRefreshToken
        {
            UserId = existingToken.UserId,
            TokenHash = ComputeHash(replacementValue),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.Add(RefreshTokenLifetime),
        };

        existingToken.RevokedAt = DateTime.UtcNow;
        db.DesktopRefreshTokens.Add(replacement);
        await db.SaveChangesAsync(cancellationToken);

        existingToken.ReplacedByTokenId = replacement.Id;
        await db.SaveChangesAsync(cancellationToken);

        return new TokenPair(CreateAccessToken(existingToken.User), replacementValue);
    }

    public async Task RevokeAllAsync(int userId, CancellationToken cancellationToken = default)
    {
        var activeTokens = await db.DesktopRefreshTokens
            .Where(token => token.UserId == userId && token.RevokedAt == null && token.ExpiresAt > DateTime.UtcNow)
            .ToListAsync(cancellationToken);

        if (activeTokens.Count == 0)
            return;

        var revokedAt = DateTime.UtcNow;
        foreach (var token in activeTokens)
            token.RevokedAt = revokedAt;

        await db.SaveChangesAsync(cancellationToken);
    }

    private string CreateAccessToken(ApplicationUser user)
    {
        var now = DateTime.UtcNow;
        var expiresAt = now.Add(AccessTokenLifetime);
        var role = user.Role.ToString().ToLowerInvariant();
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.UserName ?? string.Empty),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.UserName ?? string.Empty),
            new Claim(ClaimTypes.Role, role),
            new Claim("role", role),
        };

        var token = new JwtSecurityToken(
            claims: claims,
            notBefore: now,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static bool IsActive(DesktopRefreshToken token) =>
        token.RevokedAt is null && token.ExpiresAt > DateTime.UtcNow;

    private static string CreateOpaqueToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(48));

    private static string ComputeHash(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }

    public sealed record TokenPair(string AccessToken, string RefreshToken);
}
