use super::*;
use std::fs;
use std::path::PathBuf;

pub(super) fn storage_backend(settings: &DesktopSettings) -> Result<AuthStorageBackend, String> {
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

pub(super) fn probe_secure_storage() -> Result<(), String> {
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

pub(super) fn fallback_tokens_path() -> PathBuf {
    crate::settings::auth_fallback_tokens_path()
}

pub(super) fn invalidate_plaintext_fallback_if_secure_storage_available(
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

pub(super) fn store_secure_tokens(tokens: &StoredTokens) -> Result<(), String> {
    let entry = token_entry()?;
    let payload = serde_json::to_string(tokens).map_err(|error| error.to_string())?;
    entry.set_password(&payload).map_err(map_keyring_error)?;

    cache_tokens(Some(tokens.clone()));
    clear_secure_storage_dialog_state();
    Ok(())
}

pub(super) fn load_secure_tokens() -> Result<Option<StoredTokens>, String> {
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

pub(super) fn clear_secure_tokens() -> Result<(), String> {
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

pub(super) fn store_plain_file_tokens(tokens: &StoredTokens) -> Result<(), String> {
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

pub(super) fn load_plain_file_tokens() -> Result<Option<StoredTokens>, String> {
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

pub(super) fn clear_plain_file_tokens() -> Result<(), String> {
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

pub(super) fn clear_secure_storage_dialog_state() {
    SECURE_STORAGE_DIALOG_SHOWN.store(false, Ordering::SeqCst);
}

fn cached_tokens() -> Option<StoredTokens> {
    TOKEN_CACHE.read().ok().and_then(|tokens| tokens.clone())
}

pub(super) fn cache_tokens(tokens: Option<StoredTokens>) {
    if let Ok(mut cache) = TOKEN_CACHE.write() {
        *cache = tokens;
    }
}
