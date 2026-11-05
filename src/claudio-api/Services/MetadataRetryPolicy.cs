namespace Claudio.Api.Services;

// Automatic sweeps run after every library scan, so a game that IGDB or SteamGridDB
// cannot match must not be retried each time or the server hammers both APIs.
public static class MetadataRetryPolicy
{
    public static readonly TimeSpan RetryAfter = TimeSpan.FromDays(7);

    public static DateTime RetryCutoff(DateTime utcNow) => utcNow - RetryAfter;
}
