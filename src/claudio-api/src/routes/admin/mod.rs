use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
    Router,
};

use crate::{state::AppState, MULTIPART_BODY_LIMIT};

mod config;
mod games;
mod shared;
mod steamgriddb;
mod tasks;
mod users;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/admin/users", get(users::list_users))
        .route("/api/admin/users/{id}", delete(users::delete_user))
        .route("/api/admin/users/{id}/role", put(users::update_user_role))
        .route("/api/admin/scan", post(tasks::trigger_scan))
        .route("/api/admin/scan/igdb", post(tasks::trigger_igdb_scan))
        .route(
            "/api/admin/scan/igdb/status",
            get(tasks::get_igdb_scan_status),
        )
        .route(
            "/api/admin/games/{id}",
            put(games::update_game).delete(games::delete_game),
        )
        .route(
            "/api/admin/games/{id}/executables",
            get(games::list_game_executables),
        )
        .route(
            "/api/admin/games/{id}/igdb/search",
            post(tasks::search_game_igdb),
        )
        .route("/api/admin/igdb/search", post(tasks::search_igdb_free_text))
        .route(
            "/api/admin/games/{id}/igdb/apply",
            post(tasks::apply_game_igdb),
        )
        .route(
            "/api/admin/games/{id}/compress",
            post(tasks::queue_compression),
        )
        .route(
            "/api/admin/games/{id}/compress/cancel",
            post(tasks::cancel_compression),
        )
        .route(
            "/api/admin/compress/status",
            get(tasks::get_compression_status),
        )
        .route("/api/admin/tasks/status", get(tasks::get_tasks_status))
        .route("/api/admin/games/{id}/tag-folder", post(games::tag_folder))
        .route(
            "/api/admin/games/missing",
            delete(games::delete_missing_games),
        )
        .route(
            "/api/admin/steamgriddb/search",
            get(steamgriddb::search_steamgriddb),
        )
        .route(
            "/api/admin/steamgriddb/{sgdb_game_id}/covers",
            get(steamgriddb::get_steamgriddb_covers),
        )
        .route(
            "/api/admin/steamgriddb/{sgdb_game_id}/heroes",
            get(steamgriddb::get_steamgriddb_heroes),
        )
        .route(
            "/api/admin/config",
            get(config::get_config).put(config::update_config),
        )
        .route(
            "/api/admin/games/{id}/upload-image",
            post(games::upload_image).layer(DefaultBodyLimit::max(MULTIPART_BODY_LIMIT)),
        )
}
