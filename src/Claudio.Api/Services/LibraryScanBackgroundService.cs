namespace Claudio.Api.Services;

public class LibraryScanBackgroundService(LibraryScanService scanService, ILogger<LibraryScanBackgroundService> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(Interval, stoppingToken);

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
