use super::*;

pub(super) fn build_headers(
    custom_headers: &HashMap<String, String>,
    token: Option<&str>,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (name, value) in custom_headers {
        if settings::is_forbidden_custom_header(name) {
            continue;
        }

        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|err| err.to_string())?;
        let header_value = HeaderValue::from_str(value).map_err(|err| err.to_string())?;
        headers.insert(header_name, header_value);
    }

    if let Some(token) = token {
        let auth_value =
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|err| err.to_string())?;
        headers.insert(AUTHORIZATION, auth_value);
    }

    Ok(headers)
}

pub(super) async fn authenticated_headers_with<G>(
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
    mut on_logged_out: G,
) -> Result<HeaderMap, String>
where
    G: FnMut() -> Result<(), String>,
{
    let Some(access_token) = auth::access_token_for_request(settings).await? else {
        let _ = on_logged_out();
        return Err("You need to sign in before installing games.".to_string());
    };

    build_headers(custom_headers, Some(&access_token))
}

pub(super) async fn refreshed_headers_with<G>(
    settings: &settings::DesktopSettings,
    custom_headers: &HashMap<String, String>,
    mut on_logged_out: G,
) -> Result<Option<HeaderMap>, String>
where
    G: FnMut() -> Result<(), String>,
{
    let Some(access_token) = auth::refresh_access_token(settings).await? else {
        let _ = on_logged_out();
        return Ok(None);
    };

    build_headers(custom_headers, Some(&access_token)).map(Some)
}
