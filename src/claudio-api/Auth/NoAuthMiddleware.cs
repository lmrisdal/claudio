using System.Security.Claims;
using OpenIddict.Abstractions;

namespace Claudio.Api.Auth;

/// <summary>
/// When auth is disabled, injects a synthetic admin principal into every request
/// so that RequireAuthorization() and role checks work transparently.
/// </summary>
public class NoAuthMiddleware(RequestDelegate next)
{
    private static readonly ClaimsPrincipal AdminPrincipal = CreateAdminPrincipal();

    public Task Invoke(HttpContext context)
    {
        context.User = AdminPrincipal;
        return next(context);
    }

    private static ClaimsPrincipal CreateAdminPrincipal()
    {
        var identity = new ClaimsIdentity("NoAuth", OpenIddictConstants.Claims.Name, OpenIddictConstants.Claims.Role);
        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Subject, "1"));
        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Name, "admin"));
        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Role, "admin"));
        identity.AddClaim(new Claim("role", "admin"));
        return new ClaimsPrincipal(identity);
    }
}
