using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace Claudio.Api.Services;

public class DownloadTicketService
{
    private readonly ConcurrentDictionary<string, Ticket> _tickets = new();

    public string CreateTicket(int gameId)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var ticket = new Ticket(gameId, DateTime.UtcNow.AddSeconds(30));
        _tickets[token] = ticket;
        return token;
    }

    public bool TryRedeem(string token, int gameId)
    {
        if (!_tickets.TryRemove(token, out var ticket))
            return false;

        return ticket.GameId == gameId && ticket.ExpiresAt > DateTime.UtcNow;
    }

    /// Periodically called to remove expired tickets.
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
