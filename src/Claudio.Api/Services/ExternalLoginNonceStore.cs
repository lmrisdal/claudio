using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Claudio.Api.Services;

public class ExternalLoginNonceStore
{
    private readonly ConcurrentDictionary<string, (int UserId, DateTimeOffset Expiry)> _nonces = new();
    private DateTimeOffset _lastPurge = DateTimeOffset.UtcNow;

    public string CreateNonce(int userId)
    {
        PurgeExpired();
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        _nonces[nonce] = (userId, DateTimeOffset.UtcNow.AddSeconds(30));
        return nonce;
    }

    public int? ConsumeNonce(string nonce)
    {
        if (_nonces.TryRemove(nonce, out var entry) && DateTimeOffset.UtcNow <= entry.Expiry)
            return entry.UserId;

        return null;
    }

    private void PurgeExpired()
    {
        var now = DateTimeOffset.UtcNow;
        if (now - _lastPurge < TimeSpan.FromMinutes(1))
            return;

        _lastPurge = now;
        foreach (var kvp in _nonces)
        {
            if (now > kvp.Value.Expiry)
                _nonces.TryRemove(kvp.Key, out _);
        }
    }
}
