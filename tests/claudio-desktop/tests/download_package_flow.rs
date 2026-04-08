use claudio_desktop::integration_test_api::{
    DownloadPackageInput, InstallController, PlaintextAuthGuard, StoredTokens, data_dir,
    download_game_package, save_settings, store_tokens, with_test_data_dir_async,
};
use claudio_desktop_tests::support::archive::{write_tar_gz_archive, write_zip_archive};
use claudio_desktop_tests::support::fixtures::desktop_settings;
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::http::{TestResponse, TestServer};
use serial_test::serial;
use std::fs;

#[tokio::test]
#[serial]
async fn download_package_flow_saves_archive_when_extract_is_false() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let archive_path = workspace.data_dir.join("download.zip");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_zip_archive(&archive_path, &[("Game/game.exe", b"binary")]);
    let archive_body = fs::read(&archive_path).expect("archive should be readable");

    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/10/download-ticket" => TestResponse::json(200, r#"{"ticket":"raw"}"#),
        "/api/games/10/download?ticket=raw" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=game-package.zip".to_string(),
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

        let target_dir = data_dir().join("downloads");
        let result = download_game_package(
            DownloadPackageInput {
                id: 10,
                title: "Archive Download".to_string(),
                target_dir: target_dir.to_string_lossy().into_owned(),
                extract: false,
            },
            &InstallController::new(),
            |_| {},
            || Ok(()),
        )
        .await
        .expect("download should succeed");

        assert_eq!(
            result,
            target_dir.join("game-package.zip").to_string_lossy()
        );
        assert!(target_dir.join("game-package.zip").exists());
        assert!(
            !data_dir()
                .join("downloads")
                .join("Archive Download-10")
                .exists()
        );
    })
    .await;
}

#[tokio::test]
#[serial]
async fn download_package_flow_extracts_archive_when_requested() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let archive_path = workspace.data_dir.join("extract.tar.gz");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_tar_gz_archive(
        &archive_path,
        &[("Game/game.exe", b"binary"), ("Game/readme.txt", b"hello")],
    );
    let archive_body = fs::read(&archive_path).expect("archive should be readable");

    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/11/download-ticket" => TestResponse::json(200, r#"{"ticket":"extract"}"#),
        "/api/games/11/download?ticket=extract" => TestResponse {
            status: 200,
            headers: vec![(
                "content-disposition".to_string(),
                "attachment; filename=portable.tar.gz".to_string(),
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

        let target_dir = data_dir().join("extracted");
        let mut statuses = Vec::new();
        let result = download_game_package(
            DownloadPackageInput {
                id: 11,
                title: "Extract Download".to_string(),
                target_dir: target_dir.to_string_lossy().into_owned(),
                extract: true,
            },
            &InstallController::new(),
            |progress| statuses.push(progress.status),
            || Ok(()),
        )
        .await
        .expect("download and extract should succeed");

        assert_eq!(result, target_dir.to_string_lossy());
        assert!(target_dir.join("game.exe").exists());
        assert!(target_dir.join("readme.txt").exists());
        assert!(statuses.iter().any(|status| status == "extracting"));
        assert_eq!(statuses.last().map(String::as_str), Some("completed"));
    })
    .await;
}
