const COMMIT_SHA_ENV: &str = "CLAUDIO_COMMIT_SHA";
const SHORT_SHA_LENGTH: usize = 7;

pub fn display_version() -> String {
    if let Ok(sha) = std::env::var(COMMIT_SHA_ENV) {
        let trimmed = sha.trim();
        if !trimmed.is_empty() {
            return trimmed.chars().take(SHORT_SHA_LENGTH).collect();
        }
    }

    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{LazyLock, Mutex};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn display_version_uses_short_commit_sha_when_present() {
        let _lock = ENV_LOCK.lock().expect("env lock should not be poisoned");
        unsafe {
            std::env::set_var(COMMIT_SHA_ENV, "abcdef123456");
        }

        assert_eq!(display_version(), "abcdef1");

        unsafe {
            std::env::remove_var(COMMIT_SHA_ENV);
        }
    }

    #[test]
    fn display_version_falls_back_to_package_version_when_env_missing() {
        let _lock = ENV_LOCK.lock().expect("env lock should not be poisoned");
        unsafe {
            std::env::remove_var(COMMIT_SHA_ENV);
        }

        assert_eq!(display_version(), env!("CARGO_PKG_VERSION"));
    }
}
