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
        config.Database.Provider.Should().Be("sqlite");
        config.Library.LibraryPaths.Should().BeEquivalentTo(["/games"]);
        config.Library.ExcludePlatforms.Should().BeEmpty();
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
                """);

            var config = ConfigLoader.Load(path);

            config.Library.LibraryPaths.Should().BeEquivalentTo(["/mnt/games", "/mnt/roms"]);
            config.Library.ExcludePlatforms.Should().BeEquivalentTo(["ps", "gba"]);
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

                [database]
                provider = "postgres"
                postgres_connection = "Host=db;Database=claudio"
                """);

            var config = ConfigLoader.Load(path);

            config.Server.Port.Should().Be(9090);
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
        try
        {
            var config = ConfigLoader.Load("/nonexistent.toml");

            config.Igdb.ClientId.Should().Be("test-id");
            config.Igdb.ClientSecret.Should().Be("test-secret");
        }
        finally
        {
            Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_ID", null);
            Environment.SetEnvironmentVariable("CLAUDIO_IGDB_CLIENT_SECRET", null);
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
    public void Load_OidcProvider_FallsBackAuthorityToDiscoveryUrl()
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

            config.Auth.OidcProviders.Should().ContainSingle();
            config.Auth.OidcProviders[0].DiscoveryUrl.Should().Be("https://auth.example.com");
        }
        finally
        {
            File.Delete(path);
        }
    }
}
