use claudio_desktop::integration_test_api::{
    InstallController, PlaintextAuthGuard, StoredTokens, data_dir, install_portable_game,
    list_installed_games, save_settings, store_tokens, temp_dir, with_test_data_dir_async,
};
use claudio_desktop_tests::support::archive::{write_tar_gz_archive, write_zip_archive};
use claudio_desktop_tests::support::fixtures::{desktop_settings, portable_remote_game};
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::http::{TestResponse, TestServer};
use serial_test::serial;
use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
#[serial]
async fn portable_install_from_zip_persists_registry_and_detects_executable() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let archive_path = workspace.data_dir.join("game.zip");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_zip_archive(&archive_path, &[("Game/game.exe", b"binary")]);
    let archive_body = fs::read(&archive_path).expect("archive should be readable");

    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/1/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
        "/api/games/1/download" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=portable.zip".to_string(),
            )],
            body: archive_body.clone(),
        },
        _ => TestResponse::text(404, "missing"),
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let install_path = data_dir().join("games").join("Portable Install");
        let game = portable_remote_game(
            1,
            "Portable Install",
            install_path.to_string_lossy().into_owned(),
        );
        let controller = InstallController::new();
        let mut statuses = Vec::new();

        let installed = install_portable_game(
            game,
            &controller,
            |progress| statuses.push(progress.status),
            || Ok(()),
        )
        .await
        .expect("portable install should succeed");

        assert!(install_path.join("game.exe").exists());
        assert_eq!(
            installed.game_exe.as_deref(),
            Some(install_path.join("game.exe").to_string_lossy().as_ref())
        );
        assert_eq!(
            list_installed_games()
                .expect("installed games should load")
                .len(),
            1
        );
        assert!(!temp_dir().join("install-1").exists());
        assert!(statuses.iter().any(|status| status == "downloading"));
        assert!(statuses.iter().any(|status| status == "extracting"));
        assert_eq!(statuses.last().map(String::as_str), Some("completed"));
    })
    .await;
}

#[tokio::test]
#[serial]
async fn portable_install_from_tar_gz_honors_explicit_game_exe_hint() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let archive_path = workspace.data_dir.join("game.tar.gz");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_tar_gz_archive(
        &archive_path,
        &[
            ("Build/bin/custom-launcher.exe", b"binary"),
            ("Extras/readme.txt", b"hello"),
        ],
    );
    let archive_body = fs::read(&archive_path).expect("archive should be readable");

    let request_count = Arc::new(AtomicUsize::new(0));
    let request_count_for_server = request_count.clone();
    let server = TestServer::spawn(move |request| {
        request_count_for_server.fetch_add(1, Ordering::SeqCst);
        match request.path.as_str() {
            "/api/games/2/download-files-manifest" => TestResponse::json(200, r#"{"files":null}"#),
            "/api/games/2/download" => TestResponse {
                status: 200,
                headers: vec![(
                    "content-disposition".to_string(),
                    "attachment; filename=portable.tar.gz".to_string(),
                )],
                body: archive_body.clone(),
            },
            _ => TestResponse::text(404, "missing"),
        }
    });

    with_test_data_dir_async(workspace.data_dir.clone(), || async {
        let settings = desktop_settings(server.url());
        save_settings(&settings).expect("settings should save");
        store_tokens(
            &settings,
            &StoredTokens {
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
            },
        )
        .expect("tokens should store");

        let install_path = data_dir().join("games").join("Hinted Install");
        let mut game = portable_remote_game(
            2,
            "Hinted Install",
            install_path.to_string_lossy().into_owned(),
        );
        game.game_exe = Some("Build/bin/custom-launcher.exe".to_string());

        let installed = install_portable_game(game, &InstallController::new(), |_| {}, || Ok(()))
            .await
            .expect("portable install should succeed");

        assert!(install_path.join("Build/bin/custom-launcher.exe").exists());
        assert_eq!(
            installed.game_exe.as_deref(),
            Some(
                install_path
                    .join("Build/bin/custom-launcher.exe")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_eq!(request_count.load(Ordering::SeqCst), 2);
    })
    .await;
}
