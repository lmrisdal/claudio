using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using AwesomeAssertions;
using Claudio.Core.Rpc;

namespace Claudio.Core.Tests;

public class ProtocolTests
{
    [Test]
    public async Task ParsesRequestsWithNumericIds()
    {
        var parsed = Messages.Parse("""{"id":1,"method":"ping","params":{"a":1}}""");

        var request = parsed.Should().BeOfType<IncomingRequest>().Subject;
        request.Id.GetInt32().Should().Be(1);
        request.Method.Should().Be("ping");
        request.Params.GetProperty("a").GetInt32().Should().Be(1);
        await Task.CompletedTask;
    }

    [Test]
    public async Task ParsesConfirmResponsesWithStringIds()
    {
        var parsed = Messages.Parse("""{"id":"c1","result":true}""");

        var response = parsed.Should().BeOfType<IncomingResponse>().Subject;
        response.Id.GetString().Should().Be("c1");
        response.Result.ValueKind.Should().Be(JsonValueKind.True);
        await Task.CompletedTask;
    }

    [Test]
    public async Task RejectsMalformedAndIdLessMessages()
    {
        var malformed = () => Messages.Parse("not json");
        var idLess = () => Messages.Parse("""{"method":"ping"}""");

        malformed.Should().Throw<CommandException>();
        idLess.Should().Throw<CommandException>().WithMessage("Message is missing an id.");
        await Task.CompletedTask;
    }

    [Test]
    public async Task SerializesOutgoingLinesWithoutNewlinesInside()
    {
        var id = JsonDocument.Parse("2").RootElement;
        var result = Messages.Result(id, writer => writer.WriteStartObject());
        var error = Messages.Error(id, "boom");
        var evt = Messages.Event("install-progress", writer => writer.WriteNullValue());

        Text(error).Should().Be("""{"id":2,"error":"boom"}""");
        Text(evt).Should().Be("""{"event":"install-progress","payload":null}""");
        foreach (var line in new[] { result, error, evt })
        {
            line.Count(b => b == (byte)'\n').Should().Be(1);
            line[^1].Should().Be((byte)'\n');
        }

        await Task.CompletedTask;
    }

    [Test]
    public async Task WritesNonAsciiTextWithoutEscaping()
    {
        var id = JsonDocument.Parse("1").RootElement;

        Text(Messages.Error(id, "Pokémon ü")).Should().Contain("Pokémon ü");
        await Task.CompletedTask;
    }

    private static string Text(byte[] line) => Encoding.UTF8.GetString(line).TrimEnd('\n');
}

public class RpcHostTests
{
    private static (RpcHost Host, ChannelReader<byte[]> Lines) Create(string resourceDir = "")
    {
        var channel = Channel.CreateUnbounded<byte[]>();
        return (new RpcHost(channel.Writer, resourceDir), channel.Reader);
    }

    private static async Task<string> NextConfirmId(ChannelReader<byte[]> lines)
    {
        var line = await lines.ReadAsync();
        using var document = JsonDocument.Parse(line);
        document.RootElement.GetProperty("request").GetString().Should().Be("confirm");
        document.RootElement.GetProperty("params").GetProperty("okLabel").GetString().Should().Be("Ok");
        return document.RootElement.GetProperty("id").GetString()!;
    }

    [Test]
    public async Task ConfirmRoundTripReturnsTheShellAnswer()
    {
        var (host, lines) = Create();
        var waiting = host.ConfirmAsync("Title", "Message", "Ok", "Cancel");

        host.ResolveConfirm(await NextConfirmId(lines), true);

        (await waiting).Should().BeTrue();
    }

    [Test]
    public async Task ConfirmReturnsFalseWhenDeclined()
    {
        var (host, lines) = Create();
        var waiting = host.ConfirmAsync("Title", "Message", "Ok", "Cancel");

        host.ResolveConfirm(await NextConfirmId(lines), false);

        (await waiting).Should().BeFalse();
    }

    [Test]
    public async Task ConfirmReturnsFalseWhenTheShellGoesAway()
    {
        var (host, lines) = Create();
        var waiting = host.ConfirmAsync("Title", "Message", "Ok", "Cancel");
        await NextConfirmId(lines);

        host.CancelPendingConfirms();

        (await waiting).Should().BeFalse();
    }

    [Test]
    public async Task ConfirmIdsAreUniquePerRequest()
    {
        var (host, lines) = Create();
        var first = host.ConfirmAsync("Title", "Message", "Ok", "Cancel");
        var firstId = await NextConfirmId(lines);
        var second = host.ConfirmAsync("Title", "Message", "Ok", "Cancel");
        var secondId = await NextConfirmId(lines);

        host.ResolveConfirm(secondId, true);
        host.ResolveConfirm(firstId, false);

        firstId.Should().NotBe(secondId);
        (await second).Should().BeTrue();
        (await first).Should().BeFalse();
    }

    [Test]
    public async Task ResourceDirComesFromBackend()
    {
        var (host, _) = Create("/resources");

        host.ResourceDir.Should().Be("/resources");
        await Task.CompletedTask;
    }

    [Test]
    public async Task EmitSerializesPayloadWithCamelCaseFields()
    {
        var (host, lines) = Create();

        Claudio.Core.Install.Progress.Emit(host, 4, "downloading", 12.5, "x");

        using var document = JsonDocument.Parse(await lines.ReadAsync());
        document.RootElement.GetProperty("event").GetString().Should().Be("install-progress");
        var payload = document.RootElement.GetProperty("payload");
        payload.GetProperty("gameId").GetInt32().Should().Be(4);
        payload.GetProperty("percent").GetDouble().Should().Be(12.5);
        payload.GetProperty("indeterminate").ValueKind.Should().Be(JsonValueKind.Null);
    }
}
