using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Claudio.Api.Data;

/// <summary>
/// Used by EF Core CLI tools (migrations add/remove/update) at design time.
/// Always targets Postgres so migrations are scaffolded with consistent Postgres
/// type names — which SQLite accepts via type affinity.
/// Set POSTGRES_CONNECTION env var or edit the fallback connection string below.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION")
            ?? "Host=localhost;Database=claudio;Username=claudio;Password=secret";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connection)
            .Options;

        return new AppDbContext(options);
    }
}
