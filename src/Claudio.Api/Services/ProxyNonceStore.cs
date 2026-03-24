using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Claudio.Api.Services;

public class ProxyNonceStore
{
    private readonly ConcurrentDictionary<string, (int UserId, DateTimeOffset Expiry)> _nonces = new();

    public string CreateNonce(int userId)
    {
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
}
