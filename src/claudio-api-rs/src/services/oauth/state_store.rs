use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use dashmap::DashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const STATE_TTL: Duration = Duration::from_secs(300);
const PURGE_INTERVAL: Duration = Duration::from_secs(120);

struct StateEntry {
    return_to: String,
    expires_at: Instant,
}

pub struct OAuthStateStore {
    map: DashMap<String, StateEntry>,
    last_purge: Mutex<Instant>,
}

impl Default for OAuthStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl OAuthStateStore {
    pub fn new() -> Self {
        Self {
            map: DashMap::new(),
            last_purge: Mutex::new(Instant::now()),
        }
    }

    pub fn create(&self, return_to: &str) -> String {
        self.maybe_purge();

        let mut bytes = [0u8; 32];
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
        let state = URL_SAFE_NO_PAD.encode(bytes);

        self.map.insert(
            state.clone(),
            StateEntry {
                return_to: return_to.to_string(),
                expires_at: Instant::now() + STATE_TTL,
            },
        );

        state
    }

    pub fn consume(&self, state: &str) -> Option<String> {
        let (_, entry) = self.map.remove(state)?;
        if Instant::now() > entry.expires_at {
            return None;
        }
        Some(entry.return_to)
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
