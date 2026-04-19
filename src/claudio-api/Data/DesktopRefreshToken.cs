namespace Claudio.Api.Data;

public class DesktopRefreshToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string TokenHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public int? ReplacedByTokenId { get; set; }
    public ApplicationUser User { get; set; } = null!;
    public DesktopRefreshToken? ReplacedByToken { get; set; }
}
