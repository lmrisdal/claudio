using Claudio.Shared.Enums;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Game> Games => Set<Game>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasIndex(u => u.Username).IsUnique();
        });

        modelBuilder.Entity<Game>(e =>
        {
            e.HasIndex(g => new { g.Platform, g.FolderName }).IsUnique();
        });
    }
}

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Game
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Platform { get; set; } = string.Empty;
    public string FolderName { get; set; } = string.Empty;
    public string FolderPath { get; set; } = string.Empty;
    public InstallType InstallType { get; set; }
    public string? Summary { get; set; }
    public string? Genre { get; set; }
    public int? ReleaseYear { get; set; }
    public string? CoverUrl { get; set; }
    public long? IgdbId { get; set; }
    public long SizeBytes { get; set; }
    public bool IsMissing { get; set; }
    public string? InstallerExe { get; set; }
    public string? GameExe { get; set; }
    public string? Developer { get; set; }
    public string? Publisher { get; set; }
    public string? GameMode { get; set; }
    public string? Series { get; set; }
    public string? Franchise { get; set; }
    public string? GameEngine { get; set; }
}
