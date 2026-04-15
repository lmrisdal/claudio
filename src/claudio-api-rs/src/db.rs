use claudio_migration::MigratorTrait;
use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use tracing::{debug, info};

use crate::config::ClaudioConfig;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("PostgreSQL selected but postgres_connection is not configured")]
    MissingPostgresConnection,
    #[error("database error: {0}")]
    SeaOrm(#[from] DbErr),
}

pub async fn connect(config: &ClaudioConfig) -> Result<DatabaseConnection, DbError> {
    let is_sqlite = config.database.provider != "postgres";

    let url = if !is_sqlite {
        config
            .database
            .postgres_connection
            .clone()
            .ok_or(DbError::MissingPostgresConnection)?
    } else {
        format!("sqlite://{}?mode=rwc", config.database.sqlite_path)
    };

    let mut opts = ConnectOptions::new(&url);

    if is_sqlite {
        opts.max_connections(2);
    }

    debug!("connecting to database");
    let db = Database::connect(opts).await?;
    info!("database connection established");
    Ok(db)
}

pub async fn run_migrations(db: &DatabaseConnection) -> Result<(), DbErr> {
    claudio_migration::Migrator::up(db, None).await
}
