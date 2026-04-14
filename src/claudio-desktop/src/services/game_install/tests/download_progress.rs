use super::*;

#[cfg(feature = "integration-tests")]
#[tokio::test]
async fn download_package_with_individual_mode_respects_speed_limit() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let payload = "a".repeat(1024);
    let payload_for_server = payload.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/16/download-files-manifest" => {
            TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":1024}]}"#)
        }
        "/api/games/16/download-files?path=Game/data.bin" => {
            TestResponse::text(200, &payload_for_server)
        }
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("download-individual-speed-limit"),
        || async {
            let settings = download_settings(server.url());
            crate::settings::save(&settings).expect("settings should save");
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let temp_root = crate::settings::data_dir().join("speed-limit-test");
            fs::create_dir_all(&temp_root).expect("temp root should be created");
            let controller = InstallControl::new();
            let mut progress = Vec::new();
            let started = std::time::Instant::now();
            let download = download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: Some(0.5),
                    progress_scale: 100.0,
                },
                16,
                "Rate Limited Individual Download",
                &temp_root,
                &controller,
                |event| progress.push(event),
                || Ok(()),
            )
            .await
            .expect("individual download should succeed");
            let elapsed = started.elapsed();

            assert!(download.file_path.exists());
            assert!(
                elapsed >= std::time::Duration::from_millis(900),
                "speed limit should delay individual-file downloads; elapsed={elapsed:?}"
            );
            assert!(
                progress
                    .iter()
                    .filter(|event| event.status == "downloading")
                    .any(|event| event.bytes_downloaded.unwrap_or(0) > 0),
                "should report downloading bytes while throttled"
            );
        },
    )
    .await;
}

#[cfg(feature = "integration-tests")]
#[tokio::test]
async fn download_package_with_individual_mode_picks_up_speed_limit_updates() {
    use std::sync::atomic::Ordering;

    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let payload = "a".repeat(2048);
    let payload_for_server = payload.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/17/download-files-manifest" => {
            TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":2048}]}"#)
        }
        "/api/games/17/download-files?path=Game/data.bin" => {
            TestResponse::text(200, &payload_for_server)
        }
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(unique_test_dir("download-individual-speed-update"), || async {
        let mut settings = download_settings(server.url());
        settings.download_speed_limit_kbs = Some(0.5);
        crate::settings::save(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let temp_root = crate::settings::data_dir().join("speed-limit-update-test");
        fs::create_dir_all(&temp_root).expect("temp root should be created");
        let controller = InstallControl::new();
        let mut progress = Vec::new();

        // Lift the speed limit as soon as the first bytes are observed in a progress event.
        // This avoids any wall-clock sleep: we know bytes are flowing, so the download is
        // in-flight and the limit change will be picked up by the next refresh poll.
        let limit_lifted = Arc::new(AtomicBool::new(false));
        let limit_lifted_in_callback = Arc::clone(&limit_lifted);
        let updater_url = server.url().to_string();

        let download = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            download_package_with(
                &DownloadOptions {
                    settings: &settings,
                    server_url: server.url(),
                    custom_headers: &settings.custom_headers,
                    speed_limit_kbs: settings.download_speed_limit_kbs,
                    progress_scale: 100.0,
                },
                17,
                "Dynamic Rate Limit Individual Download",
                &temp_root,
                &controller,
                |event| {
                    if !limit_lifted_in_callback.load(Ordering::Relaxed)
                        && event.bytes_downloaded.unwrap_or(0) > 0
                    {
                        limit_lifted_in_callback.store(true, Ordering::Relaxed);
                        let mut updated = download_settings(&updater_url);
                        updated.download_speed_limit_kbs = Some(2048.0);
                        let _ = crate::settings::save(&updated);
                    }
                    progress.push(event);
                },
                || Ok(()),
            ),
        )
        .await
        .expect("download should complete within timeout")
        .expect("individual download should succeed");

        assert!(download.file_path.exists());
        assert!(
            limit_lifted.load(Ordering::Relaxed),
            "speed limit should have been lifted mid-download"
        );
        assert!(
            progress
                .iter()
                .filter(|event| event.status == "downloading")
                .any(|event| event.bytes_downloaded.unwrap_or(0) > 0),
            "should report downloading bytes while speed limit updates are applied"
        );
    })
    .await;
}

