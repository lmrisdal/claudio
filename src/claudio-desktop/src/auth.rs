mod network;
mod storage;
#[cfg(test)]
mod tests;

use crate::http_client::desktop_http_client;
use crate::settings::DesktopSettings;
use base64::Engine as _;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use network::{ExchangeError, derive_session, exchange_tokens, request_proxy_nonce};
#[cfg(test)]
use storage::fallback_tokens_path;
#[cfg(any(test, feature = "integration-tests"))]
use storage::{cache_tokens, clear_secure_storage_dialog_state};
use storage::{
    clear_plain_file_tokens, clear_secure_tokens,
    invalidate_plaintext_fallback_if_secure_storage_available, load_plain_file_tokens,
    load_secure_tokens, storage_backend, store_plain_file_tokens, store_secure_tokens,
};

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
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(AuthStorageBackend::PlainFile);
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
