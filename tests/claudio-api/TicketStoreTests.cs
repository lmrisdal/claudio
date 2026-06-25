using AwesomeAssertions;
using Claudio.Api.Services;

namespace Claudio.Api.Tests;

public class DownloadTicketServiceTests
{
    [Test]
    public void CreateTicket_ReturnsUniqueTokens()
    {
        var service = new DownloadTicketService();

        var ticket1 = service.CreateTicket(1);
        var ticket2 = service.CreateTicket(1);

        ticket1.Should().NotBeNullOrEmpty();
        ticket2.Should().NotBeNullOrEmpty();
        ticket1.Should().NotBe(ticket2);
    }

    [Test]
    public void TryRedeem_ValidTicket_ReturnsTrue()
    {
        var service = new DownloadTicketService();
        var ticket = service.CreateTicket(42);

        service.TryRedeem(ticket, 42).Should().BeTrue();
    }

    [Test]
    public void TryRedeem_ConsumedOnce_SecondRedeemFails()
    {
        var service = new DownloadTicketService();
        var ticket = service.CreateTicket(42);

        service.TryRedeem(ticket, 42).Should().BeTrue();
        service.TryRedeem(ticket, 42).Should().BeFalse();
    }

    [Test]
    public void TryRedeem_WrongGameId_ReturnsFalse()
    {
        var service = new DownloadTicketService();
        var ticket = service.CreateTicket(1);

        service.TryRedeem(ticket, 999).Should().BeFalse();
    }

    [Test]
    public void TryRedeem_InvalidToken_ReturnsFalse()
    {
        var service = new DownloadTicketService();

        service.TryRedeem("bogus-token", 1).Should().BeFalse();
    }

    [Test]
    public void PurgeExpired_RemovesNothing_WhenAllFresh()
    {
        var service = new DownloadTicketService();
        var ticket = service.CreateTicket(1);

        service.PurgeExpired();

        service.TryRedeem(ticket, 1).Should().BeTrue();
    }
}

public class EmulationTicketServiceTests
{
    [Test]
    public void CreateTicket_ReturnsUrlSafeToken()
    {
        var service = new EmulationTicketService();
        var ticket = service.CreateTicket(1);

        ticket.Should().NotContain("+");
        ticket.Should().NotContain("/");
        ticket.Should().NotContain("=");
    }

    [Test]
    public void IsValid_ValidTicket_ReturnsTrue()
    {
        var service = new EmulationTicketService();
        var ticket = service.CreateTicket(42);

        service.IsValid(ticket, 42).Should().BeTrue();
    }

    [Test]
    public void IsValid_DoesNotConsumeTicket()
    {
        var service = new EmulationTicketService();
        var ticket = service.CreateTicket(42);

        service.IsValid(ticket, 42).Should().BeTrue();
        service.IsValid(ticket, 42).Should().BeTrue();
    }

    [Test]
    public void IsValid_WrongGameId_ReturnsFalse()
    {
        var service = new EmulationTicketService();
        var ticket = service.CreateTicket(1);

        service.IsValid(ticket, 999).Should().BeFalse();
    }

    [Test]
    public void IsValid_InvalidToken_ReturnsFalse()
    {
        var service = new EmulationTicketService();

        service.IsValid("bogus", 1).Should().BeFalse();
    }
}
