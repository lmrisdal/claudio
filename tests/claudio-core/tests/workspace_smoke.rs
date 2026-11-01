#[test]
fn desktop_integration_api_is_available() {
    assert!(claudio_core::integration_test_api::api_available());
}
