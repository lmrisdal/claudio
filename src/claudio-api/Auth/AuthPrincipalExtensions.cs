using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Claudio.Api.Auth;

public static class AuthPrincipalExtensions
{
    public static int? GetUserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? principal.FindFirstValue("sub");

        return int.TryParse(value, out var userId) ? userId : null;
    }
}
