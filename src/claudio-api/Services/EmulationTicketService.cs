using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Claudio.Api.Services;

public class EmulationTicketService
{
    private readonly ConcurrentDictionary<string, Ticket> _tickets = new();

    public string CreateTicket(int gameId)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        _tickets[token] = new Ticket(gameId, DateTime.UtcNow.AddMinutes(30));
        return token;
    }

    public bool IsValid(string token, int gameId)
    {
        if (!_tickets.TryGetValue(token, out var ticket))
            return false;

        if (ticket.ExpiresAt <= DateTime.UtcNow)
        {
            _tickets.TryRemove(token, out _);
            return false;
        }

        return ticket.GameId == gameId;
    }

    public void PurgeExpired()
    {
        var now = DateTime.UtcNow;
        foreach (var (key, ticket) in _tickets)
        {
            if (ticket.ExpiresAt <= now)
                _tickets.TryRemove(key, out _);
        }
    }

    private record Ticket(int GameId, DateTime ExpiresAt);
}
