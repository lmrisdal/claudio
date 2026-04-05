use claudio_desktop::integration_test_api::{
    InstallController, PlaintextAuthGuard, StoredTokens, data_dir, get_installed_game,
    install_portable_game, save_settings, store_tokens, temp_dir, with_test_data_dir_async,
};
use claudio_desktop_tests::support::archive::write_tar_gz_archive;
use claudio_desktop_tests::support::fixtures::{desktop_settings, portable_remote_game};
use claudio_desktop_tests::support::fs::TestWorkspace;
use claudio_desktop_tests::support::http::{TestResponse, TestServer};
use serial_test::serial;
use std::fs;

#[tokio::test]
#[serial]
async fn portable_install_cleans_temp_and_target_when_cancelled() {
    let _auth_guard = PlaintextAuthGuard::new();
    let workspace = TestWorkspace::new();
    let archive_path = workspace.data_dir.join("cancel.tar.gz");
    fs::create_dir_all(&workspace.data_dir).expect("workspace data dir should exist");
    write_tar_gz_archive(&archive_path, &[("Game/game.exe", b"binary")]);
    let archive_body = fs::read(&archive_path).expect("archive should be readable");

    let server = TestServer::spawn(move |request| match request.path.as_str() {
        "/api/games/12/download-ticket" => TestResponse::json(200, r#"{"ticket":"cancel"}"#),
        "/api/games/12/download?ticket=cancel" => TestResponse {
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

        let install_path = data_dir().join("games").join("Cancelled Install");
        let game = portable_remote_game(
            12,
            "Cancelled Install",
            install_path.to_string_lossy().into_owned(),
        );
        let controller = InstallController::new();
        controller.cancel();

        let error = install_portable_game(game, &controller, |_| {}, || Ok(()))
            .await
            .err()
            .expect("cancelled install should fail");

        assert_eq!(error, "Install cancelled.");
        assert!(!install_path.exists());
        assert!(!temp_dir().join("install-12").exists());
        assert!(
            get_installed_game(12)
                .expect("installed game should load")
                .is_none()
        );
    })
    .await;
}
