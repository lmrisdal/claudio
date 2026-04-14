pub mod auth;
pub mod config;
pub mod db;
pub mod entity;
pub mod models;
pub mod routes;
pub mod services;
pub mod state;
pub mod util;

pub const MULTIPART_BODY_LIMIT: usize = 256 * 1024 * 1024;

use std::sync::Arc;

use axum::{extract::DefaultBodyLimit, Router};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

/// Builds the core API router without static file serving.
///
/// Used by the binary (which adds SPA fallback and image serving) and
/// by integration tests that need a fully wired router without touching
/// the filesystem for static assets.
pub fn build_router(state: Arc<state::AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .merge(routes::health::router())
        .merge(routes::connect::router())
        .merge(routes::auth::router())
        .merge(routes::admin::router())
        .merge(routes::games::router())
        .merge(routes::game_downloads::router())
        .merge(routes::oauth::router())
        .layer(DefaultBodyLimit::max(MULTIPART_BODY_LIMIT))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
