use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use claudio_api_tests::support;

// ── /api/auth/providers ─────────────────────────────────────────────────────

mod providers {
    use super::*;

    #[tokio::test]
    async fn should_return_ok_with_local_login_enabled() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/auth/providers").await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_report_local_login_enabled_by_default() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["localLoginEnabled"], true);
    }

    #[tokio::test]
    async fn should_report_user_creation_enabled_by_default() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["userCreationEnabled"], true);
    }

    #[tokio::test]
    async fn should_return_empty_providers_list_when_none_configured() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["providers"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn should_report_auth_disabled_when_configured() {
        let app = support::TestApp::with_config(|config| {
            config.auth.disable_auth = true;
        })
        .await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["authDisabled"], true);
        assert_eq!(body["localLoginEnabled"], false);
        assert_eq!(body["userCreationEnabled"], false);
    }

    #[tokio::test]
    async fn should_include_github_provider_when_configured() {
        let app = support::TestApp::with_config(|config| {
            config.auth.github.client_id = "github-client".to_string();
            config.auth.github.client_secret = "github-secret".to_string();
            config.auth.github.redirect_uri = "http://localhost/callback".to_string();
        })
        .await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["providers"].as_array().unwrap().len(), 1);
        assert_eq!(body["providers"][0]["slug"], "github");
    }

    #[tokio::test]
    async fn should_include_multiple_oidc_providers_when_configured() {
        let app = support::TestApp::with_config(|config| {
            config.auth.oidc_providers = vec![
                claudio_api::config::OidcProviderConfig {
                    slug: "pocketid".to_string(),
                    display_name: "Pocket ID".to_string(),
                    discovery_url: "https://id.example.com/.well-known/openid-configuration"
                        .to_string(),
                    client_id: "pocketid-client-id".to_string(),
                    client_secret: "pocketid-client-secret".to_string(),
                    redirect_uri: "http://localhost:8080/api/auth/oidc/pocketid/callback"
                        .to_string(),
                    ..Default::default()
                },
                claudio_api::config::OidcProviderConfig {
                    slug: "zitadel".to_string(),
                    display_name: "Zitadel".to_string(),
                    discovery_url: "https://zitadel.example.com/.well-known/openid-configuration"
                        .to_string(),
                    client_id: "zitadel-client-id".to_string(),
                    client_secret: "zitadel-client-secret".to_string(),
                    redirect_uri: "http://localhost:8080/api/auth/oidc/zitadel/callback"
                        .to_string(),
                    ..Default::default()
                },
            ];
        })
        .await;

        let resp = app.get("/api/auth/providers").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["providers"].as_array().unwrap().len(), 2);
        assert_eq!(body["providers"][0]["slug"], "pocketid");
        assert_eq!(body["providers"][1]["slug"], "zitadel");
    }
}

// ── /api/auth/register ───────────────────────────────────────────────────────

mod register {
    use super::*;

