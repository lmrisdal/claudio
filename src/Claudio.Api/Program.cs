using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
using Claudio.Api.Auth;
using Claudio.Api.Configuration;
using Claudio.Api.Data;
using Claudio.Api.Endpoints;
using Claudio.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;
using OpenIddict.Validation.AspNetCore;

var configPath = Environment.GetEnvironmentVariable("CLAUDIO_CONFIG_PATH")
    ?? "/config/config.toml";

var config = ConfigLoader.Load(configPath);

var port = Environment.GetEnvironmentVariable("CLAUDIO_PORT") ?? config.Server.Port.ToString();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://+:{port}");

// Database
if (config.Database.Provider == "postgres" && config.Database.PostgresConnection is not null)
{
    builder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseNpgsql(config.Database.PostgresConnection)
           .UseOpenIddict()
           .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
}
else
{
    builder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseSqlite($"Data Source={config.Database.SqlitePath}")
           .UseOpenIddict()
           .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
}

// Identity
builder.Services.AddIdentityCore<ApplicationUser>(options =>
{
    options.Password.RequireDigit = false;
    options.Password.RequireLowercase = false;
    options.Password.RequireUppercase = false;
    options.Password.RequireNonAlphanumeric = false;
    options.Password.RequiredLength = 8;
    options.User.RequireUniqueEmail = false;
})
.AddRoles<IdentityRole<int>>()
.AddEntityFrameworkStores<AppDbContext>()
.AddDefaultTokenProviders()
.AddSignInManager();

// OpenIddict
// Load or generate a persistent RSA signing key stored alongside the config.
var configDir = config.Database.Provider == "postgres"
    ? Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? "/config"
    : Path.GetDirectoryName(config.Database.SqlitePath) ?? "/config";
Directory.CreateDirectory(configDir);

var signingKeyPath = Path.Combine(configDir, "claudio-signing.key");
RsaSecurityKey signingKey;
var rsa = RSA.Create(2048);
if (File.Exists(signingKeyPath))
{
    rsa.ImportRSAPrivateKey(Convert.FromBase64String(File.ReadAllText(signingKeyPath)), out _);
}
else
{
    File.WriteAllText(signingKeyPath, Convert.ToBase64String(rsa.ExportRSAPrivateKey()));
}
signingKey = new RsaSecurityKey(rsa);

builder.Services.AddOpenIddict()
    .AddCore(options =>
    {
        options.UseEntityFrameworkCore()
            .UseDbContext<AppDbContext>();
    })
    .AddServer(options =>
    {
        options.SetTokenEndpointUris("/connect/token");
        options.SetUserInfoEndpointUris("/connect/userinfo");

        options.AllowPasswordFlow();
        options.AllowRefreshTokenFlow();
        options.AllowCustomFlow(ConnectEndpoints.ProxyNonceGrantType);
        options.AllowCustomFlow(ConnectEndpoints.ExternalLoginNonceGrantType);

        options.RegisterScopes(
            OpenIddictConstants.Scopes.OpenId,
            OpenIddictConstants.Scopes.Profile,
            OpenIddictConstants.Scopes.OfflineAccess,
            "roles");

        options.UseReferenceRefreshTokens();

        // Persistent RSA key — tokens survive restarts. Encryption disabled so the SPA
        // can read the JWT payload directly. Refresh tokens are opaque handles in the DB.
        options.AddSigningKey(signingKey);
        options.AddEphemeralEncryptionKey();
        options.DisableAccessTokenEncryption();

        options.UseAspNetCore()
            .EnableTokenEndpointPassthrough()
            .EnableUserInfoEndpointPassthrough()
            .DisableTransportSecurityRequirement();
    })
    .AddValidation(options =>
    {
        options.UseLocalServer();
        options.UseAspNetCore();
    });

builder.Services.AddAuthentication(OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme);
builder.Services.AddAuthorization();

// JSON serialization
builder.Services.ConfigureHttpJsonOptions(opt =>
{
    opt.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

// Services
builder.Services.AddSingleton(config);
builder.Services.AddSingleton(new ConfigFileService(configPath, config));
builder.Services.AddSingleton<ProxyNonceStore>();
builder.Services.AddSingleton<ExternalLoginNonceStore>();
builder.Services.AddSingleton<GitHubOAuthStateStore>();
builder.Services.AddSingleton<GoogleOAuthStateStore>();
builder.Services.AddSingleton<OidcStateStore>();
builder.Services.AddTransient<DownloadService>();
builder.Services.AddSingleton<DownloadTicketService>();
builder.Services.AddSingleton<EmulationTicketService>();
builder.Services.AddSingleton<LibraryScanService>();
builder.Services.AddHostedService<LibraryScanBackgroundService>();
builder.Services.AddSingleton<IgdbService>();
builder.Services.AddSingleton<GitHubOAuthService>();
builder.Services.AddSingleton<GoogleOAuthService>();
builder.Services.AddSingleton<OidcOAuthService>();
builder.Services.AddSingleton<CompressionService>();
builder.Services.AddHostedService<CompressionBackgroundService>();
builder.Services.AddHttpClient();

var app = builder.Build();

// Auto-migrate database and seed OpenIddict application
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();

    var applicationManager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
    if (await applicationManager.FindByClientIdAsync("claudio-spa") is null)
    {
        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = "claudio-spa",
            ClientType = OpenIddictConstants.ClientTypes.Public,
            DisplayName = "Claudio SPA",
        };
        descriptor.AddGrantTypePermissions(
            OpenIddictConstants.GrantTypes.Password,
            OpenIddictConstants.GrantTypes.RefreshToken,
            ConnectEndpoints.ProxyNonceGrantType,
            ConnectEndpoints.ExternalLoginNonceGrantType);
        descriptor.AddScopePermissions(
            OpenIddictConstants.Scopes.OpenId,
            OpenIddictConstants.Scopes.Profile,
            OpenIddictConstants.Scopes.OfflineAccess,
            "roles");
        descriptor.Permissions.Add(OpenIddictConstants.Permissions.Endpoints.Token);
        await applicationManager.CreateAsync(descriptor);
    }
}

app.UseStaticFiles();

// Serve uploaded game images from /config/images/ under /images/
var imagesDir = Path.Combine(configDir, "images");
Directory.CreateDirectory(imagesDir);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(imagesDir),
    RequestPath = "/images",
});

if (config.Auth.DisableAuth)
    app.UseMiddleware<NoAuthMiddleware>();
else
    app.UseAuthentication();
app.UseAuthorization();

// Minimal API endpoints
if (!config.Auth.DisableAuth)
{
    app.MapConnectEndpoints();
    app.MapAuthEndpoints();
}
app.MapGameEndpoints();
app.MapSaveStateEndpoints();
app.MapAdminEndpoints();

// SPA fallback — serve index.html for non-API, non-file routes
app.MapFallbackToFile("index.html");

app.Run();

// Make Program accessible to integration tests via WebApplicationFactory<Program>
public partial class Program;
