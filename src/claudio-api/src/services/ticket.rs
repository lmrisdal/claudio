use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use dashmap::DashMap;

trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

struct TicketEntry {
    game_id: i32,
    expires_at: Instant,
}

pub struct TicketStore {
    tickets: DashMap<String, TicketEntry>,
    ttl: Duration,
    last_purge: Mutex<Instant>,
    clock: Arc<dyn Clock>,
}

impl TicketStore {
    #[must_use]
    pub fn new(ttl: Duration) -> Self {
        let clock = Arc::new(SystemClock);
        Self {
            tickets: DashMap::new(),
            ttl,
            last_purge: Mutex::new(clock.now()),
            clock,
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
                expires_at: self.clock.now() + self.ttl,
            },
        );

        token
    }

    pub fn is_valid(&self, token: &str, game_id: i32) -> bool {
        let Some(mut ticket) = self.tickets.get_mut(token) else {
            return false;
        };

        let now = self.clock.now();
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

        ticket.game_id == game_id && ticket.expires_at > self.clock.now()
    }

    fn maybe_purge(&self) {
        let mut last_purge = self
            .last_purge
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.clock.now().duration_since(*last_purge) < Duration::from_secs(60) {
            return;
        }

        *last_purge = self.clock.now();
        drop(last_purge);

        let now = self.clock.now();
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
    use std::{
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use super::{Clock, EmulationTicketStore, TicketStore};

    struct FakeClock(Mutex<Instant>);

    impl FakeClock {
        fn new() -> Arc<Self> {
            Arc::new(Self(Mutex::new(Instant::now())))
        }

        fn advance(&self, duration: Duration) {
            *self.0.lock().unwrap() += duration;
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            *self.0.lock().unwrap()
        }
    }

    fn store_with_clock(ttl: Duration, clock: Arc<FakeClock>) -> TicketStore {
        let clock_now = clock.now();
        TicketStore {
            tickets: dashmap::DashMap::new(),
            ttl,
            last_purge: Mutex::new(clock_now),
            clock: clock as Arc<dyn Clock>,
        }
    }

    #[test]
    fn is_valid_accepts_active_ticket() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        clock.advance(Duration::from_secs(30));
        assert!(store.is_valid(&token, 7));
    }

    #[test]
    fn is_valid_rejects_expired_ticket() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        clock.advance(Duration::from_secs(61));
        assert!(!store.is_valid(&token, 7));
    }

    #[test]
    fn is_valid_renews_active_ticket() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        // advance to just before expiry, renew
        clock.advance(Duration::from_secs(50));
        assert!(store.is_valid(&token, 7));

        // advance past the original TTL — ticket was renewed so it must still be valid
        clock.advance(Duration::from_secs(50));
        assert!(store.is_valid(&token, 7));
    }

    #[test]
    fn is_valid_rejects_wrong_game_id() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        assert!(!store.is_valid(&token, 99));
    }

    #[test]
    fn redeem_keeps_single_use_behavior() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        assert!(store.redeem(&token, 7));
        assert!(!store.redeem(&token, 7));
    }

    #[test]
    fn redeem_rejects_expired_ticket() {
        let clock = FakeClock::new();
        let store = store_with_clock(Duration::from_secs(60), Arc::clone(&clock));
        let token = store.create(7);

        clock.advance(Duration::from_secs(61));
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
