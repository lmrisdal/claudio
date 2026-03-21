using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Claudio.Api.Data;
using Claudio.Shared.Models;
using Microsoft.IdentityModel.Tokens;

namespace Claudio.Api.Auth;

public class TokenService(ClaudioConfig config)
{
    public string GenerateToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config.Auth.JwtSecret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
        };

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(config.Auth.TokenExpiryHours),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
