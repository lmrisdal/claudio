using System.Formats.Tar;
using Claudio.Api.Data;
using Claudio.Api.Models;

namespace Claudio.Api.Services;

public class DownloadService(ClaudioConfig config)
{
    /// Creates a tar archive of the game folder and returns the file path.
    /// The tar is stored in the library path to avoid filling up /tmp in Docker.
    public async Task<string> CreateTarAsync(Game game)
    {
        var tarsDir = Path.Combine(config.Library.LibraryPaths[0], ".claudio", "tars");
        Directory.CreateDirectory(tarsDir);
        var tarPath = Path.Combine(tarsDir, $"claudio-game-{game.Id}.tar");

        // Reuse existing tar if it was created recently (within 10 minutes)
        if (File.Exists(tarPath) && File.GetLastWriteTimeUtc(tarPath) > DateTime.UtcNow.AddMinutes(-10))
            return tarPath;

        if (File.Exists(tarPath)) File.Delete(tarPath);
        await TarFile.CreateFromDirectoryAsync(game.FolderPath, tarPath, includeBaseDirectory: true);
        return tarPath;
    }
}
