namespace Claudio.Api.Models;

public class UserPreferencesDto
{
    public LibraryPreferencesDto Library { get; set; } = new();
}

public class LibraryPreferencesDto
{
    public List<string> PlatformOrder { get; set; } = [];
}
