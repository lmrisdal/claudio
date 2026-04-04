using System.Collections.Concurrent;
using System.Formats.Tar;
using System.IO.Compression;
using System.Threading.Channels;
using Claudio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Claudio.Api.Services;

public class CompressionService(
    IServiceScopeFactory scopeFactory,
    ILogger<CompressionService> logger)
{
    private readonly Channel<(int GameId, string Format)> _channel = Channel.CreateUnbounded<(int, string)>();
    private readonly ConcurrentDictionary<int, CancellationTokenSource> _cancellations = new();
    private readonly List<(int Id, string Title, string Format)> _queued = [];
    private readonly ConcurrentDictionary<int, string> _formats = new();
    private readonly Lock _lock = new();
    private int? _currentGameId;
    private string? _currentGameTitle;
    private int _progressPercent;

    public async Task QueueCompressionAsync(int gameId, string format = "zip")
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = await db.Games.FindAsync(gameId)
            ?? throw new InvalidOperationException("Game not found.");

        lock (_lock)
        {
            if (_currentGameId == gameId || _queued.Any(q => q.Id == gameId))
                throw new InvalidOperationException("Game is already queued for compression.");
            _queued.Add((gameId, game.Title, format));
        }

        _formats[gameId] = format;
        game.IsProcessing = true;
        await db.SaveChangesAsync();

        await _channel.Writer.WriteAsync((gameId, format));
        logger.LogInformation("Queued {Format} packaging for: {Title} (ID {GameId})", format, game.Title, gameId);
    }

    public async Task CancelCompressionAsync(int gameId)
    {
        bool wasQueued;
        lock (_lock)
        {
            wasQueued = _queued.RemoveAll(q => q.Id == gameId) > 0;
            _formats.TryRemove(gameId, out _);
        }

        if (wasQueued)
        {
            // Remove from channel by draining and re-adding others
            // Simpler: just let it be read from channel but skip in ProcessQueueAsync
            await ResetProcessingFlag(gameId);
            logger.LogInformation("Cancelled queued compression for game {GameId}", gameId);
            return;
        }

        if (_currentGameId == gameId && _cancellations.TryGetValue(gameId, out var cts))
        {
            await cts.CancelAsync();
            logger.LogInformation("Cancelling active compression for game {GameId}", gameId);
        }
    }

    public bool IsGameActive(int gameId)
    {
        lock (_lock)
        {
            return _currentGameId == gameId || _queued.Any(q => q.Id == gameId);
        }
    }

    public CompressionStatus GetStatus()
    {
        lock (_lock)
        {
            CompressionJobInfo? current = null;
            if (_currentGameId.HasValue)
            {
                _formats.TryGetValue(_currentGameId.Value, out var fmt);
                current = new CompressionJobInfo(_currentGameId.Value, _currentGameTitle ?? "", _progressPercent, fmt ?? "zip");
            }

            var queued = new List<CompressionJobInfo>();
            foreach (var (id, title, format) in _queued)
                queued.Add(new CompressionJobInfo(id, title, null, format));

            return new CompressionStatus(current, queued);
        }
    }

    public async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        // On startup, reset any stuck IsProcessing flags
        await ResetAllProcessingFlags();

        await foreach (var (gameId, format) in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            bool isStillQueued;
            lock (_lock)
            {
                isStillQueued = _queued.RemoveAll(q => q.Id == gameId) > 0;
            }

            if (!isStillQueued)
            {
                // Was cancelled while queued
                _formats.TryRemove(gameId, out _);
                continue;
            }

            await ProcessGameAsync(gameId, format, stoppingToken);
        }
    }

    private async Task ProcessGameAsync(int gameId, string format, CancellationToken stoppingToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        _cancellations[gameId] = cts;

        lock (_lock)
        {
            _currentGameId = gameId;
            _currentGameTitle = null;
            _progressPercent = 0;
        }

        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var game = await db.Games.FindAsync(gameId);

            if (game is null)
            {
                logger.LogWarning("Game {GameId} not found, skipping compression", gameId);
                return;
            }

            lock (_lock) { _currentGameTitle = game.Title; }

            if (!Endpoints.GameEndpoints.ExistsOnDisk(game))
            {
                logger.LogWarning("Game folder not found for {Title}, skipping compression", game.Title);
                game.IsProcessing = false;
                await db.SaveChangesAsync();
                return;
            }

            var ext = format == "tar" ? ".tar" : ".zip";
            logger.LogInformation("Starting {Format} packaging for: {Title}", format, game.Title);

            var allFiles = Directory.GetFiles(game.FolderPath, "*", SearchOption.AllDirectories);
            if (allFiles.Length == 0)
            {
                logger.LogWarning("No files to package for {Title}", game.Title);
                game.IsProcessing = false;
                await db.SaveChangesAsync();
                return;
            }

            var totalBytes = allFiles.Sum(f => new FileInfo(f).Length);
            long bytesProcessed = 0;

            var tempPath = Path.Combine(game.FolderPath, $".claudio-compress-{gameId}{ext}.tmp");
            if (File.Exists(tempPath)) File.Delete(tempPath);

            try
            {
                var buffer = new byte[256 * 1024]; // 256KB chunks
                var filesToProcess = allFiles.Where(f => f != tempPath);

                if (format == "tar")
                {
                    await using var tarStream = new FileStream(tempPath, FileMode.Create);
                    await using var tarWriter = new TarWriter(tarStream);
                    foreach (var file in filesToProcess)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        var entryName = Path.GetRelativePath(game.FolderPath, file).Replace('\\', '/');
                        await tarWriter.WriteEntryAsync(file, entryName, cts.Token);
                        bytesProcessed += new FileInfo(file).Length;
                        lock (_lock) { _progressPercent = totalBytes > 0 ? (int)(bytesProcessed * 100 / totalBytes) : 0; }
                    }
                }
                else
                {
                    await using var zipStream = new FileStream(tempPath, FileMode.Create);
                    using var zip = new ZipArchive(zipStream, ZipArchiveMode.Create);
                    foreach (var file in filesToProcess)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        var entryName = Path.GetRelativePath(game.FolderPath, file).Replace('\\', '/');
                        var entry = zip.CreateEntry(entryName, CompressionLevel.Optimal);

                        await using var source = File.OpenRead(file);
                        await using var dest = entry.Open();
                        int read;
                        while ((read = await source.ReadAsync(buffer, cts.Token)) > 0)
                        {
                            await dest.WriteAsync(buffer.AsMemory(0, read), cts.Token);
                            bytesProcessed += read;
                            lock (_lock) { _progressPercent = totalBytes > 0 ? (int)(bytesProcessed * 100 / totalBytes) : 0; }
                        }
                    }
                }

                cts.Token.ThrowIfCancellationRequested();

                var archiveSize = new FileInfo(tempPath).Length;

                // Delete all original contents except the temp file
                foreach (var dir in Directory.GetDirectories(game.FolderPath))
                    Directory.Delete(dir, true);
                foreach (var file in Directory.GetFiles(game.FolderPath))
                    if (file != tempPath) File.Delete(file);

                // Rename temp to final
                var finalName = $"{game.FolderName}{ext}";
                var finalPath = Path.Combine(game.FolderPath, finalName);
                File.Move(tempPath, finalPath);

                game.SizeBytes = archiveSize;
                game.IsProcessing = false;
                await db.SaveChangesAsync();

                logger.LogInformation("Packaging complete for: {Title} ({Size:N0} bytes, {Format})", game.Title, archiveSize, format);
            }
            catch (OperationCanceledException)
            {
                if (File.Exists(tempPath)) File.Delete(tempPath);
                game.IsProcessing = false;
                await db.SaveChangesAsync();
                logger.LogInformation("Packaging cancelled for: {Title}", game.Title);
            }
            catch (Exception ex)
            {
                if (File.Exists(tempPath)) File.Delete(tempPath);
                game.IsProcessing = false;
                await db.SaveChangesAsync();
                logger.LogError(ex, "Packaging failed for: {Title}", game.Title);
            }
        }
        finally
        {
            _cancellations.TryRemove(gameId, out _);
            _formats.TryRemove(gameId, out _);
            lock (_lock)
            {
                _currentGameId = null;
                _currentGameTitle = null;
                _progressPercent = 0;
            }
        }
    }

    private async Task ResetProcessingFlag(int gameId)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var game = await db.Games.FindAsync(gameId);
        if (game is not null)
        {
            game.IsProcessing = false;
            await db.SaveChangesAsync();
        }
    }

    private async Task ResetAllProcessingFlags()
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stuck = await db.Games.Where(g => g.IsProcessing).ToListAsync();
        if (stuck.Count > 0)
        {
            logger.LogWarning("Resetting {Count} stuck processing flags from previous run", stuck.Count);
            foreach (var game in stuck)
                game.IsProcessing = false;
            await db.SaveChangesAsync();
        }
    }
}

public record CompressionStatus(CompressionJobInfo? Current, List<CompressionJobInfo> Queued);
public record CompressionJobInfo(int GameId, string GameTitle, int? ProgressPercent, string Format);

public class CompressionBackgroundService(CompressionService compressionService) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await compressionService.ProcessQueueAsync(stoppingToken);
    }
}
