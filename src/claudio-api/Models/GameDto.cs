using Claudio.Api.Enums;

namespace Claudio.Api.Models;

public class GameDto
{
    public int Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Platform { get; set; } = string.Empty;
    public string FolderName { get; set; } = string.Empty;
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
    public bool IsArchive { get; set; }
}
