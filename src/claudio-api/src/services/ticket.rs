use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use dashmap::DashMap;

struct TicketEntry {
    game_id: i32,
    expires_at: Instant,
}

pub struct TicketStore {
    tickets: DashMap<String, TicketEntry>,
    ttl: Duration,
    last_purge: Mutex<Instant>,
}

impl TicketStore {
    #[must_use]
    pub fn new(ttl: Duration) -> Self {
        Self {
            tickets: DashMap::new(),
            ttl,
            last_purge: Mutex::new(Instant::now()),
        }
    }

    pub fn create(&self, game_id: i32) -> String {
        self.maybe_purge();

        let mut bytes = [0_u8; 32];
        rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
        let token = URL_SAFE_NO_PAD.encode(bytes);

        self.tickets.insert(
            token.clone(),
            TicketEntry {
                game_id,
                expires_at: Instant::now() + self.ttl,
            },
        );

        token
    }

    pub fn is_valid(&self, token: &str, game_id: i32) -> bool {
        let Some(mut ticket) = self.tickets.get_mut(token) else {
            return false;
        };

        let now = Instant::now();
        if ticket.expires_at <= now {
            drop(ticket);
            self.tickets.remove(token);
            return false;
        }

        if ticket.game_id != game_id {
            return false;
        }

        ticket.expires_at = now + self.ttl;
        true
    }

    pub fn redeem(&self, token: &str, game_id: i32) -> bool {
        let Some((_, ticket)) = self.tickets.remove(token) else {
            return false;
        };

        ticket.game_id == game_id && ticket.expires_at > Instant::now()
    }

    fn maybe_purge(&self) {
        let mut last_purge = self
            .last_purge
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if last_purge.elapsed() < Duration::from_secs(60) {
            return;
        }

        *last_purge = Instant::now();
        drop(last_purge);

        let now = Instant::now();
        self.tickets.retain(|_, ticket| ticket.expires_at > now);
    }
}

pub struct EmulationTicketStore(pub TicketStore);

impl Default for EmulationTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl EmulationTicketStore {
    #[must_use]
    pub fn new() -> Self {
        Self(TicketStore::new(Duration::from_secs(30 * 60)))
    }

    pub fn create(&self, game_id: i32) -> String {
        self.0.create(game_id)
    }

    pub fn is_valid(&self, token: &str, game_id: i32) -> bool {
        self.0.is_valid(token, game_id)
    }
}

pub struct DownloadTicketStore(pub TicketStore);

impl Default for DownloadTicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl DownloadTicketStore {
    #[must_use]
    pub fn new() -> Self {
        Self(TicketStore::new(Duration::from_secs(30)))
    }

    pub fn create(&self, game_id: i32) -> String {
        self.0.create(game_id)
    }

    pub fn redeem(&self, token: &str, game_id: i32) -> bool {
        self.0.redeem(token, game_id)
    }
}

#[cfg(test)]
mod tests {
    use std::{thread, time::Duration};

    use super::{EmulationTicketStore, TicketStore};

    #[test]
    fn is_valid_renews_active_ticket() {
        let store = TicketStore::new(Duration::from_millis(200));
        let token = store.create(7);

        thread::sleep(Duration::from_millis(100));
        assert!(store.is_valid(&token, 7));

        thread::sleep(Duration::from_millis(150));
        assert!(store.is_valid(&token, 7));
    }

    #[test]
    fn redeem_keeps_single_use_behavior() {
        let store = TicketStore::new(Duration::from_secs(1));
        let token = store.create(7);

        assert!(store.redeem(&token, 7));
        assert!(!store.redeem(&token, 7));
    }

    #[test]
    fn emulation_tickets_are_url_safe() {
        let store = EmulationTicketStore::new();
        let token = store.create(1);

        assert!(!token.contains('+'));
        assert!(!token.contains('/'));
        assert!(!token.contains('='));
    }
}
