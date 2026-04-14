use std::fs;

use axum::http::StatusCode;
use claudio_api_tests::support;

// ── /api/games ───────────────────────────────────────────────────────────────

mod list_games {
    use super::*;

    #[tokio::test]
    async fn should_return_empty_list_when_no_games_exist() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/games", &token).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_return_json_array() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/games", &token).await;
        let body = support::read_json(resp).await;

        assert!(body.is_array(), "expected JSON array, got: {body:?}");
    }

    #[tokio::test]
    async fn should_filter_games_by_platform_and_search() {
        let app = support::TestApp::new().await;
        let doom_dir = app.root().join("pc/Doom");
        let sonic_dir = app.root().join("genesis/Sonic");
        fs::create_dir_all(&doom_dir).unwrap();
        fs::create_dir_all(&sonic_dir).unwrap();
        app.seed_game("Doom", "pc", "Doom", &doom_dir, "portable")
            .await;
        app.seed_game("Sonic", "genesis", "Sonic", &sonic_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed("/api/games?platform=pc&search=oom", &token)
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body.as_array().unwrap().len(), 1);
        assert_eq!(body[0]["title"], "Doom");
    }

    #[tokio::test]
    async fn should_reject_unauthenticated_request() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/games").await;

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn should_allow_unauthenticated_request_when_auth_is_disabled() {
        let app = support::TestApp::with_config(|config| {
            config.auth.disable_auth = true;
        })
        .await;

        let resp = app.get("/api/games").await;

        assert_eq!(resp.status(), StatusCode::OK);
    }
}

// ── /api/games/{id} ──────────────────────────────────────────────────────────

mod get_game {
    use super::*;

    #[tokio::test]
    async fn should_return_404_for_nonexistent_game() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/games/9999", &token).await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn should_reject_unauthenticated_request() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/games/1").await;

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

// ── /api/games/{id}/executables ──────────────────────────────────────────────

mod list_executables {
    use super::*;

    #[tokio::test]
    async fn should_return_404_for_nonexistent_game() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/games/9999/executables", &token).await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn should_list_executables_for_existing_game_folder() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary").unwrap();
        fs::write(game_dir.join("readme.txt"), "notes").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(&format!("/api/games/{game_id}/executables"), &token)
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body.as_array().unwrap().len(), 1);
        assert_eq!(body[0], "doom.exe");
    }
}

mod browse_game_files {
    use super::*;

    #[tokio::test]
    async fn should_return_directory_listing_for_existing_game() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(game_dir.join("docs")).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(&format!("/api/games/{game_id}/browse"), &token)
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body["entries"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn should_reject_path_traversal() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(
                &format!("/api/games/{game_id}/browse?path=../../etc"),
                &token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}

mod emulation {
    use super::*;

    #[tokio::test]
    async fn should_report_supported_when_game_has_rom_candidate() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("gba/Pokemon");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("pokemon.gba"), "rom").unwrap();
        let game_id = app
            .seed_game("Pokemon", "gba", "Pokemon", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(&format!("/api/games/{game_id}/emulation"), &token)
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body["supported"], true);
    }
}

mod downloads {
    use super::*;

    #[tokio::test]
    async fn should_create_download_ticket_with_loose_file_manifest() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary-content").unwrap();
        fs::write(game_dir.join("readme.txt"), "hello").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .post_json_authed(
                &format!("/api/games/{game_id}/download-ticket"),
                &serde_json::json!({}),
                &token,
            )
            .await;
        let body = support::read_json(resp).await;

        assert!(body["ticket"].is_string());
        assert_eq!(body["files"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn should_download_game_with_valid_ticket_without_auth() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc");
        fs::create_dir_all(&game_dir).unwrap();
        let archive_path = game_dir.join("doom.zip");
        fs::write(&archive_path, "binary-content").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "doom.zip", &archive_path, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let ticket_resp = app
            .post_json_authed(
                &format!("/api/games/{game_id}/download-ticket"),
                &serde_json::json!({}),
                &token,
            )
            .await;
        let ticket_body = support::read_json(ticket_resp).await;
        let ticket = ticket_body["ticket"].as_str().unwrap();

        let resp = app
            .get(&format!("/api/games/{game_id}/download?ticket={ticket}"))
            .await;
        let body = support::read_text(resp).await;

        assert_eq!(body, "binary-content");
    }

    #[tokio::test]
    async fn should_download_loose_file_for_authenticated_request() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary-content").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(
                &format!("/api/games/{game_id}/download-files?path=doom.exe"),
                &token,
            )
            .await;
        let body = support::read_text(resp).await;

        assert_eq!(body, "binary-content");
    }

    #[tokio::test]
    async fn should_reject_download_file_path_traversal() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary-content").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(
                &format!("/api/games/{game_id}/download-files?path=../../etc/passwd"),
                &token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_return_download_manifest_for_loose_folder() {
        let app = support::TestApp::new().await;
        let game_dir = app.root().join("pc/Doom");
        fs::create_dir_all(&game_dir).unwrap();
        fs::write(game_dir.join("doom.exe"), "binary-content").unwrap();
        fs::write(game_dir.join("readme.txt"), "hello").unwrap();
        let game_id = app
            .seed_game("Doom", "pc", "Doom", &game_dir, "portable")
            .await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .get_authed(
                &format!("/api/games/{game_id}/download-files-manifest"),
                &token,
            )
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body["files"].as_array().unwrap().len(), 2);
    }
}
