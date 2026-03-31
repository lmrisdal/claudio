using System.Security.Claims;
using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Shared.Enums;
using Claudio.Shared.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;
using System.Text;

namespace Claudio.Api.Endpoints;

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", Register);
        group.MapPost("/remote", ProxyLogin);
        group.MapGet("/providers", GetProviders).AllowAnonymous();
        group.MapGet("/github/start", GitHubStart);
        group.MapGet("/github/callback", GitHubCallback);
        group.MapGet("/google/start", GoogleStart);
        group.MapGet("/google/callback", GoogleCallback);
        group.MapGet("/oidc/{providerSlug}/start", OidcStart);
        group.MapGet("/oidc/{providerSlug}/callback", OidcCallback);
        group.MapGet("/me", GetMe).RequireAuthorization();
        group.MapPut("/change-password", ChangePassword).RequireAuthorization();

        return group;
    }

    private static IResult GetProviders(ClaudioConfig config) =>
        Results.Ok(new AuthProvidersResponse(
            GetEnabledProviders(config),
            !config.Auth.DisableLocalLogin,
            !config.Auth.DisableUserCreation));

    private static IResult GitHubStart(
        GitHubOAuthStateStore stateStore,
        ClaudioConfig config,
        string? returnTo)
    {
        if (!config.Auth.Github.IsConfigured)
            return Results.NotFound();

        var safeReturnTo = SanitizeReturnTo(returnTo);
        var state = stateStore.CreateState(safeReturnTo);

        var query = new Dictionary<string, string?>
        {
            ["client_id"] = config.Auth.Github.ClientId,
            ["redirect_uri"] = config.Auth.Github.RedirectUri,
            ["scope"] = "read:user user:email",
            ["state"] = state,
        };

        var authorizeUrl = QueryHelpers.AddQueryString("https://github.com/login/oauth/authorize", query);
        return Results.Redirect(authorizeUrl);
    }

    private static async Task<IResult> GitHubCallback(
        HttpContext httpContext,
        GitHubOAuthStateStore stateStore,
        GitHubOAuthService gitHubOAuthService,
        ExternalLoginNonceStore externalLoginNonceStore,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        CancellationToken cancellationToken)
    {
        var github = config.Auth.Github;
        if (!github.IsConfigured)
            return Results.NotFound();

        var state = httpContext.Request.Query["state"].ToString();
        var returnTo = stateStore.ConsumeState(state);
        if (returnTo is null)
            return Results.Redirect(BuildAuthRedirect("/login", "GitHub sign-in expired. Please try again."));

        if (!string.IsNullOrWhiteSpace(httpContext.Request.Query["error"]))
        {
            var error = httpContext.Request.Query["error_description"].ToString();
            if (string.IsNullOrWhiteSpace(error))
                error = "GitHub sign-in was cancelled.";

            return Results.Redirect(BuildAuthRedirect(returnTo, error));
        }

        var code = httpContext.Request.Query["code"].ToString();
        if (string.IsNullOrWhiteSpace(code))
            return Results.Redirect(BuildAuthRedirect(returnTo, "GitHub did not return an authorization code."));

        try
        {
            var gitHubUser = await gitHubOAuthService.ExchangeCodeAsync(code, config, cancellationToken);
            var user = await userManager.FindByLoginAsync("GitHub", gitHubUser.ProviderKey);

            if (user is null)
            {
                if (config.Auth.DisableUserCreation)
                    return Results.Redirect(BuildAuthRedirect(returnTo, "GitHub sign-in is limited to existing users."));

                var isFirstUser = !await db.Users.AnyAsync(cancellationToken);
                var username = await GenerateUniqueUsernameAsync(gitHubUser.Login, userManager);
                user = new ApplicationUser
                {
                    UserName = username,
                    Email = gitHubUser.Email,
                    EmailConfirmed = gitHubUser.EmailVerified,
                    Role = isFirstUser ? UserRole.Admin : UserRole.User,
                    CreatedAt = DateTime.UtcNow,
                };

                var createResult = await userManager.CreateAsync(user);
                if (!createResult.Succeeded)
                {
                    return Results.Redirect(BuildAuthRedirect(
                        returnTo,
                        createResult.Errors.FirstOrDefault()?.Description ?? "Failed to create GitHub user."));
                }

                var loginResult = await userManager.AddLoginAsync(user, new UserLoginInfo("GitHub", gitHubUser.ProviderKey, "GitHub"));
                if (!loginResult.Succeeded)
                {
                    await userManager.DeleteAsync(user);
                    return Results.Redirect(BuildAuthRedirect(
                        returnTo,
                        loginResult.Errors.FirstOrDefault()?.Description ?? "Failed to link GitHub account."));
                }
            }

            return Results.Redirect(BuildExternalLoginRedirect(returnTo, "GitHub", externalLoginNonceStore.CreateNonce(user.Id)));
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(returnTo, "GitHub sign-in failed."));
        }
    }

    private static IResult GoogleStart(
        GoogleOAuthStateStore stateStore,
        ClaudioConfig config,
        string? returnTo)
    {
        if (!config.Auth.Google.IsConfigured)
            return Results.NotFound();

        var safeReturnTo = SanitizeReturnTo(returnTo);
        var state = stateStore.CreateState(safeReturnTo);

        var query = new Dictionary<string, string?>
        {
            ["client_id"] = config.Auth.Google.ClientId,
            ["redirect_uri"] = config.Auth.Google.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = "openid email profile",
            ["state"] = state,
            ["access_type"] = "online",
            ["prompt"] = "select_account",
        };

        var authorizeUrl = QueryHelpers.AddQueryString("https://accounts.google.com/o/oauth2/v2/auth", query);
        return Results.Redirect(authorizeUrl);
    }

    private static async Task<IResult> GoogleCallback(
        HttpContext httpContext,
        GoogleOAuthStateStore stateStore,
        GoogleOAuthService googleOAuthService,
        ExternalLoginNonceStore externalLoginNonceStore,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        CancellationToken cancellationToken)
    {
        var google = config.Auth.Google;
        if (!google.IsConfigured)
            return Results.NotFound();

        var state = httpContext.Request.Query["state"].ToString();
        var returnTo = stateStore.ConsumeState(state);
        if (returnTo is null)
            return Results.Redirect(BuildAuthRedirect("/login", "Google sign-in expired. Please try again."));

        if (!string.IsNullOrWhiteSpace(httpContext.Request.Query["error"]))
        {
            var error = httpContext.Request.Query["error_description"].ToString();
            if (string.IsNullOrWhiteSpace(error))
                error = "Google sign-in was cancelled.";

            return Results.Redirect(BuildAuthRedirect(returnTo, error));
        }

        var code = httpContext.Request.Query["code"].ToString();
        if (string.IsNullOrWhiteSpace(code))
            return Results.Redirect(BuildAuthRedirect(returnTo, "Google did not return an authorization code."));

        try
        {
            var googleUser = await googleOAuthService.ExchangeCodeAsync(code, config, cancellationToken);
            var user = await userManager.FindByLoginAsync("Google", googleUser.ProviderKey);

            if (user is null)
            {
                if (googleUser.EmailVerified)
                    user = await userManager.FindByEmailAsync(googleUser.Email);

                if (user is not null)
                {
                    var existingLinkResult = await userManager.AddLoginAsync(user, new UserLoginInfo("Google", googleUser.ProviderKey, "Google"));
                    if (!existingLinkResult.Succeeded)
                    {
                        return Results.Redirect(BuildAuthRedirect(
                            returnTo,
                            existingLinkResult.Errors.FirstOrDefault()?.Description ?? "Failed to link Google account."));
                    }
                }
                else
                {
                    if (config.Auth.DisableUserCreation)
                        return Results.Redirect(BuildAuthRedirect(returnTo, "Google sign-in is limited to existing users."));

                    var isFirstUser = !await db.Users.AnyAsync(cancellationToken);
                    var username = await GenerateUniqueUsernameAsync(googleUser.Email.Split('@')[0], userManager);
                    user = new ApplicationUser
                    {
                        UserName = username,
                        Email = googleUser.Email,
                        EmailConfirmed = googleUser.EmailVerified,
                        Role = isFirstUser ? UserRole.Admin : UserRole.User,
                        CreatedAt = DateTime.UtcNow,
                    };

                    var createResult = await userManager.CreateAsync(user);
                    if (!createResult.Succeeded)
                    {
                        return Results.Redirect(BuildAuthRedirect(
                            returnTo,
                            createResult.Errors.FirstOrDefault()?.Description ?? "Failed to create Google user."));
                    }

                    var loginResult = await userManager.AddLoginAsync(user, new UserLoginInfo("Google", googleUser.ProviderKey, "Google"));
                    if (!loginResult.Succeeded)
                    {
                        await userManager.DeleteAsync(user);
                        return Results.Redirect(BuildAuthRedirect(
                            returnTo,
                            loginResult.Errors.FirstOrDefault()?.Description ?? "Failed to link Google account."));
                    }
                }
            }

            return Results.Redirect(BuildExternalLoginRedirect(returnTo, "Google", externalLoginNonceStore.CreateNonce(user.Id)));
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(returnTo, "Google sign-in failed."));
        }
    }

    private static async Task<IResult> OidcStart(
        string providerSlug,
        OidcStateStore stateStore,
        OidcOAuthService oidcOAuthService,
        ClaudioConfig config,
        string? returnTo,
        CancellationToken cancellationToken)
    {
        var provider = FindOidcProvider(config, providerSlug);
        if (provider is null)
            return Results.NotFound();

        var safeReturnTo = SanitizeReturnTo(returnTo);
        var state = stateStore.CreateState(provider.Slug, safeReturnTo);

        var query = new Dictionary<string, string?>
        {
            ["client_id"] = provider.ClientId,
            ["redirect_uri"] = provider.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = provider.Scope,
            ["state"] = state,
        };

        try
        {
            var authorizationEndpoint = await oidcOAuthService.GetAuthorizationEndpointAsync(provider, cancellationToken);
            var authorizeUrl = QueryHelpers.AddQueryString(authorizationEndpoint, query);
            return Results.Redirect(authorizeUrl);
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(safeReturnTo, $"{provider.DisplayName} sign-in is not configured correctly."));
        }
    }

    private static async Task<IResult> OidcCallback(
        string providerSlug,
        HttpContext httpContext,
        OidcStateStore stateStore,
        OidcOAuthService oidcOAuthService,
        ExternalLoginNonceStore externalLoginNonceStore,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        CancellationToken cancellationToken)
    {
        var provider = FindOidcProvider(config, providerSlug);
        if (provider is null)
            return Results.NotFound();

        var state = httpContext.Request.Query["state"].ToString();
        var stateResult = stateStore.ConsumeState(state);
        if (stateResult is null || !string.Equals(stateResult.Value.ProviderSlug, provider.Slug, StringComparison.OrdinalIgnoreCase))
            return Results.Redirect(BuildAuthRedirect("/login", $"{provider.DisplayName} sign-in expired. Please try again."));

        var returnTo = stateResult.Value.ReturnTo;
        if (!string.IsNullOrWhiteSpace(httpContext.Request.Query["error"]))
        {
            var error = httpContext.Request.Query["error_description"].ToString();
            if (string.IsNullOrWhiteSpace(error))
                error = $"{provider.DisplayName} sign-in was cancelled.";

            return Results.Redirect(BuildAuthRedirect(returnTo, error));
        }

        var code = httpContext.Request.Query["code"].ToString();
        if (string.IsNullOrWhiteSpace(code))
            return Results.Redirect(BuildAuthRedirect(returnTo, $"{provider.DisplayName} did not return an authorization code."));

        try
        {
            var oidcUser = await oidcOAuthService.ExchangeCodeAsync(provider, code, cancellationToken);
            var user = await userManager.FindByLoginAsync(provider.Slug, oidcUser.ProviderKey);

            if (user is null && !string.IsNullOrWhiteSpace(oidcUser.Email) && oidcUser.EmailVerified)
                user = await userManager.FindByEmailAsync(oidcUser.Email);

            if (user is not null)
            {
                var existingLogins = await userManager.GetLoginsAsync(user);
                if (!existingLogins.Any(x =>
                    string.Equals(x.LoginProvider, provider.Slug, StringComparison.Ordinal) &&
                    string.Equals(x.ProviderKey, oidcUser.ProviderKey, StringComparison.Ordinal)))
                {
                    var linkResult = await userManager.AddLoginAsync(user, new UserLoginInfo(provider.Slug, oidcUser.ProviderKey, provider.DisplayName));
                    if (!linkResult.Succeeded)
                    {
                        return Results.Redirect(BuildAuthRedirect(
                            returnTo,
                            linkResult.Errors.FirstOrDefault()?.Description ?? $"Failed to link {provider.DisplayName} account."));
                    }
                }
            }
            else
            {
                if (config.Auth.DisableUserCreation)
                    return Results.Redirect(BuildAuthRedirect(returnTo, $"{provider.DisplayName} sign-in is limited to existing users."));

                var isFirstUser = !await db.Users.AnyAsync(cancellationToken);
                var usernameBase = oidcUser.Username ?? oidcUser.Email ?? provider.DisplayName;
                var username = await GenerateUniqueUsernameAsync(usernameBase, userManager);
                user = new ApplicationUser
                {
                    UserName = username,
                    Email = oidcUser.Email,
                    EmailConfirmed = oidcUser.EmailVerified,
                    Role = isFirstUser ? UserRole.Admin : UserRole.User,
                    CreatedAt = DateTime.UtcNow,
                };

                var createResult = await userManager.CreateAsync(user);
                if (!createResult.Succeeded)
                {
                    return Results.Redirect(BuildAuthRedirect(
                        returnTo,
                        createResult.Errors.FirstOrDefault()?.Description ?? $"Failed to create {provider.DisplayName} user."));
                }

                var loginResult = await userManager.AddLoginAsync(user, new UserLoginInfo(provider.Slug, oidcUser.ProviderKey, provider.DisplayName));
                if (!loginResult.Succeeded)
                {
                    await userManager.DeleteAsync(user);
                    return Results.Redirect(BuildAuthRedirect(
                        returnTo,
                        loginResult.Errors.FirstOrDefault()?.Description ?? $"Failed to link {provider.DisplayName} account."));
                }
            }

            return Results.Redirect(BuildExternalLoginRedirect(returnTo, provider.DisplayName, externalLoginNonceStore.CreateNonce(user.Id)));
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(returnTo, $"{provider.DisplayName} sign-in failed."));
        }
    }

    private static async Task<IResult> Register(
        LoginRequest request,
        ClaudioConfig config,
        UserManager<ApplicationUser> userManager,
        AppDbContext db)
    {
        if (config.Auth.DisableLocalLogin)
            return Results.NotFound();

        if (config.Auth.DisableUserCreation)
            return Results.NotFound();

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
            if (config.Auth.DisableUserCreation)
                return Results.Unauthorized();

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
        ClaudioConfig config,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager)
    {
        if (config.Auth.DisableLocalLogin)
            return Results.NotFound();

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

    private static string SanitizeReturnTo(string? returnTo)
    {
        if (string.IsNullOrWhiteSpace(returnTo) || !returnTo.StartsWith('/'))
            return "/login";

        if (returnTo.StartsWith("//", StringComparison.Ordinal))
            return "/login";

        return returnTo;
    }

    private static string BuildAuthRedirect(string returnTo, string error) =>
        QueryHelpers.AddQueryString(SanitizeReturnTo(returnTo), new Dictionary<string, string?>
        {
            ["error"] = error,
        });

    private static string BuildExternalLoginRedirect(string returnTo, string providerName, string nonce) =>
        QueryHelpers.AddQueryString(SanitizeReturnTo(returnTo), new Dictionary<string, string?>
        {
            ["external_nonce"] = nonce,
            ["provider"] = providerName,
        });

    private static List<AuthProviderItem> GetEnabledProviders(ClaudioConfig config)
    {
        var providers = new List<AuthProviderItem>();

        if (config.Auth.Github.IsConfigured)
        {
            providers.Add(new AuthProviderItem(
                "github",
                "GitHub",
                "/provider-logos/github.svg",
                "/api/auth/github/start?returnTo=/auth/callback"));
        }

        if (config.Auth.Google.IsConfigured)
        {
            providers.Add(new AuthProviderItem(
                "google",
                "Google",
                "/provider-logos/google.svg",
                "/api/auth/google/start?returnTo=/auth/callback"));
        }

        var oidc = config.Auth.OidcProvider;
        if (oidc.IsConfigured)
        {
            providers.Add(new AuthProviderItem(
                oidc.Slug,
                oidc.DisplayName,
                oidc.LogoUrl,
                $"/api/auth/oidc/{Uri.EscapeDataString(oidc.Slug)}/start?returnTo=/auth/callback"));
        }

        return providers;
    }

    private static OidcProviderConfig? FindOidcProvider(ClaudioConfig config, string providerSlug)
    {
        var oidc = config.Auth.OidcProvider;
        return oidc.IsConfigured && string.Equals(oidc.Slug, providerSlug, StringComparison.OrdinalIgnoreCase)
            ? oidc
            : null;
    }

    private static async Task<string> GenerateUniqueUsernameAsync(string baseName, UserManager<ApplicationUser> userManager)
    {
        var normalizedBase = NormalizeUsername(baseName);
        var candidate = normalizedBase;
        var suffix = 1;

        while (await userManager.FindByNameAsync(candidate) is not null)
        {
            candidate = $"{normalizedBase}-{suffix}";
            suffix++;
        }

        return candidate;
    }

    private static string NormalizeUsername(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return $"user-{Guid.NewGuid():N}"[..20];

        var builder = new StringBuilder(value.Length);
        foreach (var ch in value.Trim())
        {
            if (char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.')
                builder.Append(char.ToLowerInvariant(ch));
        }

        if (builder.Length == 0)
            return $"user-{Guid.NewGuid():N}"[..20];

        var normalized = builder.ToString().Trim('-', '_', '.');
        if (string.IsNullOrWhiteSpace(normalized))
            normalized = $"user-{Guid.NewGuid():N}"[..20];

        return normalized.Length <= 32 ? normalized : normalized[..32];
    }

    public record LoginRequest(string Username, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record ProxyNonceResponse(string Nonce);
    public record AuthProviderItem(string Slug, string DisplayName, string? LogoUrl, string StartUrl);
    public record AuthProvidersResponse(List<AuthProviderItem> Providers, bool LocalLoginEnabled, bool UserCreationEnabled);
}
