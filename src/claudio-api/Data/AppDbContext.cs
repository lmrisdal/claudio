using Claudio.Api.Enums;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<int>, int>(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<SaveState> SaveStates => Set<SaveState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.UseOpenIddict();

        modelBuilder.Entity<Game>(e =>
        {
            e.HasIndex(g => new { g.Platform, g.FolderName }).IsUnique();
        });

        modelBuilder.Entity<SaveState>(e =>
        {
            e.HasIndex(s => new { s.UserId, s.GameId, s.CreatedAt });
            e.HasOne(s => s.Game).WithMany().HasForeignKey(s => s.GameId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public class SaveState
{
    public int Id { get; set; }
    public int GameId { get; set; }
    public int UserId { get; set; }
    public byte[] StateData { get; set; } = [];
    public byte[] ScreenshotData { get; set; } = [];
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Game Game { get; set; } = null!;
    public ApplicationUser User { get; set; } = null!;
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
    public string? HeroUrl { get; set; }
    public long? IgdbId { get; set; }
    public string? IgdbSlug { get; set; }
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
    public bool IsProcessing { get; set; }
}
