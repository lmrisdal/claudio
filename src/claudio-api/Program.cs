using Claudio.Api.Configuration;
using Claudio.Api.Data;
using Claudio.Api.Endpoints;
using Claudio.Api.Models;
using Claudio.Api.Services;
using Microsoft.EntityFrameworkCore;

var configPath = Environment.GetEnvironmentVariable("CLAUDIO_CONFIG_PATH")
    ?? "/config/config.toml";

var config = ConfigLoader.Load(configPath);

var port = config.Server.Port.ToString();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://+:{port}");
builder.Logging.SetMinimumLevel(ParseLogLevel(config.Server.LogLevel));

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyMethod()
            .AllowAnyHeader()
            .AllowAnyOrigin();
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

var configDir = config.Database.Provider == "postgres"
    ? Path.GetDirectoryName(Path.GetFullPath(configPath)) ?? "/config"
    : Path.GetDirectoryName(config.Database.SqlitePath) ?? "/config";
Directory.CreateDirectory(configDir);

builder.Services.ConfigureHttpJsonOptions(opt =>
{
    opt.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

builder.Services.AddSingleton(config);
builder.Services.AddSingleton(new ConfigFileService(configPath, config));
builder.Services.AddTransient<DownloadService>();
builder.Services.AddSingleton<DownloadTicketService>();
builder.Services.AddSingleton<EmulationTicketService>();
builder.Services.AddSingleton<LibraryScanService>();
builder.Services.AddHostedService<LibraryScanBackgroundService>();
builder.Services.AddSingleton<IgdbService>();
builder.Services.AddHostedService<IgdbBackgroundService>();
builder.Services.AddSingleton<SteamGridDbService>();
builder.Services.AddHostedService<SteamGridDbBackgroundService>();
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

app.MapHealthEndpoints();
app.MapGameEndpoints();
app.MapAdminEndpoints();
app.MapPreferencesEndpoints();
app.MapFallbackToFile("index.html");

app.Run();

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
