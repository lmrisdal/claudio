use super::*;

#[tokio::test]
async fn download_package_with_downloads_file_and_uses_filename_header() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games/5/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/5/download" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=game-package.zip".to_string(),
            )],
            body: b"payload".to_vec(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("download-success"), || async {
        let settings = download_settings(server.url());
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let control = InstallControl::new();
        let temp_root = crate::settings::data_dir().join("download-success");
        fs::create_dir_all(&temp_root).expect("temp root should exist");
        let mut progress = Vec::new();

        let download = download_package_with(
            &DownloadOptions {
                settings: &settings,
                server_url: server.url(),
                custom_headers: &settings.custom_headers,
                speed_limit_kbs: None,
                progress_scale: 100.0,
            },
            5,
            "Game",
            &temp_root,
            &control,
            |event| progress.push(event),
            || Ok(()),
        )
        .await
        .expect("download should succeed");

        assert_eq!(download.file_path, temp_root.join("game-package.zip"));
        assert_eq!(
            fs::read(&download.file_path).expect("downloaded file should exist"),
            b"payload"
        );
        assert!(
            progress
                .iter()
                .any(|event| event.status == "requestingManifest")
        );
        assert!(progress.iter().any(|event| event.status == "downloading"));
        let max_download_percent = progress
            .iter()
            .filter(|event| event.status == "downloading")
            .filter_map(|event| event.percent)
            .fold(0.0_f64, f64::max);
        assert_eq!(
            max_download_percent, 100.0,
            "download progress should use full 0-100 range"
        );
    })
    .await;
}

#[tokio::test]
async fn download_package_with_refreshes_when_manifest_and_download_require_reauth() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let fresh_count = StdArc::new(AtomicUsize::new(0));
    let fresh_count_for_server = fresh_count.clone();
    let server = TestServer::spawn(move |request| {
        let auth = request
            .headers
            .get("authorization")
            .cloned()
            .unwrap_or_default();
        match request.path.as_str() {
            "/api/games/7/download-files-manifest" if auth == "Bearer stale-token" => {
                TestResponse::text(401, "expired")
            }
            "/api/games/7/download-files-manifest" if auth == "Bearer fresh-token" => {
                fresh_count_for_server.fetch_add(1, Ordering::SeqCst);
                TestResponse::json(200, r#"{"files":null}"#)
            }
            "/api/games/7/download" if auth == "Bearer stale-token" => {
                TestResponse::text(401, "expired")
            }
            "/api/games/7/download" if auth == "Bearer fresh-token" => {
                fresh_count_for_server.fetch_add(1, Ordering::SeqCst);
                TestResponse::text(200, "ok")
            }
            "/api/auth/token/refresh" => TestResponse::json(
                200,
                r#"{"access_token":"fresh-token","refresh_token":"fresh-refresh"}"#,
            ),
            _ => TestResponse::text(404, "missing"),
        }
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("download-refresh"), || async {
        let settings = download_settings(server.url());
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "stale-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let control = InstallControl::new();
        let temp_root = crate::settings::data_dir().join("download-refresh");
        fs::create_dir_all(&temp_root).expect("temp root should exist");

        let download = download_package_with(
            &DownloadOptions {
                settings: &settings,
                server_url: server.url(),
                custom_headers: &settings.custom_headers,
                speed_limit_kbs: None,
                progress_scale: 100.0,
            },
            7,
            "Game",
            &temp_root,
            &control,
            |_| {},
            || Ok(()),
        )
        .await
        .expect("download should succeed after refresh");

        assert_eq!(
            fs::read(&download.file_path).expect("downloaded file should exist"),
            b"ok"
        );
        assert_eq!(fresh_count.load(Ordering::SeqCst), 2);
        let stored = crate::auth::load_tokens(&settings)
            .expect("tokens should load")
            .expect("tokens should exist");
        assert_eq!(stored.access_token, "fresh-token");
    })
    .await;
}

#[tokio::test]
async fn download_package_with_cleans_temp_root_when_cancelled() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games/9/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/9/download" => TestResponse::text(200, "ok"),
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("download-cancel"), || async {
        let settings = download_settings(server.url());
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let control = InstallControl::new();
        control.set_cancelled(true);
        let temp_root = crate::settings::data_dir().join("download-cancel");
        fs::create_dir_all(&temp_root).expect("temp root should exist");

        let error = download_package_with(
            &DownloadOptions {
                settings: &settings,
                server_url: server.url(),
                custom_headers: &settings.custom_headers,
                speed_limit_kbs: None,
                progress_scale: 100.0,
            },
            9,
            "Game",
            &temp_root,
            &control,
            |_| {},
            || Ok(()),
        )
        .await
        .err()
        .expect("cancelled download should fail");

        assert_eq!(error, "Install cancelled.");
        assert!(!temp_root.exists());
    })
    .await;
}
