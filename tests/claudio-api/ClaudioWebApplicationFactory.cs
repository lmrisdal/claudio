using Claudio.Api.Data;
using Claudio.Api.Services;
using Claudio.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Claudio.Api.Tests;

public class ClaudioWebApplicationFactory : WebApplicationFactory<Program>
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"claudio-test-{Guid.NewGuid():N}");
    private readonly string _dbPath;

    public ClaudioConfig TestConfig { get; } = new()
    {
        Library = new LibraryConfig { LibraryPaths = ["/nonexistent"] },
    };

    public ClaudioWebApplicationFactory()
    {
        Directory.CreateDirectory(_tempDir);
        _dbPath = Path.Combine(_tempDir, "test.db");
        TestConfig.Database.SqlitePath = _dbPath;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Point Program.cs at a temp config dir so it doesn't try to create /config
        Environment.SetEnvironmentVariable("CLAUDIO_CONFIG_PATH", Path.Combine(_tempDir, "config.toml"));
        Environment.SetEnvironmentVariable("CLAUDIO_DB_SQLITE_PATH", _dbPath);

        builder.ConfigureServices(services =>
        {
            // Replace AppDbContext with a test-specific SQLite database
            var dbDescriptor = services.SingleOrDefault(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>));
            if (dbDescriptor is not null) services.Remove(dbDescriptor);

            services.AddDbContext<AppDbContext>(options =>
                options.UseSqlite($"Data Source={_dbPath}"));

            // Replace ClaudioConfig with test config
            var configDescriptor = services.SingleOrDefault(d => d.ServiceType == typeof(ClaudioConfig));
            if (configDescriptor is not null) services.Remove(configDescriptor);
            services.AddSingleton(TestConfig);

            // Replace ConfigFileService to avoid writing to disk
            var configFileDescriptor = services.SingleOrDefault(d => d.ServiceType == typeof(ConfigFileService));
            if (configFileDescriptor is not null) services.Remove(configFileDescriptor);
            services.AddSingleton(new ConfigFileService(Path.Combine(_tempDir, "config.toml"), TestConfig));

            // Remove background services that would scan non-existent paths
            RemoveHostedService<LibraryScanBackgroundService>(services);
            RemoveHostedService<CompressionBackgroundService>(services);
        });
    }

    private static void RemoveHostedService<T>(IServiceCollection services) where T : class
    {
        var descriptors = services
            .Where(d => d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(T))
            .ToList();
        foreach (var d in descriptors) services.Remove(d);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }
}
