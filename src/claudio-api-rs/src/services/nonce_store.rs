use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use dashmap::DashMap;
use std::time::{Duration, Instant};

const NONCE_TTL: Duration = Duration::from_secs(30);
const PURGE_INTERVAL: Duration = Duration::from_secs(60);

struct NonceEntry {
    user_id: i32,
    expires_at: Instant,
}

pub struct NonceStore {
    map: DashMap<String, NonceEntry>,
    last_purge: std::sync::Mutex<Instant>,
}

impl Default for NonceStore {
    fn default() -> Self {
        Self::new()
    }
}

impl NonceStore {
    pub fn new() -> Self {
        Self {
            map: DashMap::new(),
            last_purge: std::sync::Mutex::new(Instant::now()),
        }
    }

    pub fn create(&self, user_id: i32) -> String {
        self.maybe_purge();

        let mut bytes = [0u8; 32];
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
        let nonce = URL_SAFE_NO_PAD.encode(bytes);

        self.map.insert(
            nonce.clone(),
            NonceEntry {
                user_id,
                expires_at: Instant::now() + NONCE_TTL,
            },
        );

        nonce
    }

    pub fn consume(&self, nonce: &str) -> Option<i32> {
        let (_, entry) = self.map.remove(nonce)?;
        if Instant::now() > entry.expires_at {
            return None;
        }
        Some(entry.user_id)
    }

    fn maybe_purge(&self) {
        let mut last = self.last_purge.lock().unwrap();
        if last.elapsed() < PURGE_INTERVAL {
            return;
        }
        *last = Instant::now();
        drop(last);

        let now = Instant::now();
        self.map.retain(|_, v| v.expires_at > now);
    }
}

pub struct ProxyNonceStore(pub NonceStore);
pub struct ExternalLoginNonceStore(pub NonceStore);

impl Default for ProxyNonceStore {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for ExternalLoginNonceStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyNonceStore {
    pub fn new() -> Self {
        Self(NonceStore::new())
    }

    pub fn create(&self, user_id: i32) -> String {
        self.0.create(user_id)
    }

    pub fn consume(&self, nonce: &str) -> Option<i32> {
        self.0.consume(nonce)
    }
}

impl ExternalLoginNonceStore {
    pub fn new() -> Self {
        Self(NonceStore::new())
    }

    pub fn create(&self, user_id: i32) -> String {
        self.0.create(user_id)
    }

    pub fn consume(&self, nonce: &str) -> Option<i32> {
        self.0.consume(nonce)
    }
}

#[cfg(test)]
mod tests {
    use super::{ExternalLoginNonceStore, ProxyNonceStore};

    #[test]
    fn proxy_nonce_create_returns_url_safe_token() {
        let store = ProxyNonceStore::new();
        let nonce = store.create(1);

        assert!(!nonce.contains('+'));
        assert!(!nonce.contains('/'));
        assert!(!nonce.contains('='));
    }

    #[test]
    fn proxy_nonce_consume_only_succeeds_once() {
        let store = ProxyNonceStore::new();
        let nonce = store.create(42);

        assert_eq!(store.consume(&nonce), Some(42));
        assert_eq!(store.consume(&nonce), None);
    }

    #[test]
    fn external_login_nonce_invalid_token_returns_none() {
        let store = ExternalLoginNonceStore::new();

        assert_eq!(store.consume("bogus"), None);
    }

    #[test]
    fn external_login_nonce_consume_returns_user_id() {
        let store = ExternalLoginNonceStore::new();
        let nonce = store.create(99);

        assert_eq!(store.consume(&nonce), Some(99));
    }
}
