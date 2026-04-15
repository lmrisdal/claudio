using Claudio.Api.Models;

namespace Claudio.Api.Services;

public class LibraryScanBackgroundService(
    LibraryScanService scanService,
    ClaudioConfig config,
    ILogger<LibraryScanBackgroundService> logger)
    : BackgroundService
{
    private readonly TimeSpan _interval = TimeSpan.FromSeconds(Math.Max(1, config.Library.ScanIntervalSecs));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Scan immediately on startup
        try
        {
            var result = await scanService.ScanAsync();
            logger.LogInformation("Startup scan complete: {Found} found, {Added} added, {Missing} missing",
                result.GamesFound, result.GamesAdded, result.GamesMissing);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Startup library scan failed");
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(_interval, stoppingToken);

            try
            {
                logger.LogInformation("Starting scheduled library scan");
                var result = await scanService.ScanAsync();
                logger.LogInformation("Scheduled scan complete: {Found} found, {Added} added, {Missing} missing",
                    result.GamesFound, result.GamesAdded, result.GamesMissing);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Scheduled library scan failed");
            }
        }
    }
}
