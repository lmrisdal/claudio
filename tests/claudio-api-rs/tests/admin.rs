use axum::http::StatusCode;
use claudio_api_tests::support;

// ── /api/admin/users ──────────────────────────────────────────────────────────

mod list_users {
    use super::*;

    #[tokio::test]
    async fn should_return_all_registered_users() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;
        app.register("user2", "password123").await;

        let resp = app.get_authed("/api/admin/users", &token).await;
        let body = support::read_json(resp).await;

        assert_eq!(body.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app.get_authed("/api/admin/users", &user_token).await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn should_reject_unauthenticated_request() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/admin/users").await;

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

// ── /api/admin/users/{id} (DELETE) ───────────────────────────────────────────

mod delete_user {
    use super::*;

    #[tokio::test]
    async fn should_delete_existing_user() {
        let app = support::TestApp::new().await;
        let admin_token = app.register_and_login("admin", "password123").await;
        app.register("victim", "password123").await;

        let users =
            support::read_json(app.get_authed("/api/admin/users", &admin_token).await).await;
        let victim = users
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["username"] == "victim")
            .expect("victim user in list");
        let victim_id = victim["id"].as_i64().unwrap();

        let resp = app
            .delete_authed(&format!("/api/admin/users/{victim_id}"), &admin_token)
            .await;

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn should_return_404_for_nonexistent_user() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        let resp = app.delete_authed("/api/admin/users/9999", &token).await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app.delete_authed("/api/admin/users/1", &user_token).await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}

// ── /api/admin/users/{id}/role (PUT) ─────────────────────────────────────────

mod update_user_role {
    use super::*;

    #[tokio::test]
    async fn should_promote_user_to_admin() {
        let app = support::TestApp::new().await;
        let admin_token = app.register_and_login("admin", "password123").await;
        app.register("promoted", "password123").await;

        let users =
            support::read_json(app.get_authed("/api/admin/users", &admin_token).await).await;
        let target = users
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["username"] == "promoted")
            .expect("promoted user in list");
        let target_id = target["id"].as_i64().unwrap();

        let resp = app
            .put_json_authed(
                &format!("/api/admin/users/{target_id}/role"),
                &serde_json::json!({ "role": "admin" }),
                &admin_token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app
            .put_json_authed(
                "/api/admin/users/1/role",
                &serde_json::json!({ "role": "user" }),
                &user_token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}

// ── /api/admin/config ─────────────────────────────────────────────────────────

mod config {
    use super::*;

    #[tokio::test]
    async fn should_return_config_for_admin() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        let resp = app.get_authed("/api/admin/config", &token).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_include_igdb_and_steamgriddb_sections_in_config() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        let resp = app.get_authed("/api/admin/config", &token).await;
        let body = support::read_json(resp).await;

        assert!(body["igdb"].is_object(), "expected igdb key in config");
        assert!(
            body["steamgriddb"].is_object(),
            "expected steamgriddb key in config"
        );
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app.get_authed("/api/admin/config", &user_token).await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn should_mask_existing_secrets_in_config_response() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        app.put_json_authed(
            "/api/admin/config",
            &serde_json::json!({
                "igdb": { "clientId": "my-client-id", "clientSecret": "supersecretvalue" }
            }),
            &token,
        )
        .await;

        let resp = app.get_authed("/api/admin/config", &token).await;
        let body = support::read_json(resp).await;

        let secret = body["igdb"]["clientSecret"].as_str().unwrap();
        assert!(
            !secret.contains("supersecretvalue"),
            "client secret should be masked, got: {secret}"
        );
    }
}

// ── /api/admin/tasks/status ───────────────────────────────────────────────────

mod tasks_status {
    use super::*;

    #[tokio::test]
    async fn should_return_task_status_for_admin() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        let resp = app.get_authed("/api/admin/tasks/status", &token).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app.get_authed("/api/admin/tasks/status", &user_token).await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}

// ── /api/admin/scan ───────────────────────────────────────────────────────────

mod library_scan {
    use super::*;

    #[tokio::test]
    async fn should_trigger_scan_for_admin() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("admin", "password123").await;

        let resp = app
            .post_json_authed("/api/admin/scan", &serde_json::json!({}), &token)
            .await;

        // 200 OK (scan result) or 409 Conflict (already running) are both acceptable.
        assert!(
            resp.status().is_success() || resp.status() == StatusCode::CONFLICT,
            "unexpected status: {}",
            resp.status()
        );
    }

    #[tokio::test]
    async fn should_reject_non_admin_user() {
        let app = support::TestApp::new().await;
        app.register("admin", "password123").await;
        let user_token = app.register_and_login("regular", "password123").await;

        let resp = app
            .post_json_authed("/api/admin/scan", &serde_json::json!({}), &user_token)
            .await;

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
