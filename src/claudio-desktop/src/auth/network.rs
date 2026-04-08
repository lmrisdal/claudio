use super::*;

pub(super) fn server_origin(settings: &DesktopSettings) -> Result<String, String> {
    settings
        .server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())
}

pub(super) async fn request_proxy_nonce(settings: &DesktopSettings) -> Result<String, String> {
    let origin = server_origin(settings)?;
    let client = desktop_http_client()?;
    let response = apply_custom_headers(
        client.post(format!("{origin}/api/auth/remote")),
        &settings.custom_headers,
    )
    .send()
    .await
    .map_err(|error| format!("Failed to contact auth server: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_response_error(response, "Authentication failed")
            .await
            .unwrap_or_else(|message| message));
    }

    let payload: ProxyNonceResponse = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse proxy login response: {error}"))?;

    Ok(payload.nonce)
}

pub(super) async fn derive_session(
    settings: &DesktopSettings,
    access_token: &str,
) -> Result<DesktopSession, String> {
    if let Some(session) = parse_session(access_token) {
        return Ok(session);
    }

    let origin = server_origin(settings)?;
    let client = desktop_http_client()?;
    let response = apply_custom_headers(
        client
            .get(format!("{origin}/api/auth/me"))
            .bearer_auth(access_token),
        &settings.custom_headers,
    )
    .send()
    .await
    .map_err(|error| format!("Failed to load desktop session: {error}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(DesktopSession::logged_out());
    }

    if !response.status().is_success() {
        return Err(
            parse_response_error(response, "Failed to load desktop session")
                .await
                .unwrap_or_else(|message| message),
        );
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse desktop session response: {error}"))?;

    let id = match payload.get("id") {
        Some(Value::String(value)) => value.parse().map_err(|_| "Invalid user id.".to_string())?,
        Some(Value::Number(value)) => value
            .as_i64()
            .ok_or_else(|| "Invalid user id.".to_string())?,
        _ => return Ok(DesktopSession::logged_out()),
    };
    let username = payload
        .get("username")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing username in desktop session.".to_string())?
        .to_string();
    let role = payload
        .get("role")
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing role in desktop session.".to_string())?
        .to_ascii_lowercase();

    Ok(DesktopSession {
        is_logged_in: true,
        user: Some(DesktopUser { id, username, role }),
    })
}

pub(super) async fn exchange_tokens(
    settings: &DesktopSettings,
    mut parameters: Vec<(&'static str, String)>,
) -> Result<StoredTokens, ExchangeError> {
    let origin = server_origin(settings).map_err(ExchangeError::Transport)?;
    parameters.push(("client_id", CLIENT_ID.to_string()));

    let client = desktop_http_client().map_err(ExchangeError::Transport)?;
    let response = apply_custom_headers(
        client
            .post(format!("{origin}/connect/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&parameters),
        &settings.custom_headers,
    )
    .send()
    .await
    .map_err(|error| ExchangeError::Transport(format!("Failed to contact auth server: {error}")))?;

    if !response.status().is_success() {
        let message = parse_response_error(response, "Authentication failed")
            .await
            .unwrap_or_else(|message| message);
        return Err(ExchangeError::Rejected(message));
    }

    let payload: TokenResponse = response.json().await.map_err(|error| {
        ExchangeError::Transport(format!("Failed to parse auth response: {error}"))
    })?;

    Ok(StoredTokens {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
    })
}

async fn parse_response_error(
    response: reqwest::Response,
    fallback: &str,
) -> Result<String, String> {
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read server error: {error}"))?;

    if body.trim().is_empty() {
        return Ok(fallback.to_string());
    }

    match serde_json::from_str::<Value>(&body) {
        Ok(Value::Object(json)) => Ok(json
            .get("error_description")
            .and_then(Value::as_str)
            .or_else(|| json.get("error").and_then(Value::as_str))
            .unwrap_or(&body)
            .to_string()),
        _ => Ok(body),
    }
}

pub(super) enum ExchangeError {
    Rejected(String),
    Transport(String),
}

impl From<ExchangeError> for String {
    fn from(value: ExchangeError) -> Self {
        match value {
            ExchangeError::Rejected(message) | ExchangeError::Transport(message) => message,
        }
    }
}
