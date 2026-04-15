use std::{path::Path, sync::Arc};

use axum::{
    body::Body,
    http::{Request, Response, StatusCode},
    Router,
};
use claudio_api::{
    auth::jwt::JwtKeys,
    build_router,
    config::{ClaudioConfig, DatabaseConfig, LibraryConfig},
    db,
    entity::game,
    services::{
        compression::CompressionService,
        config_file::ConfigFileService,
        download::DownloadService,
        igdb::IgdbService,
        library_scan::LibraryScanService,
        nonce_store::{ExternalLoginNonceStore, ProxyNonceStore},
        oauth::OAuthStateStore,
        ticket::{DownloadTicketStore, EmulationTicketStore},
    },
    state::AppState,
};
use http_body_util::BodyExt;
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde_json::Value;
use tower::ServiceExt;

/// A fully wired Axum app backed by an isolated in-process SQLite database.
///
/// Each `TestApp` instance owns its own temp directory and database so tests
/// run independently without sharing state.
pub struct TestApp {
    router: Router,
    pub state: Arc<AppState>,
    // Kept alive so the temp dir isn't deleted while the app is running.
    _temp_dir: tempfile::TempDir,
}

impl TestApp {
    pub async fn new() -> Self {
        Self::with_config(|_| {}).await
    }

    pub async fn with_config(configure: impl FnOnce(&mut ClaudioConfig)) -> Self {
        let temp_dir = tempfile::tempdir().expect("create temp dir");

        let db_path = temp_dir.path().join("test.db");
        let mut config = ClaudioConfig {
            database: DatabaseConfig {
                provider: "sqlite".to_string(),
                sqlite_path: db_path.to_str().expect("valid utf-8 path").to_string(),
                postgres_connection: None,
            },
            library: LibraryConfig {
                library_paths: vec![temp_dir
                    .path()
                    .to_str()
                    .expect("valid utf-8 path")
                    .to_string()],
                exclude_platforms: vec![],
                scan_interval_secs: 120,
            },
            ..Default::default()
        };
        configure(&mut config);
        let config = Arc::new(config);

        let db = db::connect(&config).await.expect("connect to test db");
        db::run_migrations(&db).await.expect("run migrations");

        let jwt = Arc::new(JwtKeys::load_or_generate(temp_dir.path()).expect("generate jwt keys"));
        let config_file_service = Arc::new(ConfigFileService::new(
            temp_dir.path().join("config.toml"),
            &config,
        ));
        let http_client = reqwest::Client::builder()
            .user_agent("claudio-test")
            .build()
            .expect("build http client");
        let compression_service = Arc::new(CompressionService::new(db.clone()));
        let igdb_service = Arc::new(IgdbService::new(
            db.clone(),
            http_client.clone(),
            Arc::clone(&config_file_service),
        ));
        let library_scan_service = Arc::new(LibraryScanService::new(
            db.clone(),
            Arc::clone(&config),
            Arc::clone(&config_file_service),
            http_client.clone(),
            Arc::clone(&compression_service),
            Arc::clone(&igdb_service),
        ));
        let download_service =
            Arc::new(DownloadService::new(&config).expect("create download service"));

        let images_dir = temp_dir.path().join("images");
        std::fs::create_dir_all(&images_dir).expect("create images dir");

        let state = Arc::new(AppState {
            db,
            images_dir,
            config,
            jwt,
            http_client,
            config_file_service,
            proxy_nonce_store: Arc::new(ProxyNonceStore::new()),
            external_login_nonce_store: Arc::new(ExternalLoginNonceStore::new()),
            github_state_store: Arc::new(OAuthStateStore::new()),
            google_state_store: Arc::new(OAuthStateStore::new()),
            oidc_state_store: Arc::new(OAuthStateStore::new()),
            emulation_ticket_store: Arc::new(EmulationTicketStore::new()),
            download_ticket_store: Arc::new(DownloadTicketStore::new()),
            download_service,
            compression_service,
            igdb_service,
            library_scan_service,
        });

        let router = build_router(Arc::clone(&state));

        Self {
            router,
            state,
            _temp_dir: temp_dir,
        }
    }

    pub async fn get(&self, uri: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("GET")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    pub async fn get_authed(&self, uri: &str, token: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    pub async fn post_json(&self, uri: &str, body: &Value) -> Response<Body> {
        self.send(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_vec(body).unwrap()))
                .unwrap(),
        )
        .await
    }

    pub async fn post_json_authed(&self, uri: &str, body: &Value, token: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(body).unwrap()))
                .unwrap(),
        )
        .await
    }

    pub async fn put_json_authed(&self, uri: &str, body: &Value, token: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(body).unwrap()))
                .unwrap(),
        )
        .await
    }

    pub async fn delete_authed(&self, uri: &str, token: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
    }

    pub async fn post_form(&self, uri: &str, form_body: &str) -> Response<Body> {
        self.send(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(Body::from(form_body.to_string()))
                .unwrap(),
        )
        .await
    }

    pub async fn send_request(&self, req: Request<Body>) -> Response<Body> {
        self.send(req).await
    }

    pub fn root(&self) -> &Path {
        self._temp_dir.path()
    }

    pub async fn seed_game(
        &self,
        title: &str,
        platform: &str,
        folder_name: &str,
        folder_path: &Path,
        install_type: &str,
    ) -> i32 {
        let game = game::ActiveModel {
            title: Set(title.to_string()),
            platform: Set(platform.to_string()),
            folder_name: Set(folder_name.to_string()),
            folder_path: Set(folder_path.to_string_lossy().to_string()),
            install_type: Set(install_type.to_string()),
            size_bytes: Set(1024),
            is_missing: Set(false),
            is_processing: Set(false),
            ..Default::default()
        }
        .insert(&self.state.db)
        .await
        .expect("insert seeded game");

        game.id
    }

    async fn send(&self, req: Request<Body>) -> Response<Body> {
        self.router
            .clone()
            .oneshot(req)
            .await
            .expect("router handled request")
    }

    /// Registers a user and returns on success (panics on failure).
    pub async fn register(&self, username: &str, password: &str) {
        let resp = self
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": username, "password": password }),
            )
            .await;
        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "register user '{username}' failed with status {}",
            resp.status()
        );
    }

    /// Registers a user and logs in, returning the access token.
    pub async fn register_and_login(&self, username: &str, password: &str) -> String {
        self.register(username, password).await;
        self.login(username, password).await
    }

    /// Logs in with username/password and returns the access token.
    pub async fn login(&self, username: &str, password: &str) -> String {
        let resp = self
            .post_form(
                "/connect/token",
                &format!("grant_type=password&username={username}&password={password}"),
            )
            .await;
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "login for '{username}' failed with status {}",
            resp.status()
        );
        let body = read_json(resp).await;
        body["access_token"]
            .as_str()
            .expect("access_token in response")
            .to_string()
    }
}

/// Reads the response body as JSON.
pub async fn read_json(resp: Response<Body>) -> Value {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect response body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("parse response body as JSON")
}

/// Reads the response body as a plain string.
pub async fn read_text(resp: Response<Body>) -> String {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect response body")
        .to_bytes();
    String::from_utf8(bytes.to_vec()).expect("response body is valid UTF-8")
}

/// URL-encodes a string for use in `application/x-www-form-urlencoded` bodies.
///
/// Necessary for values like base64 refresh tokens that contain `+` or `/`.
pub fn url_encode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}
