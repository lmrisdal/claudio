using Claudio.Api.Configuration;
using AwesomeAssertions;

namespace Claudio.Api.Tests;

public class ConfigLoaderTests
{
    private const string EnvironmentVariables = "EnvironmentVariables";

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_MissingFile_ReturnsDefaults()
    {
        var config = ConfigLoader.Load("/nonexistent/path.toml");

        config.Server.Port.Should().Be(8080);
        config.Server.LogLevel.Should().Be("warn");
        config.Database.Provider.Should().Be("sqlite");
        config.Library.LibraryPaths.Should().BeEquivalentTo(["/games"]);
        config.Library.ExcludePlatforms.Should().BeEmpty();
        config.Library.ScanIntervalSecs.Should().Be(120);
        config.Igdb.TimeoutSecs.Should().Be(600);
        config.Steamgriddb.TimeoutSecs.Should().Be(900);
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_TomlFile_ParsesLibraryConfig()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                [library]
                library_paths = ["/mnt/games", "/mnt/roms"]
                exclude_platforms = ["ps", "gba"]
                scan_interval_secs = 300
                """);

            var config = ConfigLoader.Load(path);

            config.Library.LibraryPaths.Should().BeEquivalentTo(["/mnt/games", "/mnt/roms"]);
            config.Library.ExcludePlatforms.Should().BeEquivalentTo(["ps", "gba"]);
            config.Library.ScanIntervalSecs.Should().Be(300);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_TomlFile_ParsesServerAndDatabase()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                [server]
                port = 9090
                log_level = "debug"

                [database]
                provider = "postgres"
                postgres_connection = "Host=db;Database=claudio"
                """);

            var config = ConfigLoader.Load(path);

