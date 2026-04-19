using System.Security.Claims;
using Claudio.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;

namespace Claudio.Api.Auth;

public sealed class ApplicationUserClaimsTransformation(UserManager<ApplicationUser> userManager) : IClaimsTransformation
{
    public async Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        if (principal.Identity is not ClaimsIdentity identity || !identity.IsAuthenticated)
            return principal;

        if (identity.HasClaim(claim => claim.Type == "role" || claim.Type == ClaimTypes.Role))
            return principal;

        var userId = principal.GetUserId();
        if (userId is null)
            return principal;

        var user = await userManager.FindByIdAsync(userId.Value.ToString());
        if (user is null)
            return principal;

        var role = user.Role.ToString().ToLowerInvariant();
        identity.AddClaim(new Claim(ClaimTypes.Role, role));
        identity.AddClaim(new Claim("role", role));
        return principal;
    }
}
