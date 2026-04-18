using Claudio.Api.Enums;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<int>, int>(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<UserPreferences> UserPreferences => Set<UserPreferences>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.UseOpenIddict();

        modelBuilder.Entity<Game>(e =>
        {
            e.HasIndex(g => new { g.Platform, g.FolderName }).IsUnique();
        });

        modelBuilder.Entity<UserPreferences>(e =>
        {
            e.HasKey(p => p.UserId);
            e.Property(p => p.PreferencesJson).HasDefaultValue("{}");
            e.HasOne(p => p.User)
                .WithOne(u => u.Preferences)
                .HasForeignKey<UserPreferences>(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
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

public class UserPreferences
{
    public int UserId { get; set; }
    public string PreferencesJson { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public ApplicationUser User { get; set; } = null!;
}