#[cfg(feature = "integration-tests")]
#[tokio::test]
async fn download_game_package_extract_archive_keeps_download_progress_full_range() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let archive_payload = tar_gz_bytes(&[("Game/game.exe", b"binary")]);
    let archive_payload_for_server = archive_payload.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/21/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/21/download" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=game-package.tar.gz".to_string(),
            )],
            body: archive_payload_for_server.clone(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("extract-archive-progress"),
        || async {
            let settings = download_settings(server.url());
            crate::settings::save(&settings).expect("settings should save");
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let controller =
                crate::services::game_install::integration_testing::TestInstallController::new();
            let target_dir = crate::settings::data_dir().join("extract-archive-target");
            let mut progress = Vec::new();

            let final_path =
                crate::services::game_install::integration_testing::download_game_package(
                    DownloadPackageInput {
                        id: 21,
                        title: "Archive Game".to_string(),
                        target_dir: target_dir.to_string_lossy().into_owned(),
                        extract: true,
                    },
                    &controller,
                    |event| progress.push(event),
                    || Ok(()),
                )
                .await
                .expect("package download should succeed");

            assert_eq!(PathBuf::from(final_path), target_dir);
            assert!(target_dir.join("game.exe").exists());

            let max_download_percent = progress
                .iter()
                .filter(|event| event.status == "downloading")
                .filter_map(|event| event.percent)
                .fold(0.0_f64, f64::max);
            assert_eq!(max_download_percent, 100.0);
            assert!(
                progress
                    .iter()
                    .filter(|event| event.status == "extracting")
                    .all(|event| event.percent.is_none()),
                "extracting events should not lower completed download percent"
            );
        },
    )
    .await;
}

#[cfg(feature = "integration-tests")]
#[tokio::test]
async fn download_game_package_extract_individual_files_keeps_download_progress_full_range() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let server = TestServer::spawn(|request| match request.path.as_str() {
        "/api/games/22/download-files-manifest" => {
            TestResponse::json(200, r#"{"files":[{"path":"Game/data.bin","size":6}]}"#)
        }
        "/api/games/22/download-files?path=Game/data.bin" => TestResponse::text(200, "binary"),
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("extract-individual-progress"),
        || async {
            let settings = download_settings(server.url());
            crate::settings::save(&settings).expect("settings should save");
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "access-token".to_string(),
                    refresh_token: Some("refresh-token".to_string()),
                },
            )
            .expect("tokens should store");

            let controller =
                crate::services::game_install::integration_testing::TestInstallController::new();
            let target_dir = crate::settings::data_dir().join("extract-individual-target");
            let mut progress = Vec::new();

            let final_path =
                crate::services::game_install::integration_testing::download_game_package(
                    DownloadPackageInput {
                        id: 22,
                        title: "Individual Game".to_string(),
                        target_dir: target_dir.to_string_lossy().into_owned(),
                        extract: true,
                    },
                    &controller,
                    |event| progress.push(event),
                    || Ok(()),
                )
                .await
                .expect("package download should succeed");

            assert_eq!(PathBuf::from(final_path), target_dir);
            assert!(target_dir.join("data.bin").exists());

            let max_download_percent = progress
                .iter()
                .filter(|event| event.status == "downloading")
                .filter_map(|event| event.percent)
                .fold(0.0_f64, f64::max);
            assert_eq!(max_download_percent, 100.0);
            assert!(
                progress
                    .iter()
                    .filter(|event| event.status == "extracting")
                    .all(|event| event.percent.is_none()),
                "extracting events should not lower completed download percent"
            );
        },
    )
    .await;
}
