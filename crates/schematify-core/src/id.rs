//! UUIDv7 minting, monotonic inside a millisecond.
//!
//! PRD section 3.1 bans a sequential identifier and a path-derived one: two
//! agents on two branches that both mint `MOD-0042` produce two nodes with one
//! identity and no tool reports it. UUIDv7 removes the collision and keeps the
//! time ordering that made the sequential scheme attractive.
//!
//! The minting is written out here rather than taken from the `uuid` crate's
//! `v7` feature for one reason: RFC 9562 leaves in-millisecond ordering to the
//! implementation, and Schematify asserts it. A minter that hands out two ids
//! in the same millisecond in the wrong order would sort a node's own history
//! backwards. The counter below is RFC 9562 section 6.2 method 1 - twelve
//! dedicated bits in `rand_a`, seeded low so there is room to climb, and a
//! borrow from the timestamp when it fills.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

/// The widest value the twelve-bit counter holds before it borrows a
/// millisecond from the timestamp.
const COUNTER_MAX: u16 = 0x0fff;

/// Where a fresh millisecond seeds its counter. Half the space is left above
/// it, which is 2048 ids inside one millisecond before the borrow.
const COUNTER_SEED_MASK: u16 = 0x07ff;

/// A source of time-ordered identifiers.
///
/// Every id from one minter is strictly greater than the one before it, in
/// byte order, and so in string order too. Two minters in one process share
/// nothing; use [`mint_id`] for the process-wide one.
#[derive(Debug)]
pub struct IdMinter {
    last_ms: u64,
    counter: u16,
    state: u64,
}

impl IdMinter {
    /// A minter seeded from the operating system.
    ///
    /// A failure to read system randomness falls back to the clock rather than
    /// returning an error. Randomness here defends against two *machines*
    /// colliding on the same millisecond; the monotonic counter, not the
    /// random tail, is what keeps one machine's ids apart, and it does not
    /// depend on the seed.
    #[must_use]
    pub fn new() -> Self {
        let mut seed = [0u8; 8];
        let state = match getrandom::fill(&mut seed) {
            Ok(()) => u64::from_le_bytes(seed),
            Err(_) => now_ms().wrapping_mul(0x9e37_79b9_7f4a_7c15),
        };
        Self::from_seed(state)
    }

    /// A minter with a named seed, so a test can assert an exact byte layout.
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        Self {
            last_ms: 0,
            counter: 0,
            state: seed | 1,
        }
    }

    /// The next identifier, stamped with the current system time.
    pub fn mint(&mut self) -> Uuid {
        self.mint_at(now_ms())
    }

    /// The next identifier, stamped with a caller-supplied millisecond.
    ///
    /// A timestamp at or below the last one issued does not move the clock
    /// backwards: the minter keeps its own high-water mark and climbs the
    /// counter instead, so a clock that steps back still yields rising ids.
    pub fn mint_at(&mut self, unix_ms: u64) -> Uuid {
        if unix_ms > self.last_ms {
            self.last_ms = unix_ms;
            self.counter = self.next_u64() as u16 & COUNTER_SEED_MASK;
        } else if self.counter >= COUNTER_MAX {
            self.last_ms += 1;
            self.counter = 0;
        } else {
            self.counter += 1;
        }

        let ms = self.last_ms & 0x0000_ffff_ffff_ffff;
        let tail = self.next_u64();

        let mut bytes = [0u8; 16];
        bytes[0..6].copy_from_slice(&ms.to_be_bytes()[2..8]);
        bytes[6] = 0x70 | ((self.counter >> 8) as u8 & 0x0f);
        bytes[7] = (self.counter & 0x00ff) as u8;
        bytes[8..16].copy_from_slice(&tail.to_be_bytes());
        bytes[8] = 0x80 | (bytes[8] & 0x3f);

        Uuid::from_bytes(bytes)
    }

    /// xorshift64*. Not cryptographic, and it does not need to be: these bits
    /// pad an identifier that is already unique through its counter.
    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
}

impl Default for IdMinter {
    fn default() -> Self {
        Self::new()
    }
}

/// The process-wide minter, so two callers in one Schematify never race into
/// the same millisecond with the same counter.
static PROCESS_MINTER: Mutex<Option<IdMinter>> = Mutex::new(None);

/// Mint one identifier from the process-wide minter.
#[must_use]
pub fn mint_id() -> Uuid {
    // A poisoned lock is recovered rather than propagated. The minter holds
    // three integers and no invariant that spans a statement, so a thread that
    // panicked while holding it left nothing half-applied - the worst case is a
    // counter that did not advance, and the next mint advances it.
    let mut guard = match PROCESS_MINTER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.get_or_insert_with(IdMinter::new).mint()
}

/// The millisecond a UUIDv7 was stamped with.
///
/// Returns `None` for a UUID of any other version, because the leading 48 bits
/// of a v4 are random and reading them as a time would invent a date.
#[must_use]
pub fn id_timestamp_ms(id: Uuid) -> Option<u64> {
    if id.get_version_num() != 7 {
        return None;
    }
    let b = id.as_bytes();
    let mut ms = [0u8; 8];
    ms[2..8].copy_from_slice(&b[0..6]);
    Some(u64::from_be_bytes(ms))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_id_carries_version_seven_and_the_rfc_variant() {
        let id = IdMinter::from_seed(7).mint_at(1_756_000_000_000);
        assert_eq!(id.get_version_num(), 7);
        assert_eq!(id.as_bytes()[8] & 0xc0, 0x80);
    }

    #[test]
    fn an_id_carries_the_millisecond_it_was_stamped_with() {
        let ms = 1_756_000_000_000;
        let id = IdMinter::from_seed(7).mint_at(ms);
        assert_eq!(id_timestamp_ms(id), Some(ms));
    }

    #[test]
    fn a_v4_id_reports_no_timestamp() {
        let id = Uuid::parse_str("0192f4a1-4c3d-4890-a1b2-c3d4e5f6a7b8").unwrap();
        assert_eq!(id_timestamp_ms(id), None);
    }

    #[test]
    fn ids_rise_inside_one_millisecond() {
        let mut minter = IdMinter::from_seed(42);
        let mut previous = minter.mint_at(1_756_000_000_000);
        for _ in 0..5_000 {
            let next = minter.mint_at(1_756_000_000_000);
            assert!(next > previous, "{next} did not follow {previous}");
            previous = next;
        }
    }

    #[test]
    fn ids_rise_when_the_clock_steps_backwards() {
        let mut minter = IdMinter::from_seed(9);
        let first = minter.mint_at(1_756_000_000_000);
        let second = minter.mint_at(1_755_000_000_000);
        assert!(second > first);
    }

    #[test]
    fn a_full_counter_borrows_a_millisecond() {
        let mut minter = IdMinter::from_seed(1);
        minter.mint_at(1_000);
        minter.counter = COUNTER_MAX;
        let next = minter.mint_at(1_000);
        assert_eq!(id_timestamp_ms(next), Some(1_001));
    }

    #[test]
    fn ids_are_unique_across_many_mints() {
        let mut minter = IdMinter::from_seed(1_234);
        let mut seen = std::collections::HashSet::new();
        for i in 0..10_000u64 {
            assert!(seen.insert(minter.mint_at(1_756_000_000_000 + i / 100)));
        }
    }

    #[test]
    fn the_process_minter_rises_too() {
        let first = mint_id();
        let second = mint_id();
        assert!(second > first);
    }
}
