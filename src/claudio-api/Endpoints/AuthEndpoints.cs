using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Claudio.Api.Auth;
using Claudio.Api.Data;
using Claudio.Api.Enums;
using Claudio.Api.Models;
using Claudio.Api.Services;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Endpoints;

public static class AuthEndpoints
{
    private const string CsrfRequestCookieName = "claudio.csrf";

    public static RouteGroupBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login", Login).AllowAnonymous();
        group.MapPost("/register", Register).AllowAnonymous();
        group.MapPost("/logout", (Func<HttpContext, Task<IResult>>)Logout).RequireAuthorization();
        group.MapPost("/change-password", ChangePassword).RequireAuthorization();
        group.MapGet("/providers", GetProviders).AllowAnonymous();
        group.MapGet("/github/start", GitHubStart).AllowAnonymous();
        group.MapGet("/github/callback", GitHubCallback).AllowAnonymous();
        group.MapGet("/google/start", GoogleStart).AllowAnonymous();
        group.MapGet("/google/callback", GoogleCallback).AllowAnonymous();
        group.MapGet("/oidc/{providerSlug}/start", OidcStart).AllowAnonymous();
        group.MapGet("/oidc/{providerSlug}/callback", OidcCallback).AllowAnonymous();
        group.MapGet("/me", GetMe).RequireAuthorization();
        group.MapPost("/token/login", TokenLogin).AllowAnonymous();
        group.MapPost("/token/refresh", TokenRefresh).AllowAnonymous();
        group.MapPost("/token/proxy", ProxyTokenLogin).AllowAnonymous();
        group.MapPost("/token/external", ExternalTokenLogin).AllowAnonymous();

