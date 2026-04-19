using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Claudio.Api.Services;

public class OidcStateStore
{
    private readonly ConcurrentDictionary<string, (string ProviderSlug, string ReturnTo, string ClientType, DateTimeOffset Expiry)> _states = new();
    private DateTimeOffset _lastPurge = DateTimeOffset.UtcNow;

    public string CreateState(string providerSlug, string returnTo, string clientType)
    {
        PurgeExpired();
        var state = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        _states[state] = (providerSlug, returnTo, clientType, DateTimeOffset.UtcNow.AddMinutes(5));
        return state;
    }

    public (string ProviderSlug, string ReturnTo, string ClientType)? ConsumeState(string state)
    {
        if (_states.TryRemove(state, out var entry) && DateTimeOffset.UtcNow <= entry.Expiry)
            return (entry.ProviderSlug, entry.ReturnTo, entry.ClientType);

        return null;
    }

    private void PurgeExpired()
    {
        var now = DateTimeOffset.UtcNow;
        if (now - _lastPurge < TimeSpan.FromMinutes(2))
            return;

        _lastPurge = now;
        foreach (var kvp in _states)
        {
            if (now > kvp.Value.Expiry)
                _states.TryRemove(kvp.Key, out _);
        }
    }
}
