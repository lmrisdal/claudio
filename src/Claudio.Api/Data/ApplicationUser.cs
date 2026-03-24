using Claudio.Shared.Enums;
using Microsoft.AspNetCore.Identity;

namespace Claudio.Api.Data;

public class ApplicationUser : IdentityUser<int>
{
    public UserRole Role { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
