using System.Net;
using AwesomeAssertions;
using Claudio.Api.Data;
using Claudio.Api.Enums;
using Microsoft.Extensions.DependencyInjection;

namespace Claudio.Api.Tests;

[NotInParallel(nameof(GameEndpointTests))]
public class UnicodeDownloadTests
{
    [Test]
    public async Task Download_UnicodeTitle_UsesAsciiFallbackAndPreservesUnicodeFileName()
    {
        await using var factory = new ClaudioWebApplicationFactory();
        var directory = Path.Combine(Path.GetTempPath(), $"claudio-unicode-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        const string title = "Pokémon SoulSilver Version";
        var archivePath = Path.Combine(directory, $"{title}.zip");

        try
        {
            await File.WriteAllTextAsync(archivePath, "archive-content");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var game = new Game
            {
                Title = title,
                Platform = "win",
                FolderName = Path.GetFileName(archivePath),
                FolderPath = archivePath,
                InstallType = InstallType.Portable,
            };
            db.Games.Add(game);
            await db.SaveChangesAsync();
            using var client = factory.CreateClient();

            using var response = await client.GetAsync($"/api/games/{game.Id}/download");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            (await response.Content.ReadAsStringAsync()).Should().Be("archive-content");
            var disposition = response.Content.Headers.ContentDisposition!;
            disposition.ToString().All(c => c is >= ' ' and <= '~').Should().BeTrue();
            disposition.FileName!.Trim('"').Should().Be("Pok_mon SoulSilver Version.zip");
            disposition.FileNameStar.Should().Be($"{title}.zip");
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
