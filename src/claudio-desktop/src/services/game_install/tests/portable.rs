use super::*;

#[cfg(feature = "integration-tests")]
#[tokio::test]
async fn install_portable_game_uses_configured_download_root_workspace() {
    let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
    let archive_payload = tar_gz_bytes(&[("Game/game.exe", b"binary")]);
    let archive_payload_for_server = archive_payload.clone();
    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/31/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/31/download" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=portable-game.tar.gz".to_string(),
            )],
            body: archive_payload_for_server.clone(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    crate::settings::with_test_data_dir_async(
        unique_test_dir("portable-download-root"),
        || async {
            let install_root = crate::settings::data_dir().join("install-root");
            let download_root = crate::settings::data_dir().join("custom-downloads");
            let settings = settings::DesktopSettings {
                server_url: Some(server.url().to_string()),
                default_install_path: Some(install_root.to_string_lossy().into_owned()),
                default_download_path: Some(download_root.to_string_lossy().into_owned()),
                allow_insecure_auth_storage: true,
                ..settings::DesktopSettings::default()
            };
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
            let game = RemoteGame {
                id: 31,
                title: "Portable Download Root Game".to_string(),
                platform: "windows".to_string(),
                install_type: InstallType::Portable,
                installer_exe: None,
                game_exe: Some("game.exe".to_string()),
                install_path: None,
                desktop_shortcut: None,
                run_as_administrator: None,
                force_interactive: None,
                summary: None,
                genre: None,
                release_year: None,
                cover_url: None,
                hero_url: None,
                developer: None,
                publisher: None,
                game_mode: None,
                series: None,
                franchise: None,
                game_engine: None,
            };
            let expected_install_dir = install_root.join("Portable Download Root Game");
            let legacy_install_temp_root = crate::settings::data_dir().join("install-31");

            let installed =
                crate::services::game_install::integration_testing::install_portable_game(
                    game,
                    &controller,
                    |_| {},
                    || Ok(()),
                )
                .await
                .expect("portable install should succeed");

            assert_eq!(PathBuf::from(installed.install_path), expected_install_dir);
            assert!(expected_install_dir.join("game.exe").exists());
            assert!(
                download_root.exists(),
                "configured downloads root should be used"
            );
            assert!(
                !legacy_install_temp_root.exists(),
                "legacy temp install root should not be used for downloaded artifacts"
            );
        },
    )
    .await;
}
