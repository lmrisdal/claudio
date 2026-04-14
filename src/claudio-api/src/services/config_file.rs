use std::{
    path::{Path, PathBuf},
    sync::RwLock,
};

use thiserror::Error;
use toml::{map::Map, Value};

use crate::config::ClaudioConfig;

#[derive(Debug, Clone)]
pub struct ApiCredentials {
    pub igdb_client_id: String,
    pub igdb_client_secret: String,
    pub steamgriddb_api_key: String,
}

pub struct ConfigFileService {
    config_path: PathBuf,
    credentials: RwLock<ApiCredentials>,
}

#[derive(Debug, Error)]
pub enum ConfigFileError {
    #[error("config state is unavailable")]
    StateUnavailable,
    #[error("failed to read config file '{0}': {1}")]
    ReadFailed(String, #[source] std::io::Error),
    #[error("failed to parse config file '{0}': {1}")]
    ParseFailed(String, #[source] toml::de::Error),
    #[error("failed to serialize config file: {0}")]
    SerializeFailed(#[from] toml::ser::Error),
    #[error("failed to create config directory '{0}': {1}")]
    CreateDirectoryFailed(String, #[source] std::io::Error),
    #[error("failed to write config file '{0}': {1}")]
    WriteFailed(String, #[source] std::io::Error),
}

impl ConfigFileService {
    pub fn new(config_path: impl AsRef<Path>, config: &ClaudioConfig) -> Self {
        Self {
            config_path: config_path.as_ref().to_path_buf(),
            credentials: RwLock::new(ApiCredentials {
                igdb_client_id: config.igdb.client_id.clone(),
                igdb_client_secret: config.igdb.client_secret.clone(),
                steamgriddb_api_key: config.steamgriddb.api_key.clone(),
            }),
        }
    }

    pub fn credentials(&self) -> Result<ApiCredentials, ConfigFileError> {
        self.credentials
            .read()
            .map_err(|_| ConfigFileError::StateUnavailable)
            .map(|credentials| credentials.clone())
    }

    pub fn update_api_credentials(
        &self,
        igdb_client_id: Option<String>,
        igdb_client_secret: Option<String>,
        steamgriddb_api_key: Option<String>,
    ) -> Result<ApiCredentials, ConfigFileError> {
        let updated_credentials = {
            let mut credentials = self
                .credentials
                .write()
                .map_err(|_| ConfigFileError::StateUnavailable)?;

            if let Some(value) = igdb_client_id {
                credentials.igdb_client_id = value;
            }

            if let Some(value) = igdb_client_secret {
                credentials.igdb_client_secret = value;
            }

            if let Some(value) = steamgriddb_api_key {
                credentials.steamgriddb_api_key = value;
            }

            credentials.clone()
        };

        self.write_credentials(&updated_credentials)?;
        Ok(updated_credentials)
    }

    fn write_credentials(&self, credentials: &ApiCredentials) -> Result<(), ConfigFileError> {
        let config_path_display = self.config_path.display().to_string();
        let mut document = match std::fs::read_to_string(&self.config_path) {
            Ok(content) => toml::from_str::<toml::Table>(&content).map_err(|error| {
                ConfigFileError::ParseFailed(config_path_display.clone(), error)
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => toml::Table::new(),
            Err(error) => {
                return Err(ConfigFileError::ReadFailed(
                    config_path_display.clone(),
                    error,
                ));
            }
        };

        update_string_table(
            &mut document,
            "igdb",
            &[
                ("client_id", &credentials.igdb_client_id),
                ("client_secret", &credentials.igdb_client_secret),
            ],
        );
        update_string_table(
            &mut document,
            "steamgriddb",
            &[("api_key", &credentials.steamgriddb_api_key)],
        );

        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                ConfigFileError::CreateDirectoryFailed(parent.display().to_string(), error)
            })?;
        }

        let serialized = toml::to_string_pretty(&document)?;
        std::fs::write(&self.config_path, serialized)
            .map_err(|error| ConfigFileError::WriteFailed(config_path_display, error))
    }
}

fn update_string_table(document: &mut toml::Table, section_name: &str, entries: &[(&str, &str)]) {
    let section = document
        .entry(section_name.to_string())
        .or_insert_with(|| Value::Table(Map::new()));

    if !section.is_table() {
        *section = Value::Table(Map::new());
    }

    if let Some(table) = section.as_table_mut() {
        for (key, value) in entries {
            table.insert((*key).to_string(), Value::String((*value).to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ConfigFileService;
    use crate::config::ClaudioConfig;

    #[test]
    fn update_api_credentials_should_persist_igdb_and_steamgriddb_sections() {
        let temp_dir = std::env::temp_dir().join(format!(
            "claudio-config-file-service-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let config_path = temp_dir.join("config.toml");

        let service = ConfigFileService::new(&config_path, &ClaudioConfig::default());
        service
            .update_api_credentials(
                Some("client-id".to_string()),
                Some("client-secret".to_string()),
                Some("sgdb-key".to_string()),
            )
            .unwrap();

        let persisted = std::fs::read_to_string(&config_path).unwrap();
        assert!(persisted.contains("[igdb]"));
        assert!(persisted.contains("client_id = \"client-id\""));
        assert!(persisted.contains("client_secret = \"client-secret\""));
        assert!(persisted.contains("[steamgriddb]"));
        assert!(persisted.contains("api_key = \"sgdb-key\""));

        let _ = std::fs::remove_file(&config_path);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