        return group;
    }

    private static IResult GetProviders(
        HttpContext httpContext,
        IAntiforgery antiforgery,
        ClaudioConfig config)
    {
        StoreCsrfRequestTokenCookie(httpContext, antiforgery);

        return Results.Ok(new AuthProvidersResponse(
            GetEnabledProviders(config),
            config.Auth.DisableAuth,
            !config.Auth.DisableLocalLogin,
            !config.Auth.DisableUserCreation));
    }

    private static IResult GitHubStart(
        GitHubOAuthStateStore stateStore,
        ClaudioConfig config,
        string? returnTo,
        string? client)
    {
        if (!config.Auth.Github.IsConfigured)
            return Results.NotFound();

        var safeClientType = DetermineClientType(client, returnTo);
        var safeReturnTo = SanitizeReturnTo(returnTo, safeClientType);
        var state = stateStore.CreateState(safeReturnTo, safeClientType);

        var query = new Dictionary<string, string?>
        {
            ["client_id"] = config.Auth.Github.ClientId,
            ["redirect_uri"] = config.Auth.Github.RedirectUri,
            ["scope"] = "read:user user:email",
            ["state"] = state,
        };

        return Results.Redirect(QueryHelpers.AddQueryString("https://github.com/login/oauth/authorize", query));
    }

    private static async Task<IResult> GitHubCallback(
        HttpContext httpContext,
        GitHubOAuthStateStore stateStore,
        GitHubOAuthService gitHubOAuthService,
        ExternalLoginNonceStore externalLoginNonceStore,
        SignInManager<ApplicationUser> signInManager,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        CancellationToken cancellationToken)
    {
        var github = config.Auth.Github;
        if (!github.IsConfigured)
            return Results.NotFound();

        var state = httpContext.Request.Query["state"].ToString();
        var stateResult = stateStore.ConsumeState(state);
        if (stateResult is null)
            return Results.Redirect(BuildAuthRedirect("/login", "GitHub sign-in expired. Please try again."));

        var (returnTo, clientType) = stateResult.Value;
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

            return await FinalizeExternalLoginAsync(httpContext, signInManager, externalLoginNonceStore, user, clientType, returnTo, "GitHub");
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(returnTo, "GitHub sign-in failed."));
        }
    }

    private static IResult GoogleStart(
        GoogleOAuthStateStore stateStore,
        ClaudioConfig config,
        string? returnTo,
        string? client)
    {
        if (!config.Auth.Google.IsConfigured)
            return Results.NotFound();

        var safeClientType = DetermineClientType(client, returnTo);
        var safeReturnTo = SanitizeReturnTo(returnTo, safeClientType);
        var state = stateStore.CreateState(safeReturnTo, safeClientType);

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

        return Results.Redirect(QueryHelpers.AddQueryString("https://accounts.google.com/o/oauth2/v2/auth", query));
    }

    private static async Task<IResult> GoogleCallback(
        HttpContext httpContext,
        GoogleOAuthStateStore stateStore,
        GoogleOAuthService googleOAuthService,
        ExternalLoginNonceStore externalLoginNonceStore,
        SignInManager<ApplicationUser> signInManager,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        CancellationToken cancellationToken)
    {
        var google = config.Auth.Google;
        if (!google.IsConfigured)
            return Results.NotFound();

        var state = httpContext.Request.Query["state"].ToString();
        var stateResult = stateStore.ConsumeState(state);
        if (stateResult is null)
            return Results.Redirect(BuildAuthRedirect("/login", "Google sign-in expired. Please try again."));

        var (returnTo, clientType) = stateResult.Value;
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

            return await FinalizeExternalLoginAsync(httpContext, signInManager, externalLoginNonceStore, user, clientType, returnTo, "Google");
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
        string? client,
        CancellationToken cancellationToken)
    {
        var provider = FindOidcProvider(config, providerSlug);
        if (provider is null)
            return Results.NotFound();

        var safeClientType = DetermineClientType(client, returnTo);
        var safeReturnTo = SanitizeReturnTo(returnTo, safeClientType);
        var state = stateStore.CreateState(provider.Slug, safeReturnTo, safeClientType);

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
            return Results.Redirect(QueryHelpers.AddQueryString(authorizationEndpoint, query));
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
        SignInManager<ApplicationUser> signInManager,
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

        var (storedProviderSlug, returnTo, clientType) = stateResult.Value;
        if (!string.Equals(storedProviderSlug, provider.Slug, StringComparison.OrdinalIgnoreCase))
            return Results.Redirect(BuildAuthRedirect("/login", $"{provider.DisplayName} sign-in expired. Please try again."));

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

            return await FinalizeExternalLoginAsync(httpContext, signInManager, externalLoginNonceStore, user, clientType, returnTo, provider.DisplayName);
        }
        catch
        {
            return Results.Redirect(BuildAuthRedirect(returnTo, $"{provider.DisplayName} sign-in failed."));
        }
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        ClaudioConfig config,
        SignInManager<ApplicationUser> signInManager,
        UserManager<ApplicationUser> userManager)
    {
        if (config.Auth.DisableLocalLogin)
            return Results.NotFound();

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest("Username and password are required.");

        var user = await userManager.FindByNameAsync(request.Username);
        if (user is null)
            return Results.Unauthorized();

        var result = await signInManager.PasswordSignInAsync(user, request.Password, true, false);
        return result.Succeeded ? Results.NoContent() : Results.Unauthorized();
    }

    private static async Task<IResult> Register(
        LoginRequest request,
        ClaudioConfig config,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        AppDbContext db)
    {
        if (config.Auth.DisableLocalLogin || config.Auth.DisableUserCreation)
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

        await signInManager.SignInAsync(user, true);
        return Results.Ok(ToDto(user));
    }

    private static async Task<IResult> Logout(HttpContext httpContext)
    {
        await httpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
        return Results.NoContent();
    }

    private static async Task<IResult> TokenLogin(
        TokenLoginRequest request,
        ClaudioConfig config,
        UserManager<ApplicationUser> userManager,
        DesktopTokenService desktopTokenService,
        CancellationToken cancellationToken)
    {
        if (config.Auth.DisableLocalLogin)
            return Results.NotFound();

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return Results.BadRequest("Username and password are required.");

        var user = await userManager.FindByNameAsync(request.Username);
        if (user is null || !await userManager.CheckPasswordAsync(user, request.Password))
            return Results.Unauthorized();

        var tokens = await desktopTokenService.IssueTokensAsync(user, cancellationToken);
        return Results.Ok(ToTokenResponse(tokens));
    }

    private static async Task<IResult> TokenRefresh(
        TokenRefreshRequest request,
        DesktopTokenService desktopTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
            return Results.BadRequest("Refresh token is required.");

        var tokens = await desktopTokenService.RefreshAsync(request.RefreshToken, cancellationToken);
        return tokens is null ? Results.Unauthorized() : Results.Ok(ToTokenResponse(tokens));
    }

    private static async Task<IResult> ProxyTokenLogin(
        HttpContext httpContext,
        UserManager<ApplicationUser> userManager,
        AppDbContext db,
        ClaudioConfig config,
        DesktopTokenService desktopTokenService,
        CancellationToken cancellationToken)
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
            if (config.Auth.DisableUserCreation || !config.Auth.ProxyAuthAutoCreate)
                return Results.Unauthorized();

            var isFirstUser = !await db.Users.AnyAsync(cancellationToken);
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

        var tokens = await desktopTokenService.IssueTokensAsync(user, cancellationToken);
        return Results.Ok(ToTokenResponse(tokens));
    }

    private static async Task<IResult> ExternalTokenLogin(
        ExternalTokenLoginRequest request,
        ExternalLoginNonceStore externalLoginNonceStore,
        UserManager<ApplicationUser> userManager,
        DesktopTokenService desktopTokenService,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Nonce))
            return Results.BadRequest("Nonce is required.");

        var userId = externalLoginNonceStore.ConsumeNonce(request.Nonce);
        if (userId is null)
            return Results.Unauthorized();

        var user = await userManager.FindByIdAsync(userId.Value.ToString());
        if (user is null)
            return Results.Unauthorized();

        var tokens = await desktopTokenService.IssueTokensAsync(user, cancellationToken);
        return Results.Ok(ToTokenResponse(tokens));
    }

    private static async Task<IResult> GetMe(
        HttpContext httpContext,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager,
        IAntiforgery antiforgery)
    {
        var userId = principal.GetUserId();
        if (userId is null)
            return Results.Unauthorized();

        var user = await userManager.FindByIdAsync(userId.Value.ToString());
        if (user is null)
            return Results.NotFound();

        StoreCsrfRequestTokenCookie(httpContext, antiforgery);
        return Results.Ok(ToDto(user));
    }

    private static void StoreCsrfRequestTokenCookie(HttpContext httpContext, IAntiforgery antiforgery)
    {
        var tokens = antiforgery.GetAndStoreTokens(httpContext);
        if (string.IsNullOrWhiteSpace(tokens.RequestToken))
            return;

        httpContext.Response.Cookies.Append(CsrfRequestCookieName, tokens.RequestToken, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Lax,
            Secure = httpContext.Request.IsHttps,
        });
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaudioConfig config,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> userManager,
        DesktopTokenService desktopTokenService,
        CancellationToken cancellationToken)
    {
        if (config.Auth.DisableLocalLogin)
            return Results.NotFound();

        if (string.IsNullOrWhiteSpace(request.NewPassword) || request.NewPassword.Length < 8)
            return Results.BadRequest("New password must be at least 8 characters.");

        var userId = principal.GetUserId();
        if (userId is null)
            return Results.Unauthorized();

        var user = await userManager.FindByIdAsync(userId.Value.ToString());
        if (user is null)
            return Results.NotFound();

        var result = await userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
            return Results.BadRequest(result.Errors.FirstOrDefault()?.Description ?? "Password change failed.");

        await desktopTokenService.RevokeAllAsync(user.Id, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> FinalizeExternalLoginAsync(
        HttpContext httpContext,
        SignInManager<ApplicationUser> signInManager,
        ExternalLoginNonceStore externalLoginNonceStore,
        ApplicationUser user,
        string clientType,
        string returnTo,
        string providerName)
    {
        if (string.Equals(clientType, "desktop", StringComparison.OrdinalIgnoreCase))
            return Results.Redirect(BuildExternalLoginRedirect(returnTo, providerName, externalLoginNonceStore.CreateNonce(user.Id)));

        await signInManager.SignInAsync(user, true);
        return Results.Redirect(returnTo);
    }

    private static UserDto ToDto(ApplicationUser user) => new()
    {
        Id = user.Id,
        Username = user.UserName!,
        Role = user.Role,
        CreatedAt = user.CreatedAt,
    };

    private static TokenResponse ToTokenResponse(DesktopTokenService.TokenPair tokens) =>
        new(tokens.AccessToken, tokens.RefreshToken);

    private static string SanitizeReturnTo(string? returnTo, string clientType)
    {
        if (string.IsNullOrWhiteSpace(returnTo))
            return clientType == "desktop" ? "claudio://auth/callback" : "/auth/callback";

        if (clientType == "desktop")
        {
            if (returnTo.StartsWith("claudio://", StringComparison.OrdinalIgnoreCase))
                return returnTo;

            if (returnTo.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
                return returnTo;

            return "claudio://auth/callback";
        }

        if (!returnTo.StartsWith('/') || returnTo.StartsWith("//", StringComparison.Ordinal))
            return "/login";

        return returnTo;
    }

    private static string DetermineClientType(string? clientType, string? returnTo)
    {
        if (string.Equals(clientType, "desktop", StringComparison.OrdinalIgnoreCase))
            return "desktop";

        if (!string.IsNullOrWhiteSpace(returnTo) &&
            (returnTo.StartsWith("claudio://", StringComparison.OrdinalIgnoreCase)
             || returnTo.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase)))
        {
            return "desktop";
        }

        return "web";
    }

    private static string BuildAuthRedirect(string returnTo, string error) =>
        QueryHelpers.AddQueryString(returnTo, new Dictionary<string, string?>
        {
            ["error"] = error,
        });

    private static string BuildExternalLoginRedirect(string returnTo, string providerName, string nonce) =>
        QueryHelpers.AddQueryString(returnTo, new Dictionary<string, string?>
        {
            ["nonce"] = nonce,
            ["provider"] = providerName,
        });

    private static List<AuthProviderItem> GetEnabledProviders(ClaudioConfig config)
    {
        var providers = new List<AuthProviderItem>();

        if (config.Auth.Github.IsConfigured)
            providers.Add(new AuthProviderItem("github", "GitHub", "/provider-logos/github.svg", "/api/auth/github/start?client=web&returnTo=/auth/callback"));

        if (config.Auth.Google.IsConfigured)
            providers.Add(new AuthProviderItem("google", "Google", "/provider-logos/google.svg", "/api/auth/google/start?client=web&returnTo=/auth/callback"));

        foreach (var oidc in config.Auth.ConfiguredOidcProviders())
            providers.Add(new AuthProviderItem(oidc.Slug, oidc.DisplayName, oidc.LogoUrl, $"/api/auth/oidc/{Uri.EscapeDataString(oidc.Slug)}/start?client=web&returnTo=/auth/callback"));

        return providers;
    }

    private static OidcProviderConfig? FindOidcProvider(ClaudioConfig config, string providerSlug) =>
        config.Auth.FindOidcProvider(providerSlug);

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
    public record TokenLoginRequest(string Username, string Password);
    public record TokenRefreshRequest(string RefreshToken);
    public record ExternalTokenLoginRequest(string Nonce);
    public record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken);
    public record AuthProviderItem(string Slug, string DisplayName, string? LogoUrl, string StartUrl);
    public record AuthProvidersResponse(List<AuthProviderItem> Providers, bool AuthDisabled, bool LocalLoginEnabled, bool UserCreationEnabled);
}
