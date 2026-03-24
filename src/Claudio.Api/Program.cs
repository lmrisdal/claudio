using System.Text;
using Claudio.Api.Auth;
using Claudio.Api.Configuration;
using Claudio.Api.Data;
using Claudio.Api.Endpoints;
using Claudio.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

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
        opt.UseNpgsql(config.Database.PostgresConnection));
}
else
{
    builder.Services.AddDbContext<AppDbContext>(opt =>
        opt.UseSqlite($"Data Source={config.Database.SqlitePath}")
           .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));
}

// Auth
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(config.Auth.JwtSecret))
        };
    });
builder.Services.AddAuthorization();

// JSON serialization
builder.Services.ConfigureHttpJsonOptions(opt =>
{
    opt.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

// Services
builder.Services.AddSingleton(config);
builder.Services.AddSingleton<TokenService>();
builder.Services.AddTransient<DownloadService>();
builder.Services.AddSingleton<DownloadTicketService>();
builder.Services.AddSingleton<EmulationTicketService>();
builder.Services.AddSingleton<LibraryScanService>();
builder.Services.AddHostedService<LibraryScanBackgroundService>();
builder.Services.AddSingleton<IgdbService>();
builder.Services.AddSingleton<CompressionService>();
builder.Services.AddHostedService<CompressionBackgroundService>();
builder.Services.AddHttpClient();

var app = builder.Build();

// Auto-migrate database
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

app.UseStaticFiles();

// Serve uploaded game images from /config/images/ under /images/
var configDir = config.Database.Provider == "postgres"
    ? Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? "/config"
    : Path.GetDirectoryName(config.Database.SqlitePath) ?? "/config";
var imagesDir = Path.Combine(configDir, "images");
Directory.CreateDirectory(imagesDir);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(imagesDir),
    RequestPath = "/images",
});

app.UseAuthentication();
app.UseAuthorization();

// Minimal API endpoints
app.MapAuthEndpoints();
app.MapGameEndpoints();
app.MapAdminEndpoints();

// SPA fallback — serve index.html for non-API, non-file routes
app.MapFallbackToFile("index.html");

app.Run();
