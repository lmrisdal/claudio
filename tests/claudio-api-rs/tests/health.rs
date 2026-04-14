use axum::http::StatusCode;
use claudio_api_tests::support;

#[tokio::test]
async fn health_should_return_ok_status() {
    let app = support::TestApp::new().await;

    let resp = app.get("/health").await;

    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn health_should_return_json_body_with_status_field() {
    let app = support::TestApp::new().await;

    let resp = app.get("/health").await;
    let body = support::read_json(resp).await;

    assert_eq!(body["status"], "ok");
}
