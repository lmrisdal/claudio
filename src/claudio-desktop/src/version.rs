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
