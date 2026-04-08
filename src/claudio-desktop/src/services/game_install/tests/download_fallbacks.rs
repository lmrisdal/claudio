use super::*;

#[tokio::test]
async fn download_package_with_uses_legacy_ticket_when_manifest_endpoint_missing() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games/12/download-files-manifest" => TestResponse::text(404, "missing"),
        "/api/games/12/download-ticket" => TestResponse::json(200, r#"{"ticket":"fallback"}"#),
        "/api/games/12/download?ticket=fallback" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=fallback.tar".to_string(),
            )],
            body: b"fallback-payload".to_vec(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("download-manifest-fallback"),
        || async {
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
            let temp_root = crate::settings::data_dir().join("download-manifest-fallback");
            fs::create_dir_all(&temp_root).expect("temp root should exist");
            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: None,
                    progress_scale: 100.0,
                },
                12,
                "Fallback",
                &temp_root,
                &control,
                |_| {},
                || Ok(()),
            )
            .await
            .expect("download should succeed using legacy ticket fallback");

            assert_eq!(download.file_path, temp_root.join("fallback.tar"));
            assert_eq!(
                fs::read(&download.file_path).expect("downloaded file should exist"),
                b"fallback-payload"
            );
        },
    )
    .await;
}

#[tokio::test]
async fn download_package_with_falls_back_to_legacy_ticket_when_direct_download_missing() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games/13/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/13/download" => TestResponse::text(404, "missing"),
        "/api/games/13/download-ticket" => TestResponse::json(200, r#"{"ticket":"legacy"}"#),
        "/api/games/13/download?ticket=legacy" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=legacy.tar".to_string(),
            )],
            body: b"legacy-payload".to_vec(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("download-legacy-fallback"),
        || async {
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
            let temp_root = crate::settings::data_dir().join("download-legacy-fallback");
            fs::create_dir_all(&temp_root).expect("temp root should exist");
            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: None,
                    progress_scale: 100.0,
                },
                13,
                "LegacyFallback",
                &temp_root,
                &control,
                |_| {},
                || Ok(()),
            )
            .await
            .expect("download should succeed through legacy ticket fallback");

            assert_eq!(download.file_path, temp_root.join("legacy.tar"));
            assert_eq!(
                fs::read(&download.file_path).expect("downloaded file should exist"),
                b"legacy-payload"
            );
        },
    )
    .await;
}

#[tokio::test]
async fn download_package_with_individual_mode_reports_partial_byte_progress() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let payload = vec![b'x'; 512 * 1024];
    let payload_for_server = payload.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/11/download-files-manifest" => {
            TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":524288}]}"#)
        }
        "/api/games/11/download-files?path=Game/data.bin" => TestResponse {
            status: 200,
            headers: vec![(
                "content-type".to_string(),
                "application/octet-stream".to_string(),
            )],
            body: payload_for_server.clone(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("download-individual-progress"),
        || async {
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
            let temp_root = crate::settings::data_dir().join("download-individual-progress");
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
                11,
                "Game",
                &temp_root,
                &control,
                |event| progress.push(event),
                || Ok(()),
            )
            .await
            .expect("download should succeed");

            let downloaded_file = download.file_path.join("Game").join("data.bin");
            assert_eq!(
                fs::read(downloaded_file).expect("downloaded file should exist"),
                payload
            );
            assert!(
                progress.iter().any(|event| {
                    event.status == "downloading"
                        && matches!(
                            (event.bytes_downloaded, event.total_bytes),
                            (Some(downloaded), Some(total))
                                if downloaded > 0 && downloaded < total
                        )
                }),
                "expected at least one partial downloading update before completion"
            );
        },
    )
    .await;
}
