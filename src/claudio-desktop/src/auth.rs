use crate::settings::DesktopSettings;
use crate::http_client::desktop_http_client;
use base64::Engine as _;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const KEYRING_SERVICE: &str = "claudio-desktop";
const KEYRING_ACCOUNT: &str = "auth-tokens";
const CLIENT_ID: &str = "claudio-spa";
const PASSWORD_GRANT_TYPE: &str = "password";
const PROXY_NONCE_GRANT_TYPE: &str = "urn:claudio:proxy_nonce";
const EXTERNAL_LOGIN_NONCE_GRANT_TYPE: &str = "urn:claudio:external_login_nonce";
const REFRESH_TOKEN_GRANT_TYPE: &str = "refresh_token";
const SECURE_STORAGE_ERROR_PREFIX: &str = "Secure storage unavailable:";
const REAUTH_REQUIRED_PREFIX: &str = "Reauthentication required:";

static TOKEN_CACHE: LazyLock<RwLock<Option<StoredTokens>>> = LazyLock::new(|| RwLock::new(None));
static SECURE_STORAGE_DIALOG_SHOWN: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSession {
    pub is_logged_in: bool,
    pub user: Option<DesktopUser>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUser {
    pub id: i64,
    pub username: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProxyNonceResponse {
    nonce: String,
}

#[derive(Clone, Copy)]
enum AuthStorageBackend {
    Secure,
    PlainFile,
}

#[cfg(any(test, feature = "integration-tests"))]
static TEST_AUTH_OVERRIDE_LOCK: LazyLock<std::sync::Mutex<()>> =
    LazyLock::new(|| std::sync::Mutex::new(()));
#[cfg(any(test, feature = "integration-tests"))]
static TEST_STORAGE_BACKEND_OVERRIDE: LazyLock<RwLock<Option<AuthStorageBackend>>> =
    LazyLock::new(|| RwLock::new(None));
#[cfg(any(test, feature = "integration-tests"))]
static TEST_PROBE_SECURE_STORAGE_OVERRIDE: LazyLock<RwLock<Option<Result<(), String>>>> =
    LazyLock::new(|| RwLock::new(None));

#[cfg(any(test, feature = "integration-tests"))]
pub(crate) struct TestAuthGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(any(test, feature = "integration-tests"))]
impl TestAuthGuard {
    pub(crate) fn plain_file_secure_storage_unavailable() -> Self {
        let lock = TEST_AUTH_OVERRIDE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache_tokens(None);
        clear_secure_storage_dialog_state();
        *TEST_STORAGE_BACKEND_OVERRIDE
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(AuthStorageBackend::PlainFile);
        *TEST_PROBE_SECURE_STORAGE_OVERRIDE
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(Err("Secure storage unavailable: test".to_string()));
        Self { _lock: lock }
    }
}

#[cfg(any(test, feature = "integration-tests"))]
impl Drop for TestAuthGuard {
    fn drop(&mut self) {
        cache_tokens(None);
        clear_secure_storage_dialog_state();
        if let Ok(mut override_value) = TEST_STORAGE_BACKEND_OVERRIDE.write() {
            *override_value = None;
        }
        if let Ok(mut override_value) = TEST_PROBE_SECURE_STORAGE_OVERRIDE.write() {
            *override_value = None;
        }
    }
}

impl DesktopSession {
    pub fn logged_out() -> Self {
        Self {
            is_logged_in: false,
            user: None,
        }
    }
}

pub fn store_tokens(settings: &DesktopSettings, tokens: &StoredTokens) -> Result<(), String> {
    match storage_backend(settings)? {
        AuthStorageBackend::Secure => store_secure_tokens(tokens),
        AuthStorageBackend::PlainFile => store_plain_file_tokens(tokens),
    }
}

pub fn load_tokens(settings: &DesktopSettings) -> Result<Option<StoredTokens>, String> {
    match storage_backend(settings)? {
        AuthStorageBackend::Secure => load_secure_tokens(),
        AuthStorageBackend::PlainFile => load_plain_file_tokens(),
    }
}

pub fn clear_tokens(settings: &DesktopSettings) -> Result<(), String> {
    match storage_backend(settings) {
        Ok(AuthStorageBackend::Secure) => {
            clear_plain_file_tokens()?;
            clear_secure_tokens()
        }
        Ok(AuthStorageBackend::PlainFile) => clear_plain_file_tokens(),
        Err(message)
            if is_secure_storage_error(message.as_str())
                && settings.allow_insecure_auth_storage =>
        {
            clear_plain_file_tokens()
        }
        Err(message) => Err(message),
    }
}

pub fn maybe_show_secure_storage_dialog(app: &AppHandle, message: &str) {
    if !is_secure_storage_error(message) {
        return;
    }

    if SECURE_STORAGE_DIALOG_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }

    let guidance = if cfg!(target_os = "linux") {
        "Claudio could not access secure credential storage. Install and unlock a Secret Service-compatible keyring such as GNOME Keyring or KWallet, then try again. Claudio will remain logged out until secure storage is available."
    } else {
        "Claudio could not access secure credential storage. Unlock or re-enable your system keychain/credential manager, then try again. Claudio will remain logged out until secure storage is available."
    };

    app.dialog()
        .message(guidance)
        .title("Secure Storage Unavailable")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

pub fn is_secure_storage_error(message: &str) -> bool {
    message.starts_with(SECURE_STORAGE_ERROR_PREFIX)
}

pub async fn restore_session(settings: &DesktopSettings) -> Result<DesktopSession, String> {
    invalidate_plaintext_fallback_if_secure_storage_available(settings)?;

    let Some(access_token) = access_token_for_request(settings).await? else {
        return Ok(DesktopSession::logged_out());
    };

    derive_session(settings, &access_token).await
}

pub async fn login_with_password(
    settings: &DesktopSettings,
    username: &str,
    password: &str,
) -> Result<DesktopSession, String> {
    let tokens = exchange_tokens(
        settings,
        vec![
            ("grant_type", PASSWORD_GRANT_TYPE.to_string()),
            ("username", username.to_string()),
            ("password", password.to_string()),
            ("scope", "openid offline_access roles".to_string()),
        ],
    )
    .await?;

    finalize_login(settings, tokens).await
}

pub async fn complete_external_login(
    settings: &DesktopSettings,
    nonce: &str,
) -> Result<DesktopSession, String> {
    let tokens = exchange_tokens(
        settings,
        vec![
            ("grant_type", EXTERNAL_LOGIN_NONCE_GRANT_TYPE.to_string()),
            ("nonce", nonce.to_string()),
            ("scope", "openid offline_access roles".to_string()),
        ],
    )
    .await?;

    finalize_login(settings, tokens).await
}

pub async fn proxy_login(settings: &DesktopSettings) -> Result<DesktopSession, String> {
    let nonce = request_proxy_nonce(settings).await?;
    let tokens = exchange_tokens(
        settings,
        vec![
            ("grant_type", PROXY_NONCE_GRANT_TYPE.to_string()),
            ("nonce", nonce),
            ("scope", "openid offline_access roles".to_string()),
        ],
    )
    .await?;

    finalize_login(settings, tokens).await
}

pub async fn access_token_for_request(
    settings: &DesktopSettings,
) -> Result<Option<String>, String> {
    let Some(tokens) = load_tokens(settings)? else {
        return Ok(None);
    };

    if !access_token_is_expired(&tokens.access_token) {
        return Ok(Some(tokens.access_token));
    }

    refresh_access_token(settings).await
}

pub async fn refresh_access_token(settings: &DesktopSettings) -> Result<Option<String>, String> {
    let Some(tokens) = load_tokens(settings)? else {
        return Ok(None);
    };

    let Some(refresh_token) = tokens.refresh_token else {
        return Ok(None);
    };

    let result = exchange_tokens(
        settings,
        vec![
            ("grant_type", REFRESH_TOKEN_GRANT_TYPE.to_string()),
            ("refresh_token", refresh_token),
        ],
    )
    .await;

    match result {
        Ok(tokens) => {
            store_tokens(settings, &tokens)?;
            Ok(Some(tokens.access_token))
        }
        Err(ExchangeError::Rejected(_)) => {
            clear_tokens(settings)?;
            Ok(None)
        }
        Err(ExchangeError::Transport(message)) => Err(message),
    }
}

pub fn apply_custom_headers(
    builder: reqwest::RequestBuilder,
    custom_headers: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    let mut builder = builder;

    for (name, value) in custom_headers {
        if crate::settings::is_forbidden_custom_header(name) {
            continue;
        }

        builder = builder.header(name, value);
    }

    builder
}

async fn finalize_login(
    settings: &DesktopSettings,
    tokens: StoredTokens,
) -> Result<DesktopSession, String> {
    store_tokens(settings, &tokens)?;

    let session = derive_session(settings, &tokens.access_token).await?;
    if session.is_logged_in {
        return Ok(session);
    }

    clear_tokens(settings)?;
    Err("Authentication succeeded but returned an invalid access token.".to_string())
}

fn parse_session(access_token: &str) -> Option<DesktopSession> {
    let payload = parse_jwt_payload(access_token)?;
    if access_token_is_expired(access_token) {
        return None;
    }

    let id = match payload.get("sub")? {
        Value::String(value) => value.parse().ok()?,
        Value::Number(value) => value.as_i64()?,
        _ => return None,
    };

    let username = payload.get("name")?.as_str()?.to_string();
    let role = match payload.get("role")? {
        Value::String(value) => value.to_ascii_lowercase(),
        Value::Array(values) => values.first()?.as_str()?.to_ascii_lowercase(),
        _ => return None,
    };

    Some(DesktopSession {
        is_logged_in: true,
        user: Some(DesktopUser { id, username, role }),
    })
}

fn parse_jwt_payload(access_token: &str) -> Option<Value> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn access_token_is_expired(access_token: &str) -> bool {
    parse_jwt_payload(access_token)
        .and_then(|payload| payload.get("exp").and_then(Value::as_i64))
        .is_some_and(|expires_at| current_timestamp() >= expires_at)
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn storage_backend(settings: &DesktopSettings) -> Result<AuthStorageBackend, String> {
    #[cfg(any(test, feature = "integration-tests"))]
    if let Some(backend) = TEST_STORAGE_BACKEND_OVERRIDE
        .read()
        .ok()
        .and_then(|override_value| *override_value)
    {
        return Ok(backend);
    }

    match probe_secure_storage() {
        Ok(()) => Ok(AuthStorageBackend::Secure),
        Err(message)
            if is_secure_storage_error(message.as_str())
                && settings.allow_insecure_auth_storage =>
        {
            Ok(AuthStorageBackend::PlainFile)
        }
        Err(message) => Err(message),
    }
}

fn probe_secure_storage() -> Result<(), String> {
    #[cfg(any(test, feature = "integration-tests"))]
    if let Some(result) = TEST_PROBE_SECURE_STORAGE_OVERRIDE
        .read()
        .ok()
        .and_then(|override_value| override_value.clone())
    {
        return result;
    }

    let entry = token_entry()?;

    match entry.get_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => {
            clear_secure_storage_dialog_state();
            Ok(())
        }
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn fallback_tokens_path() -> PathBuf {
    crate::settings::auth_fallback_tokens_path()
}

fn invalidate_plaintext_fallback_if_secure_storage_available(
    settings: &DesktopSettings,
) -> Result<(), String> {
    match probe_secure_storage() {
        Ok(()) => {}
        Err(message) if is_secure_storage_error(message.as_str()) => return Ok(()),
        Err(message) => return Err(message),
    }

    let fallback_path = fallback_tokens_path();
    if !fallback_path.exists() && !settings.allow_insecure_auth_storage {
        return Ok(());
    }

    if fallback_path.exists() {
        clear_plain_file_tokens()?;
        let _ = clear_secure_tokens();
        if settings.allow_insecure_auth_storage {
            let mut updated = settings.clone();
            updated.allow_insecure_auth_storage = false;
            crate::settings::save(&updated)?;
        }

        log::info!(
            "Secure storage is available again; invalidated plaintext auth fallback and requiring login"
        );
        return Err(format!(
            "{REAUTH_REQUIRED_PREFIX} secure storage is available again"
        ));
    }

    if settings.allow_insecure_auth_storage {
        let mut updated = settings.clone();
        updated.allow_insecure_auth_storage = false;
        crate::settings::save(&updated)?;
    }

    Ok(())
}

fn store_secure_tokens(tokens: &StoredTokens) -> Result<(), String> {
    let entry = token_entry()?;
    let payload = serde_json::to_string(tokens).map_err(|error| error.to_string())?;
    entry.set_password(&payload).map_err(map_keyring_error)?;

    cache_tokens(Some(tokens.clone()));
    clear_secure_storage_dialog_state();
    Ok(())
}

fn load_secure_tokens() -> Result<Option<StoredTokens>, String> {
    if let Some(tokens) = cached_tokens() {
        return Ok(Some(tokens));
    }

    let entry = token_entry()?;

    match entry.get_password() {
        Ok(payload) => {
            let tokens: StoredTokens = serde_json::from_str(&payload)
                .map_err(|error| format!("Failed to read desktop auth tokens: {error}"))?;
            cache_tokens(Some(tokens.clone()));
            clear_secure_storage_dialog_state();
            Ok(Some(tokens))
        }
        Err(keyring::Error::NoEntry) => {
            cache_tokens(None);
            clear_secure_storage_dialog_state();
            Ok(None)
        }
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn clear_secure_tokens() -> Result<(), String> {
    let entry = token_entry()?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            cache_tokens(None);
            clear_secure_storage_dialog_state();
            Ok(())
        }
        Err(error) => Err(map_keyring_error(error)),
    }
}

fn store_plain_file_tokens(tokens: &StoredTokens) -> Result<(), String> {
    let path = fallback_tokens_path();
    let payload = serde_json::to_vec(tokens).map_err(|error| error.to_string())?;
    fs::write(&path, payload).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }

    cache_tokens(Some(tokens.clone()));
    Ok(())
}

fn load_plain_file_tokens() -> Result<Option<StoredTokens>, String> {
    if let Some(tokens) = cached_tokens() {
        return Ok(Some(tokens));
    }

    let path = fallback_tokens_path();
    if !path.exists() {
        cache_tokens(None);
        return Ok(None);
    }

    let payload = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let tokens: StoredTokens = serde_json::from_str(&payload)
        .map_err(|error| format!("Failed to read fallback auth tokens: {error}"))?;
    cache_tokens(Some(tokens.clone()));
    Ok(Some(tokens))
}

fn clear_plain_file_tokens() -> Result<(), String> {
    let path = fallback_tokens_path();
    match fs::remove_file(&path) {
        Ok(()) => {
            cache_tokens(None);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            cache_tokens(None);
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

fn map_keyring_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::NoStorageAccess(inner) | keyring::Error::PlatformFailure(inner) => {
            format!("{SECURE_STORAGE_ERROR_PREFIX} {inner}")
        }
        other => other.to_string(),
    }
}

fn clear_secure_storage_dialog_state() {
    SECURE_STORAGE_DIALOG_SHOWN.store(false, Ordering::SeqCst);
}

fn cached_tokens() -> Option<StoredTokens> {
    TOKEN_CACHE.read().ok().and_then(|tokens| tokens.clone())
}

fn cache_tokens(tokens: Option<StoredTokens>) {
    if let Ok(mut cache) = TOKEN_CACHE.write() {
        *cache = tokens;
    }
}

fn server_origin(settings: &DesktopSettings) -> Result<String, String> {
    settings
        .server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
        .ok_or_else(|| "Desktop server URL is not configured.".to_string())
}

async fn request_proxy_nonce(settings: &DesktopSettings) -> Result<String, String> {
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

async fn derive_session(
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

async fn exchange_tokens(
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

enum ExchangeError {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{TestResponse, TestServer};
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn encode_token(payload: Value) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(payload.to_string());
        format!("{header}.{payload}.")
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "claudio-auth-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos()
        ))
    }

    fn test_settings(server_url: &str) -> DesktopSettings {
        DesktopSettings {
            server_url: Some(server_url.to_string()),
            allow_insecure_auth_storage: true,
            ..DesktopSettings::default()
        }
    }

    #[test]
    fn parses_valid_session() {
        let token = encode_token(json!({
            "sub": "42",
            "name": "lars",
            "role": "admin",
            "exp": current_timestamp() + 3600,
        }));

        let session = parse_session(&token).expect("session should parse");
        assert!(session.is_logged_in);
        let user = session.user.expect("user should exist");
        assert_eq!(user.id, 42);
        assert_eq!(user.username, "lars");
        assert_eq!(user.role, "admin");
    }

    #[test]
    fn rejects_expired_session() {
        let token = encode_token(json!({
            "sub": "42",
            "name": "lars",
            "role": "admin",
            "exp": current_timestamp() - 1,
        }));

        assert!(parse_session(&token).is_none());
    }

    #[test]
    fn rejects_malformed_session() {
        assert!(parse_session("not-a-jwt").is_none());
    }

    #[test]
    fn parses_numeric_subject_and_role_array() {
        let token = encode_token(json!({
            "sub": 7,
            "name": "alex",
            "role": ["MODERATOR", "ADMIN"],
            "exp": current_timestamp() + 3600,
        }));

        let session = parse_session(&token).expect("session should parse");
        let user = session.user.expect("user should exist");
        assert_eq!(user.id, 7);
        assert_eq!(user.username, "alex");
        assert_eq!(user.role, "moderator");
    }

    #[test]
    fn access_token_without_exp_is_not_treated_as_expired() {
        let token = encode_token(json!({
            "sub": "42",
            "name": "lars",
            "role": "admin",
        }));

        assert!(!access_token_is_expired(&token));
    }

    #[test]
    fn apply_custom_headers_skips_forbidden_headers() {
        let builder = apply_custom_headers(
            reqwest::Client::new().get("https://example.com"),
            &HashMap::from([
                ("X-Test".to_string(), "ok".to_string()),
                ("Authorization".to_string(), "blocked".to_string()),
                ("Cookie".to_string(), "blocked".to_string()),
            ]),
        );

        let request = builder.build().expect("request should build");

        assert_eq!(
            request
                .headers()
                .get("x-test")
                .and_then(|v| v.to_str().ok()),
            Some("ok")
        );
        assert!(!request.headers().contains_key("authorization"));
        assert!(!request.headers().contains_key("cookie"));
    }

    #[test]
    fn server_origin_trims_trailing_slashes() {
        let settings = DesktopSettings {
            server_url: Some(" https://example.com/// ".to_string()),
            ..DesktopSettings::default()
        };

        let origin = server_origin(&settings).expect("origin should be built");

        assert_eq!(origin, "https://example.com");
    }

    #[test]
    fn secure_storage_error_prefix_detection_is_exact() {
        assert!(is_secure_storage_error(
            "Secure storage unavailable: locked"
        ));
        assert!(!is_secure_storage_error("storage unavailable: locked"));
    }

    #[tokio::test]
    async fn login_with_password_stores_tokens_in_plaintext_fallback() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let access_token = encode_token(json!({
            "sub": "42",
            "name": "lars",
            "role": "admin",
            "exp": current_timestamp() + 3600,
        }));
        let token_for_assert = access_token.clone();
        let server = TestServer::spawn(move |request| {
            assert_eq!(request.method, "POST");
            assert_eq!(request.path, "/connect/token");
            assert!(String::from_utf8_lossy(&request.body).contains("grant_type=password"));
            TestResponse::json(
                200,
                &json!({
                    "access_token": token_for_assert,
                    "refresh_token": "refresh-1"
                })
                .to_string(),
            )
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("password-login"), || async {
            let settings = test_settings(server.url());

            let session = login_with_password(&settings, "lars", "secret")
                .await
                .expect("login should succeed");

            assert!(session.is_logged_in);
            let stored = load_tokens(&settings)
                .expect("tokens should load")
                .expect("tokens should be present");
            assert_eq!(stored.refresh_token.as_deref(), Some("refresh-1"));
            assert!(fallback_tokens_path().exists());
        })
        .await;
    }

    #[tokio::test]
    async fn refresh_access_token_clears_tokens_after_rejected_refresh() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| {
            assert_eq!(request.path, "/connect/token");
            TestResponse::json(400, r#"{"error":"invalid_grant"}"#)
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("refresh-rejected"), || async {
            let settings = test_settings(server.url());
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "expired.token.value".to_string(),
                    refresh_token: Some("refresh-1".to_string()),
                },
            )
            .expect("tokens should be stored");

            let refreshed = refresh_access_token(&settings)
                .await
                .expect("refresh should not transport fail");

            assert!(refreshed.is_none());
            assert!(
                load_tokens(&settings)
                    .expect("tokens should load")
                    .is_none()
            );
            assert!(!fallback_tokens_path().exists());
        })
        .await;
    }

    #[tokio::test]
    async fn restore_session_falls_back_to_me_endpoint_for_non_jwt_access_token() {
        let _auth_guard = TestAuthGuard::plain_file_secure_storage_unavailable();
        let server = TestServer::spawn(|request| match request.path.as_str() {
            "/api/auth/me" => {
                assert_eq!(
                    request.headers.get("authorization").map(String::as_str),
                    Some("Bearer opaque-token")
                );
                TestResponse::json(200, r#"{"id":5,"username":"lars","role":"ADMIN"}"#)
            }
            _ => TestResponse::text(404, "missing"),
        });

        crate::settings::with_test_data_dir_async(unique_test_dir("restore-session"), || async {
            let settings = test_settings(server.url());
            store_tokens(
                &settings,
                &StoredTokens {
                    access_token: "opaque-token".to_string(),
                    refresh_token: None,
                },
            )
            .expect("tokens should be stored");

            let session = restore_session(&settings)
                .await
                .expect("session restore should succeed");

            assert!(session.is_logged_in);
            let user = session.user.expect("user should exist");
            assert_eq!(user.id, 5);
            assert_eq!(user.username, "lars");
            assert_eq!(user.role, "admin");
        })
        .await;
    }
}
