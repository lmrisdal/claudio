using System.Formats.Tar;
using Claudio.Api.Data;

namespace Claudio.Api.Services;

public class DownloadService
{
    /// Creates a tar archive of the game folder and returns the file path.
    public async Task<string> CreateTarAsync(Game game)
    {
        var tarPath = Path.Combine(Path.GetTempPath(), $"claudio-game-{game.Id}.tar");

        // Reuse existing tar if it was created recently (within 10 minutes)
        if (File.Exists(tarPath) && File.GetLastWriteTimeUtc(tarPath) > DateTime.UtcNow.AddMinutes(-10))
            return tarPath;

        if (File.Exists(tarPath)) File.Delete(tarPath);
        await TarFile.CreateFromDirectoryAsync(game.FolderPath, tarPath, includeBaseDirectory: true);
        return tarPath;
    }
}
