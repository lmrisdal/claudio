use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::RwLock,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("config state is unavailable")]
    StateUnavailable,
    #[error("failed to read config file '{0}': {1}")]
    ReadFailed(String, #[source] std::io::Error),
    #[error("failed to parse config: {0}")]
    ParseFailed(#[from] toml::de::Error),
    #[error("failed to serialize config file: {0}")]
    SerializeFailed(#[from] toml::ser::Error),
    #[error("failed to create config directory '{0}': {1}")]
    CreateDirectoryFailed(String, #[source] std::io::Error),
    #[error("failed to write config file '{0}': {1}")]
    WriteFailed(String, #[source] std::io::Error),
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ClaudioConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub igdb: IgdbConfig,
    pub steamgriddb: SteamGridDbConfig,
    pub library: LibraryConfig,
}

impl ClaudioConfig {
    pub fn load(path: &str) -> Result<Self, ConfigError> {
        let mut config = Self::load_persisted(path)?;

        config.apply_env_overrides();
        config.normalize();

        Ok(config)
    }

    pub fn load_and_persist(path: &str) -> Result<Self, ConfigError> {
        let config = Self::load(path)?;
        config.persist(path)?;
        Ok(config)
    }

    fn load_persisted(path: &str) -> Result<Self, ConfigError> {
        match std::fs::read_to_string(path) {
            Ok(contents) => toml::from_str(&contents).map_err(ConfigError::from),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(ConfigError::ReadFailed(path.to_string(), error)),
        }
    }

    pub fn persist(&self, path: &str) -> Result<(), ConfigError> {
        let config_path = Path::new(path);

        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                ConfigError::CreateDirectoryFailed(parent.display().to_string(), error)
            })?;
        }

        let serialized = toml::to_string_pretty(self)?;
        std::fs::write(config_path, serialized)
            .map_err(|error| ConfigError::WriteFailed(path.to_string(), error))
    }

    fn normalize(&mut self) {
        if self.auth.oidc_provider.discovery_url.is_empty()
            && !self.auth.oidc_provider.authority.is_empty()
        {
            self.auth.oidc_provider.discovery_url = self.auth.oidc_provider.authority.clone();
        }

        for provider in &mut self.auth.oidc_providers {
            if provider.discovery_url.is_empty() && !provider.authority.is_empty() {
                provider.discovery_url = provider.authority.clone();
            }
        }
    }

    pub fn config_dir(&self, config_path: &str) -> PathBuf {
        Path::new(config_path)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(config_path))
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("config"))
    }

    fn apply_env_overrides(&mut self) {
        if let Ok(value) = std::env::var("CLAUDIO_PORT") {
            if let Ok(port) = value.parse() {
                self.server.port = port;
            }
        }

        if let Ok(value) = std::env::var("CLAUDIO_LOG_LEVEL") {
            self.server.log_level = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_LIBRARY_PATHS") {
            self.library.library_paths = split_csv(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_EXCLUDE_PLATFORMS") {
            self.library.exclude_platforms = split_csv(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_IGDB_CLIENT_ID") {
            self.igdb.client_id = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_IGDB_CLIENT_SECRET") {
            self.igdb.client_secret = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_DISABLE_AUTH") {
            self.auth.disable_auth = parse_bool_env(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_DISABLE_LOCAL_LOGIN") {
            self.auth.disable_local_login = parse_bool_env(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_DISABLE_USER_CREATION") {
            self.auth.disable_user_creation = parse_bool_env(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_DB_PROVIDER") {
            self.database.provider = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_DB_SQLITE_PATH") {
            self.database.sqlite_path = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_DB_POSTGRES") {
            self.database.postgres_connection = Some(value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_SCAN_INTERVAL") {
            if let Ok(secs) = value.parse() {
                self.library.scan_interval_secs = secs;
            }
        }

        if let Ok(value) = std::env::var("CLAUDIO_STEAMGRIDDB_API_KEY") {
            self.steamgriddb.api_key = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_PROXY_AUTH_HEADER") {
            self.auth.proxy_auth_header = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_PROXY_AUTH_AUTO_CREATE") {
            self.auth.proxy_auth_auto_create = parse_bool_env(&value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_GITHUB_CLIENT_ID") {
            self.auth.github.client_id = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_GITHUB_CLIENT_SECRET") {
            self.auth.github.client_secret = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_GITHUB_REDIRECT_URI") {
            self.auth.github.redirect_uri = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_GOOGLE_CLIENT_ID") {
            self.auth.google.client_id = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_GOOGLE_CLIENT_SECRET") {
            self.auth.google.client_secret = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_GOOGLE_REDIRECT_URI") {
            self.auth.google.redirect_uri = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_SLUG") {
            self.auth.oidc_provider.slug = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_DISPLAY_NAME") {
            self.auth.oidc_provider.display_name = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_LOGO_URL") {
            self.auth.oidc_provider.logo_url = Some(value);
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_DISCOVERY_URL") {
            self.auth.oidc_provider.discovery_url = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_CLIENT_ID") {
            self.auth.oidc_provider.client_id = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_CLIENT_SECRET") {
            self.auth.oidc_provider.client_secret = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_REDIRECT_URI") {
            self.auth.oidc_provider.redirect_uri = value;
        }

        if let Ok(value) = std::env::var("CLAUDIO_OIDC_SCOPE") {
            self.auth.oidc_provider.scope = value;
        }
    }
}

#[derive(Debug, Clone)]
pub struct ApiCredentials {
    pub igdb_client_id: String,
    pub igdb_client_secret: String,
    pub steamgriddb_api_key: String,
}

pub struct ConfigStore {
    config_path: PathBuf,
    config: RwLock<ClaudioConfig>,
}

impl ConfigStore {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let config_path = path.as_ref().to_path_buf();
        let config = ClaudioConfig::load_and_persist(&config_path.display().to_string())?;

        Ok(Self {
            config_path,
            config: RwLock::new(config),
        })
    }

    pub fn current(&self) -> Result<ClaudioConfig, ConfigError> {
        self.config
            .read()
            .map_err(|_| ConfigError::StateUnavailable)
            .map(|config| config.clone())
    }

    pub fn credentials(&self) -> Result<ApiCredentials, ConfigError> {
        let config = self.current()?;

        Ok(ApiCredentials {
            igdb_client_id: config.igdb.client_id,
            igdb_client_secret: config.igdb.client_secret,
            steamgriddb_api_key: config.steamgriddb.api_key,
        })
    }

    pub fn update_api_credentials(
        &self,
        igdb_client_id: Option<String>,
        igdb_client_secret: Option<String>,
        steamgriddb_api_key: Option<String>,
    ) -> Result<ApiCredentials, ConfigError> {
        let config_path = self.config_path.display().to_string();
        let mut persisted_config = ClaudioConfig::load_persisted(&config_path)?;

        if let Some(value) = igdb_client_id {
            persisted_config.igdb.client_id = value;
        }

        if let Some(value) = igdb_client_secret {
            persisted_config.igdb.client_secret = value;
        }

        if let Some(value) = steamgriddb_api_key {
            persisted_config.steamgriddb.api_key = value;
        }

        persisted_config.persist(&config_path)?;

        let mut effective_config = persisted_config.clone();
        effective_config.apply_env_overrides();
        effective_config.normalize();

        {
            let mut config = self
                .config
                .write()
                .map_err(|_| ConfigError::StateUnavailable)?;
            *config = effective_config;
        }

        self.credentials()
    }
}

fn parse_bool_env(value: &str) -> bool {
    value.eq_ignore_ascii_case("true")
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct ServerConfig {
    pub port: u16,
    pub log_level: String,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            log_level: "warn".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct DatabaseConfig {
    pub provider: String,
    pub sqlite_path: String,
    pub postgres_connection: Option<String>,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            provider: "sqlite".to_string(),
            sqlite_path: "/config/claudio.db".to_string(),
            postgres_connection: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[serde(default)]
pub struct AuthConfig {
    pub disable_auth: bool,
    pub disable_local_login: bool,
    pub disable_user_creation: bool,
    pub proxy_auth_header: String,
    pub proxy_auth_auto_create: bool,
    pub github: GitHubOAuthConfig,
    pub google: GoogleOAuthConfig,
    pub oidc_provider: OidcProviderConfig,
    pub oidc_providers: Vec<OidcProviderConfig>,
}

impl AuthConfig {
    pub fn oidc_providers(&self) -> Vec<&OidcProviderConfig> {
        let configured_plural = self
            .oidc_providers
            .iter()
            .filter(|provider| provider.is_configured());

        if self.oidc_provider.is_configured() {
            configured_plural
                .chain(std::iter::once(&self.oidc_provider))
                .collect()
        } else {
            configured_plural.collect()
        }
    }

    pub fn find_oidc_provider(&self, slug: &str) -> Option<&OidcProviderConfig> {
        self.oidc_providers()
            .into_iter()
            .find(|provider| provider.slug == slug)
    }
}

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[serde(default)]
pub struct GitHubOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl GitHubOAuthConfig {
    pub fn is_configured(&self) -> bool {
        !self.client_id.is_empty()
            && !self.client_secret.is_empty()
            && !self.redirect_uri.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[serde(default)]
pub struct GoogleOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl GoogleOAuthConfig {
    pub fn is_configured(&self) -> bool {
        !self.client_id.is_empty()
            && !self.client_secret.is_empty()
            && !self.redirect_uri.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct OidcProviderConfig {
    pub slug: String,
    pub display_name: String,
    pub logo_url: Option<String>,
    pub discovery_url: String,
    pub authority: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub scope: String,
    pub user_id_claim: String,
    pub username_claim: String,
    pub name_claim: String,
    pub email_claim: String,
}

impl Default for OidcProviderConfig {
    fn default() -> Self {
        Self {
            slug: String::new(),
            display_name: String::new(),
            logo_url: None,
            discovery_url: String::new(),
            authority: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            redirect_uri: String::new(),
            scope: "openid profile email".to_string(),
            user_id_claim: "sub".to_string(),
            username_claim: "preferred_username".to_string(),
            name_claim: "name".to_string(),
            email_claim: "email".to_string(),
        }
    }
}

impl OidcProviderConfig {
    pub fn is_configured(&self) -> bool {
        !self.slug.is_empty()
            && !self.display_name.is_empty()
            && !self.discovery_url.is_empty()
            && !self.client_id.is_empty()
            && !self.client_secret.is_empty()
            && !self.redirect_uri.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[serde(default)]
pub struct IgdbConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[serde(default)]
pub struct SteamGridDbConfig {
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct LibraryConfig {
    pub library_paths: Vec<String>,
    pub exclude_platforms: Vec<String>,
    pub scan_interval_secs: u64,
}

impl Default for LibraryConfig {
    fn default() -> Self {
        Self {
            library_paths: vec!["/games".to_string()],
            exclude_platforms: Vec::new(),
            scan_interval_secs: 120,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Mutex};

    use super::{ClaudioConfig, ConfigStore};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn load_missing_file_returns_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();

        let config = ClaudioConfig::load("/definitely/missing/claudio.toml").unwrap();

        assert_eq!(config.server.port, 8080);
        assert_eq!(config.database.provider, "sqlite");
        assert_eq!(config.library.library_paths, vec!["/games"]);
        assert!(config.library.exclude_platforms.is_empty());
    }

    #[test]
    fn load_and_persist_missing_file_writes_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("nested/config.toml");

        let config = ClaudioConfig::load_and_persist(path.to_str().unwrap()).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();

        assert_eq!(config.server.port, 8080);
        assert!(persisted.contains("[server]"));
        assert!(persisted.contains("port = 8080"));
        assert!(persisted.contains("sqlite_path = \"/config/claudio.db\""));
        assert!(persisted.contains("library_paths = [\"/games\"]"));
    }

    #[test]
    fn load_toml_file_parses_library_and_database_settings() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        fs::write(
            &path,
            r#"
[server]
port = 9090

[database]
provider = "postgres"
postgres_connection = "postgres://claudio@db/claudio"

[library]
library_paths = ["/mnt/games", "/mnt/roms"]
exclude_platforms = ["ps", "gba"]
"#,
        )
        .unwrap();

        let config = ClaudioConfig::load(path.to_str().unwrap()).unwrap();

        assert_eq!(config.server.port, 9090);
        assert_eq!(config.database.provider, "postgres");
        assert_eq!(
            config.database.postgres_connection.as_deref(),
            Some("postgres://claudio@db/claudio")
        );
        assert_eq!(
            config.library.library_paths,
            vec!["/mnt/games", "/mnt/roms"]
        );
        assert_eq!(config.library.exclude_platforms, vec!["ps", "gba"]);
    }

    #[test]
    fn load_env_vars_override_file_values() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        fs::write(
            &path,
            r#"
[library]
exclude_platforms = ["ps", "gba"]
"#,
        )
        .unwrap();

        std::env::set_var("CLAUDIO_LIBRARY_PATHS", "/a, /b, /c");
        std::env::set_var("CLAUDIO_EXCLUDE_PLATFORMS", "snes");
        std::env::set_var("CLAUDIO_DISABLE_AUTH", "TRUE");

        let config = ClaudioConfig::load(path.to_str().unwrap()).unwrap();

        assert_eq!(config.library.library_paths, vec!["/a", "/b", "/c"]);
        assert_eq!(config.library.exclude_platforms, vec!["snes"]);
        assert!(config.auth.disable_auth);

        std::env::remove_var("CLAUDIO_LIBRARY_PATHS");
        std::env::remove_var("CLAUDIO_EXCLUDE_PLATFORMS");
        std::env::remove_var("CLAUDIO_DISABLE_AUTH");
    }

    #[test]
    fn load_and_persist_writes_env_overrides() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        std::env::set_var("CLAUDIO_PORT", "9091");
        std::env::set_var("CLAUDIO_IGDB_CLIENT_ID", "docker-client");
        std::env::set_var("CLAUDIO_PROXY_AUTH_HEADER", "Remote-User");

        let config = ClaudioConfig::load_and_persist(path.to_str().unwrap()).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();

        assert_eq!(config.server.port, 9091);
        assert_eq!(config.igdb.client_id, "docker-client");
        assert_eq!(config.auth.proxy_auth_header, "Remote-User");
        assert!(persisted.contains("port = 9091"));
        assert!(persisted.contains("client_id = \"docker-client\""));
        assert!(persisted.contains("proxy_auth_header = \"Remote-User\""));

        std::env::remove_var("CLAUDIO_PORT");
        std::env::remove_var("CLAUDIO_IGDB_CLIENT_ID");
        std::env::remove_var("CLAUDIO_PROXY_AUTH_HEADER");
    }

    #[test]
    fn load_oidc_authority_falls_back_to_discovery_url() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        fs::write(
            &path,
            r#"
[auth.oidc_provider]
slug = "authentik"
display_name = "Authentik"
authority = "https://auth.example.com"
client_id = "my-id"
client_secret = "my-secret"
redirect_uri = "https://app/callback"
"#,
        )
        .unwrap();

        let config = ClaudioConfig::load(path.to_str().unwrap()).unwrap();

        assert_eq!(
            config.auth.oidc_provider.discovery_url,
            "https://auth.example.com"
        );
        assert!(config.auth.oidc_provider.is_configured());
    }

    #[test]
    fn load_oidc_providers_array() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        fs::write(
            &path,
            r#"
[[auth.oidc_providers]]
slug = "pocketid"
display_name = "Pocket ID"
authority = "https://id.example.com/.well-known/openid-configuration"
client_id = "client-id"
client_secret = "client-secret"
redirect_uri = "http://localhost:8080/api/auth/oidc/pocketid/callback"

[[auth.oidc_providers]]
slug = "zitadel"
display_name = "Zitadel"
discovery_url = "https://zitadel.example.com/.well-known/openid-configuration"
client_id = "zitadel-id"
client_secret = "zitadel-secret"
redirect_uri = "http://localhost:8080/api/auth/oidc/zitadel/callback"
"#,
        )
        .unwrap();

        let config = ClaudioConfig::load(path.to_str().unwrap()).unwrap();

        assert_eq!(config.auth.oidc_providers.len(), 2);
        assert_eq!(config.auth.oidc_providers[0].slug, "pocketid");
        assert_eq!(
            config.auth.oidc_providers[0].discovery_url,
            "https://id.example.com/.well-known/openid-configuration"
        );
        assert_eq!(config.auth.oidc_providers[1].slug, "zitadel");
        assert!(config.auth.find_oidc_provider("pocketid").is_some());
        assert!(config.auth.find_oidc_provider("zitadel").is_some());
    }

    #[test]
    fn config_store_updates_credentials_and_preserves_other_settings() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        fs::write(
            &path,
            r#"
[server]
port = 7777

[igdb]
client_id = "original-id"
client_secret = "original-secret"

[steamgriddb]
api_key = "original-key"
"#,
        )
        .unwrap();

        let store = ConfigStore::load(&path).unwrap();
        let credentials = store
            .update_api_credentials(
                Some("updated-id".to_string()),
                None,
                Some("updated-key".to_string()),
            )
            .unwrap();
        let persisted = fs::read_to_string(&path).unwrap();

        assert_eq!(credentials.igdb_client_id, "updated-id");
        assert_eq!(credentials.igdb_client_secret, "original-secret");
        assert_eq!(credentials.steamgriddb_api_key, "updated-key");
        assert!(persisted.contains("port = 7777"));
        assert!(persisted.contains("client_id = \"updated-id\""));
        assert!(persisted.contains("client_secret = \"original-secret\""));
        assert!(persisted.contains("api_key = \"updated-key\""));
    }

    #[test]
    fn config_store_keeps_env_credentials_active_after_admin_update() {
        let _guard = ENV_LOCK.lock().unwrap();
        let temp_dir = tempfile::tempdir().unwrap();
        let path = temp_dir.path().join("config.toml");

        std::env::set_var("CLAUDIO_IGDB_CLIENT_ID", "env-id");
        std::env::set_var("CLAUDIO_IGDB_CLIENT_SECRET", "env-secret");
        std::env::set_var("CLAUDIO_STEAMGRIDDB_API_KEY", "env-key");

        let store = ConfigStore::load(&path).unwrap();
        let credentials = store
            .update_api_credentials(
                Some("saved-id".to_string()),
                Some("saved-secret".to_string()),
                Some("saved-key".to_string()),
            )
            .unwrap();
        let persisted = fs::read_to_string(&path).unwrap();

        assert_eq!(credentials.igdb_client_id, "env-id");
        assert_eq!(credentials.igdb_client_secret, "env-secret");
        assert_eq!(credentials.steamgriddb_api_key, "env-key");
        assert!(persisted.contains("client_id = \"saved-id\""));
        assert!(persisted.contains("client_secret = \"saved-secret\""));
        assert!(persisted.contains("api_key = \"saved-key\""));

        std::env::remove_var("CLAUDIO_IGDB_CLIENT_ID");
        std::env::remove_var("CLAUDIO_IGDB_CLIENT_SECRET");
        std::env::remove_var("CLAUDIO_STEAMGRIDDB_API_KEY");
    }
}