    #[tokio::test]
    async fn should_create_first_user_as_admin() {
        let app = support::TestApp::new().await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "alice", "password": "password123" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn should_reject_duplicate_username() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "alice", "password": "different1" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn should_reject_empty_username() {
        let app = support::TestApp::new().await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "   ", "password": "password123" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_reject_password_shorter_than_8_characters() {
        let app = support::TestApp::new().await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "alice", "password": "short" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_return_not_found_when_local_login_is_disabled() {
        let app = support::TestApp::with_config(|config| {
            config.auth.disable_local_login = true;
        })
        .await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "alice", "password": "password123" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn should_return_not_found_when_user_creation_is_disabled() {
        let app = support::TestApp::with_config(|config| {
            config.auth.disable_user_creation = true;
        })
        .await;

        let resp = app
            .post_json(
                "/api/auth/register",
                &serde_json::json!({ "username": "alice", "password": "password123" }),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}

// ── /connect/token (password grant) ─────────────────────────────────────────

mod connect_token {
    use super::*;

    #[tokio::test]
    async fn should_return_token_response_for_valid_credentials() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_include_access_token_in_response() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await;
        let body = support::read_json(resp).await;

        assert!(
            body["access_token"].is_string(),
            "expected access_token to be a string, got: {body:?}"
        );
    }

    #[tokio::test]
    async fn should_return_bearer_token_type() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await;
        let body = support::read_json(resp).await;

        assert_eq!(body["token_type"], "Bearer");
    }

    #[tokio::test]
    async fn should_include_refresh_token_in_response() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await;
        let body = support::read_json(resp).await;

        assert!(
            body["refresh_token"].is_string(),
            "expected refresh_token to be a string, got: {body:?}"
        );
    }

    #[tokio::test]
    async fn should_reject_wrong_password() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=wrongpassword",
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_reject_unknown_username() {
        let app = support::TestApp::new().await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=nobody&password=password123",
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_reject_unsupported_grant_type() {
        let app = support::TestApp::new().await;

        let resp = app
            .post_form("/connect/token", "grant_type=client_credentials")
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_issue_new_tokens_on_refresh_token_grant() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let initial = support::read_json(
            app.post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await,
        )
        .await;
        let refresh_token = initial["refresh_token"].as_str().unwrap();
        let encoded = support::url_encode(refresh_token);

        let resp = app
            .post_form(
                "/connect/token",
                &format!("grant_type=refresh_token&refresh_token={encoded}"),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_rotate_refresh_token_on_use() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let initial = support::read_json(
            app.post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await,
        )
        .await;
        let refresh_token = initial["refresh_token"].as_str().unwrap();
        let encoded = support::url_encode(refresh_token);

        let refreshed = support::read_json(
            app.post_form(
                "/connect/token",
                &format!("grant_type=refresh_token&refresh_token={encoded}"),
            )
            .await,
        )
        .await;

        assert_ne!(
            refreshed["refresh_token"].as_str().unwrap(),
            refresh_token,
            "refresh token should rotate after use"
        );
    }

    #[tokio::test]
    async fn should_reject_already_used_refresh_token() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;

        let initial = support::read_json(
            app.post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=password123",
            )
            .await,
        )
        .await;
        let refresh_token = initial["refresh_token"].as_str().unwrap();
        let encoded = support::url_encode(refresh_token);

        // Use the refresh token once.
        app.post_form(
            "/connect/token",
            &format!("grant_type=refresh_token&refresh_token={encoded}"),
        )
        .await;

        // Second use must fail.
        let resp = app
            .post_form(
                "/connect/token",
                &format!("grant_type=refresh_token&refresh_token={encoded}"),
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_exchange_proxy_nonce_for_tokens() {
        let app = support::TestApp::with_config(|config| {
            config.auth.proxy_auth_header = "X-Remote-User".to_string();
            config.auth.proxy_auth_auto_create = true;
        })
        .await;

        let nonce_response = app
            .send_request(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/remote")
                    .header("X-Remote-User", "alice")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        let nonce_body = support::read_json(nonce_response).await;
        let nonce = nonce_body["nonce"].as_str().unwrap();

        let resp = app
            .post_form(
                "/connect/token",
                &format!("grant_type=urn%3Aclaudio%3Aproxy_nonce&nonce={nonce}"),
            )
            .await;
        let body = support::read_json(resp).await;

        assert!(body["access_token"].is_string());
    }

    #[tokio::test]
    async fn should_exchange_external_login_nonce_for_tokens() {
        let app = support::TestApp::new().await;
        app.register("alice", "password123").await;
        let nonce = app.state.external_login_nonce_store.create(1);

        let resp = app
            .post_form(
                "/connect/token",
                &format!("grant_type=urn%3Aclaudio%3Aexternal_login_nonce&nonce={nonce}"),
            )
            .await;
        let body = support::read_json(resp).await;

        assert!(body["access_token"].is_string());
    }
}

// ── /connect/userinfo ────────────────────────────────────────────────────────

mod userinfo {
    use super::*;

    #[tokio::test]
    async fn should_return_user_claims_for_authenticated_request() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/connect/userinfo", &token).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_include_username_in_userinfo() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/connect/userinfo", &token).await;
        let body = support::read_json(resp).await;

        assert_eq!(body["name"], "alice");
    }

    #[tokio::test]
    async fn should_reject_unauthenticated_request() {
        let app = support::TestApp::new().await;

        let resp = app.get("/connect/userinfo").await;

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }
}

// ── /api/auth/me ─────────────────────────────────────────────────────────────

mod me {
    use super::*;

    #[tokio::test]
    async fn should_return_user_profile_for_authenticated_request() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/auth/me", &token).await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_return_correct_username() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/auth/me", &token).await;
        let body = support::read_json(resp).await;

        assert_eq!(body["username"], "alice");
    }

    #[tokio::test]
    async fn should_assign_admin_role_to_first_user() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app.get_authed("/api/auth/me", &token).await;
        let body = support::read_json(resp).await;

        assert_eq!(body["role"], "admin");
    }

    #[tokio::test]
    async fn should_assign_user_role_to_subsequent_registrations() {
        let app = support::TestApp::new().await;
        app.register("admin_user", "password123").await;
        let token = app.register_and_login("second_user", "password123").await;

        let resp = app.get_authed("/api/auth/me", &token).await;
        let body = support::read_json(resp).await;

        assert_eq!(body["role"], "user");
    }

    #[tokio::test]
    async fn should_reject_unauthenticated_request() {
        let app = support::TestApp::new().await;

        let resp = app.get("/api/auth/me").await;

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn should_return_virtual_admin_profile_when_auth_is_disabled() {
        let app = support::TestApp::with_config(|config| {
            config.auth.disable_auth = true;
        })
        .await;

        let resp = app.get("/api/auth/me").await;
        let body = support::read_json(resp).await;

        assert_eq!(body["id"], 0);
        assert_eq!(body["username"], "admin");
        assert_eq!(body["role"], "admin");
    }
}

// ── /api/auth/change-password ────────────────────────────────────────────────

mod change_password {
    use super::*;

    #[tokio::test]
    async fn should_accept_valid_password_change() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .put_json_authed(
                "/api/auth/change-password",
                &serde_json::json!({
                    "currentPassword": "password123",
                    "newPassword": "newpassword456"
                }),
                &token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn should_allow_login_with_new_password_after_change() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        app.put_json_authed(
            "/api/auth/change-password",
            &serde_json::json!({
                "currentPassword": "password123",
                "newPassword": "newpassword456"
            }),
            &token,
        )
        .await;

        let resp = app
            .post_form(
                "/connect/token",
                "grant_type=password&username=alice&password=newpassword456",
            )
            .await;

        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn should_reject_incorrect_current_password() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .put_json_authed(
                "/api/auth/change-password",
                &serde_json::json!({
                    "currentPassword": "wrongpassword",
                    "newPassword": "newpassword456"
                }),
                &token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn should_reject_new_password_shorter_than_8_characters() {
        let app = support::TestApp::new().await;
        let token = app.register_and_login("alice", "password123").await;

        let resp = app
            .put_json_authed(
                "/api/auth/change-password",
                &serde_json::json!({
                    "currentPassword": "password123",
                    "newPassword": "short"
                }),
                &token,
            )
            .await;

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
