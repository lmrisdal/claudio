using System.Security.Cryptography;
using System.Security.Claims;
using Claudio.Api.Auth;
using Claudio.Api.Configuration;
using Claudio.Api.Data;
using Claudio.Api.Endpoints;
using Claudio.Api.Models;
using Claudio.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var configPath = Environment.GetEnvironmentVariable("CLAUDIO_CONFIG_PATH")
    ?? "/config/config.toml";

var config = ConfigLoader.Load(configPath);

var port = config.Server.Port.ToString();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://+:{port}");
builder.Logging.SetMinimumLevel(ParseLogLevel(config.Server.LogLevel));

var browserOrigins = config.Auth.BrowserOrigins
    .Where(origin => !string.IsNullOrWhiteSpace(origin))
    .Select(origin => origin.TrimEnd('/'))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (browserOrigins.Length > 0)
            policy.WithOrigins(browserOrigins);

        policy.AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

if (config.Database.Provider == "postgres" && config.Database.PostgresConnection is not null)
{
    builder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseNpgsql(config.Database.PostgresConnection)
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
}
else
{
    builder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseSqlite($"Data Source={config.Database.SqlitePath}")
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
}

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole<int>>(options =>
    {
        options.Password.RequireDigit = false;
        options.Password.RequireLowercase = false;
        options.Password.RequireUppercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequiredLength = 8;
        options.User.RequireUniqueEmail = false;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

builder.Services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, ApplicationUserClaimsPrincipalFactory>();
builder.Services.AddTransient<Microsoft.AspNetCore.Authentication.IClaimsTransformation, ApplicationUserClaimsTransformation>();
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "claudio.auth";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.Events.OnRedirectToLogin = context =>
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});

var configDir = config.Database.Provider == "postgres"
    ? Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? "/config"
    : Path.GetDirectoryName(config.Database.SqlitePath) ?? "/config";
Directory.CreateDirectory(configDir);

var signingKeyPath = Path.Combine(configDir, "claudio-signing.key");
var rsa = RSA.Create(2048);
if (File.Exists(signingKeyPath))
    rsa.ImportRSAPrivateKey(Convert.FromBase64String(File.ReadAllText(signingKeyPath)), out _);
else
    File.WriteAllText(signingKeyPath, Convert.ToBase64String(rsa.ExportRSAPrivateKey()));

var signingKey = new RsaSecurityKey(rsa);
builder.Services.AddSingleton<SecurityKey>(signingKey);
builder.Services.AddScoped<DesktopTokenService>();

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = "auth";
        options.DefaultAuthenticateScheme = "auth";
        options.DefaultChallengeScheme = "auth";
    })
    .AddPolicyScheme("auth", "Cookie or bearer", options =>
    {
        options.ForwardDefaultSelector = context =>
            HasBearerAuthorization(context.Request)
                ? JwtBearerDefaults.AuthenticationScheme
                : IdentityConstants.ApplicationScheme;
    })
    .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            NameClaimType = ClaimTypes.Name,
            RoleClaimType = ClaimTypes.Role,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorizationBuilder()
    .SetDefaultPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder("auth")
        .RequireAuthenticatedUser()
        .Build());

builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "claudio.af";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
});

builder.Services.ConfigureHttpJsonOptions(opt =>
{
    opt.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

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
builder.Services.AddHostedService<IgdbBackgroundService>();
builder.Services.AddSingleton<SteamGridDbService>();
builder.Services.AddHostedService<SteamGridDbBackgroundService>();
builder.Services.AddSingleton<GitHubOAuthService>();
builder.Services.AddSingleton<GoogleOAuthService>();
builder.Services.AddSingleton<OidcOAuthService>();
builder.Services.AddSingleton<CompressionService>();
builder.Services.AddHostedService<CompressionBackgroundService>();
builder.Services.AddHttpClient();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

app.UseCors();
app.UseStaticFiles();

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
{
    app.UseAuthentication();
    app.Use(async (context, next) =>
    {
        if (RequiresAntiforgeryValidation(context.Request) && !HasBearerAuthorization(context.Request))
        {
            var antiforgery = context.RequestServices.GetRequiredService<Microsoft.AspNetCore.Antiforgery.IAntiforgery>();
            await antiforgery.ValidateRequestAsync(context);
        }

        await next();
    });
}

app.UseAuthorization();

app.MapHealthEndpoints();

if (!config.Auth.DisableAuth)
    app.MapAuthEndpoints();

app.MapGameEndpoints();
app.MapAdminEndpoints();
app.MapPreferencesEndpoints();
app.MapFallbackToFile("index.html");

app.Run();

static bool HasBearerAuthorization(HttpRequest request) =>
    request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);

static bool RequiresAntiforgeryValidation(HttpRequest request)
{
    if (!HttpMethods.IsPost(request.Method) && !HttpMethods.IsPut(request.Method) && !HttpMethods.IsDelete(request.Method))
        return false;

    var path = request.Path.Value ?? string.Empty;
    if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
        return false;

    if (path.StartsWith("/api/auth/token/", StringComparison.OrdinalIgnoreCase))
        return false;

    if (path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase)
        || path.Equals("/api/auth/register", StringComparison.OrdinalIgnoreCase))
        return false;

    if (!request.Cookies.ContainsKey("claudio.auth"))
        return false;

    return !path.Contains("/upload-image", StringComparison.OrdinalIgnoreCase);
}

static LogLevel ParseLogLevel(string value) => value.Trim().ToLowerInvariant() switch
{
    "trace" => LogLevel.Trace,
    "debug" => LogLevel.Debug,
    "information" or "info" => LogLevel.Information,
    "warning" or "warn" => LogLevel.Warning,
    "error" => LogLevel.Error,
    "critical" or "fatal" => LogLevel.Critical,
    "none" => LogLevel.None,
    _ => LogLevel.Warning,
};

public partial class Program;
