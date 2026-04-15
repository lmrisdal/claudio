using System.Security.Claims;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Api.Models;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;

namespace Claudio.Api.Endpoints;

public static class ConnectEndpoints
{
    public const string ProxyNonceGrantType = "urn:claudio:proxy_nonce";
    public const string ExternalLoginNonceGrantType = "urn:claudio:external_login_nonce";

    public static IEndpointRouteBuilder MapConnectEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/connect/token", Token).AllowAnonymous();
        app.MapGet("/connect/userinfo", UserInfo).AllowAnonymous();
        return app;
    }

    private static async Task<IResult> Token(
        HttpContext httpContext,
        ClaudioConfig config,
        UserManager<ApplicationUser> userManager,
        ProxyNonceStore nonceStore,
        ExternalLoginNonceStore externalLoginNonceStore)
    {
        var request = httpContext.GetOpenIddictServerRequest()
            ?? throw new InvalidOperationException("OpenIddict request cannot be retrieved.");

        if (request.GrantType == OpenIddictConstants.GrantTypes.Password)
        {
            if (config.Auth.DisableLocalLogin)
                return InvalidGrant("Username/password login is disabled.");

            var user = await userManager.FindByNameAsync(request.Username!);
            if (user is null || !await userManager.CheckPasswordAsync(user, request.Password!))
                return InvalidGrant("Invalid username or password.");

            return SignIn(user, request.GetScopes());
        }

        if (request.GrantType == OpenIddictConstants.GrantTypes.RefreshToken)
        {
            var authResult = await httpContext.AuthenticateAsync(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
            var userId = authResult.Principal?.GetClaim(OpenIddictConstants.Claims.Subject);
            var user = userId is not null ? await userManager.FindByIdAsync(userId) : null;

            if (user is null)
                return InvalidGrant("The refresh token is no longer valid.");

            return SignIn(user, authResult.Principal!.GetScopes());
        }

        if (request.GrantType == ProxyNonceGrantType)
        {
            string? nonce = (string?)request["nonce"];
            if (string.IsNullOrWhiteSpace(nonce))
                return InvalidGrant("Missing nonce.");

            var userId = nonceStore.ConsumeNonce(nonce);
            if (userId is null)
                return InvalidGrant("Invalid or expired nonce.");

            var user = await userManager.FindByIdAsync(userId.Value.ToString());
            if (user is null)
                return InvalidGrant("User not found.");

            return SignIn(user, request.GetScopes());
        }

        if (request.GrantType == ExternalLoginNonceGrantType)
        {
            string? nonce = (string?)request["nonce"];
            if (string.IsNullOrWhiteSpace(nonce))
                return InvalidGrant("Missing nonce.");

            var userId = externalLoginNonceStore.ConsumeNonce(nonce);
            if (userId is null)
                return InvalidGrant("Invalid or expired nonce.");

            var user = await userManager.FindByIdAsync(userId.Value.ToString());
            if (user is null)
                return InvalidGrant("User not found.");

            return SignIn(user, request.GetScopes());
        }

        throw new InvalidOperationException($"Unsupported grant type: {request.GrantType}");
    }

    private static async Task<IResult> UserInfo(HttpContext httpContext, UserManager<ApplicationUser> userManager)
    {
        var authResult = await httpContext.AuthenticateAsync(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
        var userId = authResult.Principal?.GetClaim(OpenIddictConstants.Claims.Subject);
        var user = userId is not null ? await userManager.FindByIdAsync(userId) : null;

        if (user is null)
        {
            return Results.Challenge(
                authenticationSchemes: [OpenIddictServerAspNetCoreDefaults.AuthenticationScheme]);
        }

        return Results.Ok(new Dictionary<string, object>
        {
            [OpenIddictConstants.Claims.Subject] = user.Id.ToString(),
            [OpenIddictConstants.Claims.Name] = user.UserName!,
            ["role"] = user.Role.ToString().ToLower(),
        });
    }

    private static IResult SignIn(ApplicationUser user, IEnumerable<string> scopes)
    {
        var identity = new ClaimsIdentity(
            authenticationType: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme,
            nameType: OpenIddictConstants.Claims.Name,
            roleType: OpenIddictConstants.Claims.Role);

        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Subject, user.Id.ToString())
            .SetDestinations(OpenIddictConstants.Destinations.AccessToken, OpenIddictConstants.Destinations.IdentityToken));
        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Name, user.UserName!)
            .SetDestinations(OpenIddictConstants.Destinations.AccessToken, OpenIddictConstants.Destinations.IdentityToken));
        identity.AddClaim(new Claim(OpenIddictConstants.Claims.Role, user.Role.ToString().ToLower())
            .SetDestinations(OpenIddictConstants.Destinations.AccessToken, OpenIddictConstants.Destinations.IdentityToken));

        var principal = new ClaimsPrincipal(identity);
        principal.SetScopes(scopes);

        return Results.SignIn(principal,
            authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    }

    private static IResult InvalidGrant(string description) =>
        Results.Forbid(
            authenticationSchemes: [OpenIddictServerAspNetCoreDefaults.AuthenticationScheme],
            properties: new AuthenticationProperties(new Dictionary<string, string?>
            {
                [OpenIddictServerAspNetCoreConstants.Properties.Error] = OpenIddictConstants.Errors.InvalidGrant,
                [OpenIddictServerAspNetCoreConstants.Properties.ErrorDescription] = description,
            }));
}
