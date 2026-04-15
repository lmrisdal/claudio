use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use claudio_api::{
    auth, build_router, config, db,
    services::{
        compression::CompressionService,
        download::DownloadService,
        igdb::IgdbService,
        library_scan::LibraryScanService,
        nonce_store::{ExternalLoginNonceStore, ProxyNonceStore},
        oauth::OAuthStateStore,
        ticket::{DownloadTicketStore, EmulationTicketStore},
    },
    state::AppState,
};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path =
        std::env::var("CLAUDIO_CONFIG_PATH").unwrap_or_else(|_| "config/config.toml".to_string());

    let config_store = Arc::new(config::ConfigStore::load(&config_path)?);
    let config = config_store.current()?;

    tracing_subscriber::registry()
        .with(EnvFilter::new(&config.server.log_level))
        .with(fmt::layer())
        .init();

    let port = config.server.port;

    let config_dir = config.config_dir(&config_path);
    std::fs::create_dir_all(&config_dir)?;

    let db = db::connect(&config).await?;
    db::run_migrations(&db).await?;

    let images_dir = config_dir.join("images");
    std::fs::create_dir_all(&images_dir)?;

    let static_root = resolve_static_root();

    let shared_config = Arc::new(config);
    let jwt = auth::jwt::JwtKeys::load_or_generate(&config_dir)?;
    let download_service = Arc::new(DownloadService::new(&shared_config)?);
    let http_client = reqwest::Client::builder().user_agent("claudio").build()?;
    let compression_service = Arc::new(CompressionService::new(db.clone()));
    let igdb_service = Arc::new(IgdbService::new(
        db.clone(),
        http_client.clone(),
        Arc::clone(&config_store),
    ));
    let library_scan_service = Arc::new(LibraryScanService::new(
        db.clone(),
        Arc::clone(&shared_config),
        Arc::clone(&config_store),
        http_client.clone(),
        Arc::clone(&compression_service),
        Arc::clone(&igdb_service),
    ));

    let state = Arc::new(AppState {
        db,
        images_dir: images_dir.clone(),
        config: shared_config,
        jwt: Arc::new(jwt),
        http_client,
        config_store,
        proxy_nonce_store: Arc::new(ProxyNonceStore::new()),
        external_login_nonce_store: Arc::new(ExternalLoginNonceStore::new()),
        github_state_store: Arc::new(OAuthStateStore::new()),
        google_state_store: Arc::new(OAuthStateStore::new()),
        oidc_state_store: Arc::new(OAuthStateStore::new()),
        emulation_ticket_store: Arc::new(EmulationTicketStore::new()),
        download_ticket_store: Arc::new(DownloadTicketStore::new()),
        download_service,
        compression_service: Arc::clone(&compression_service),
        igdb_service: Arc::clone(&igdb_service),
        library_scan_service: Arc::clone(&library_scan_service),
    });

    tokio::spawn(Arc::clone(&compression_service).run_queue());
    tokio::spawn(Arc::clone(&library_scan_service).run_scheduler());

    let app = build_router(Arc::clone(&state))
        .nest_service("/images", ServeDir::new(&images_dir))
        .fallback_service(
            ServeDir::new(&static_root).fallback(ServeFile::new(static_root.join("index.html"))),
        );

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Claudio API listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("shutdown signal received, draining connections");
}

fn resolve_static_root() -> PathBuf {
    [
        PathBuf::from("wwwroot"),
        PathBuf::from("src/claudio-api/wwwroot"),
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|dir| dir.join("wwwroot")))
            .unwrap_or_else(|| PathBuf::from("wwwroot")),
    ]
    .into_iter()
    .find(|path| path.join("index.html").is_file())
    .unwrap_or_else(|| PathBuf::from("src/claudio-api/wwwroot"))
}