            config.Server.Port.Should().Be(9090);
            config.Server.LogLevel.Should().Be("debug");
            config.Database.Provider.Should().Be("postgres");
            config.Database.PostgresConnection.Should().Be("Host=db;Database=claudio");
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesLibraryPaths()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_LIBRARY_PATHS", "/a, /b, /c");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Library.LibraryPaths.Should().BeEquivalentTo(["/a", "/b", "/c"]);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_LIBRARY_PATHS", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesExcludePlatforms()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_EXCLUDE_PLATFORMS", "ps, ngc ,gba");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Library.ExcludePlatforms.Should().BeEquivalentTo(["ps", "ngc", "gba"]);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_EXCLUDE_PLATFORMS", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesIgdbConfig()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID", "test-id");
        Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET", "test-secret");
        Environment.SetEnvironmentVariable("CLAUDIO_IGDB_TIMEOUT_SECS", "30");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Igdb.ClientId.Should().Be("test-id");
            config.Igdb.ClientSecret.Should().Be("test-secret");
            config.Igdb.TimeoutSecs.Should().Be(30);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID", null);
            Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET", null);
            Environment.SetEnvironmentVariable("CLAUDIO_IGDB_TIMEOUT_SECS", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesSteamGridDbTimeout()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_TIMEOUT_SECS", "75");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Steamgriddb.TimeoutSecs.Should().Be(75);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_STEAMGRIDDB_TIMEOUT_SECS", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesBooleans()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_DISABLE_AUTH", "TRUE");
        Environment.SetEnvironmentVariable("CLAUDIO_DISABLE_LOCAL_LOGIN", "true");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Auth.DisableAuth.Should().BeTrue();
            config.Auth.DisableLocalLogin.Should().BeTrue();
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_DISABLE_AUTH", null);
            Environment.SetEnvironmentVariable("CLAUDIO_DISABLE_LOCAL_LOGIN", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesServerSettingsAndScanInterval()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_PORT", "9191");
        Environment.SetEnvironmentVariable("CLAUDIO_LOG_LEVEL", "error");
        Environment.SetEnvironmentVariable("CLAUDIO_SCAN_INTERVAL", "45");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Server.Port.Should().Be(9191);
            config.Server.LogLevel.Should().Be("error");
            config.Library.ScanIntervalSecs.Should().Be(45);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_PORT", null);
            Environment.SetEnvironmentVariable("CLAUDIO_LOG_LEVEL", null);
            Environment.SetEnvironmentVariable("CLAUDIO_SCAN_INTERVAL", null);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesFileValues()
    {
        var path = Path.GetTempFileName();
        Environment.SetEnvironmentVariable("CLAUDIO_EXCLUDE_PLATFORMS", "snes");
        try
        {
            File.WriteAllText(path, """
                [library]
                exclude_platforms = ["ps", "gba"]
                """);

            var config = ConfigLoader.Load(path);

            config.Library.ExcludePlatforms.Should().BeEquivalentTo(["snes"]);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_EXCLUDE_PLATFORMS", null);
            File.Delete(path);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_OidcProviders_FallsBackAuthorityToDiscoveryUrl()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                [[auth.oidc_providers]]
                slug = "test"
                display_name = "Test"
                authority = "https://auth.example.com"
                client_id = "id"
                client_secret = "secret"
                redirect_uri = "https://app/callback"
                """);

            var config = ConfigLoader.Load(path);

            config.Auth.OidcProviders.Should().HaveCount(1);
            config.Auth.OidcProviders[0].DiscoveryUrl.Should().Be("https://auth.example.com");
            config.Auth.OidcProviders[0].Slug.Should().Be("test");
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_OidcProviders_ArrayIsSupported()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, """
                [[auth.oidc_providers]]
                slug = "pocketid"
                discovery_url = "https://id.example.com/.well-known/openid-configuration"
                client_id = "first-id"
                client_secret = "first-secret"
                redirect_uri = "https://app/callback/first"

                [[auth.oidc_providers]]
                slug = "zitadel"
                display_name = "Zitadel"
                discovery_url = "https://login.example.com/.well-known/openid-configuration"
                client_id = "second-id"
                client_secret = "second-secret"
                redirect_uri = "https://app/callback/second"
                """);

            var config = ConfigLoader.Load(path);

            config.Auth.OidcProviders.Should().HaveCount(2);
            config.Auth.OidcProviders[0].DisplayName.Should().Be("pocketid");
            config.Auth.FindOidcProvider("zitadel").Should().NotBeNull();
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Test]
    [NotInParallel(nameof(EnvironmentVariables))]
    public void Load_EnvVarOverridesFirstOidcProvider()
    {
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_SLUG", "authentik");
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_DISPLAY_NAME", "Authentik");
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_DISCOVERY_URL", "https://auth.example.com/.well-known/openid-configuration");
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_CLIENT_ID", "my-id");
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_CLIENT_SECRET", "my-secret");
        Environment.SetEnvironmentVariable("CLAUDIO_OIDC_REDIRECT_URI", "https://app/callback");
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Auth.OidcProviders.Should().HaveCount(1);
            config.Auth.OidcProviders[0].Slug.Should().Be("authentik");
            config.Auth.OidcProviders[0].DisplayName.Should().Be("Authentik");
            config.Auth.OidcProviders[0].DiscoveryUrl.Should().Be("https://auth.example.com/.well-known/openid-configuration");
            config.Auth.OidcProviders[0].ClientId.Should().Be("my-id");
            config.Auth.OidcProviders[0].ClientSecret.Should().Be("my-secret");
            config.Auth.OidcProviders[0].RedirectUri.Should().Be("https://app/callback");
            config.Auth.OidcProviders[0].IsConfigured.Should().BeTrue();
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_SLUG", null);
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_DISPLAY_NAME", null);
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_DISCOVERY_URL", null);
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_CLIENT_ID", null);
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_CLIENT_SECRET", null);
            Environment.SetEnvironmentVariable("CLAUDIO_OIDC_REDIRECT_URI", null);
        }
    }
}
