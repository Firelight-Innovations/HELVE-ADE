//! Lock accessors for state this process owns outright.
//!
//! Every `RwLock` and `Mutex` in this binary guards something the orchestrator
//! is the sole author of — the shell layout, the pty table, the resolved stack,
//! the open project. A poisoned lock means an earlier thread panicked partway
//! through a write, so the value behind it is half-applied and every reader
//! after that point would be answering from a state nobody designed. Stopping
//! at the first access is better than serving that to every window.
//!
//! STANDARDS.md §5 already allows the panic — "a mutex you own" is its own
//! example of a genuine invariant — and asks for a comment naming the invariant.
//! This module is that comment, written once instead of at forty call sites.
//!
//! Rejected: `parking_lot`, whose locks do not poison at all. It answers the
//! question by deleting it, and swapping every lock in the binary onto a new
//! dependency is a larger change than the one decision made here.

use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// What a poisoned lock means here, in the one place it is said.
///
/// `#[track_caller]` on the accessors below puts the *caller's* file and line in
/// the panic, so this message does not have to name the lock the way the
/// hand-written `expect` strings it replaced did.
const POISONED: &str = "lock poisoned: a thread panicked mid-write, so this state is half-applied";

/// `RwLock` access that treats poisoning as a bug rather than an error.
pub trait RwLockExt<T: ?Sized> {
    /// Shared access, for the many readers a snapshot has.
    fn read_or_panic(&self) -> RwLockReadGuard<'_, T>;

    /// Exclusive access, for the rare writer.
    fn write_or_panic(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T: ?Sized> RwLockExt<T> for RwLock<T> {
    #[track_caller]
    fn read_or_panic(&self) -> RwLockReadGuard<'_, T> {
        match self.read() {
            Ok(guard) => guard,
            Err(_) => panic!("{POISONED}"),
        }
    }

    #[track_caller]
    fn write_or_panic(&self) -> RwLockWriteGuard<'_, T> {
        match self.write() {
            Ok(guard) => guard,
            Err(_) => panic!("{POISONED}"),
        }
    }
}

/// `Mutex` access that treats poisoning as a bug rather than an error.
pub trait MutexExt<T: ?Sized> {
    /// Exclusive access. Blocks until the current holder is done.
    fn lock_or_panic(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> MutexExt<T> for Mutex<T> {
    #[track_caller]
    fn lock_or_panic(&self) -> MutexGuard<'_, T> {
        match self.lock() {
            Ok(guard) => guard,
            Err(_) => panic!("{POISONED}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_healthy_rwlock_reads_and_writes() {
        let lock = RwLock::new(1);
        *lock.write_or_panic() += 1;
        assert_eq!(*lock.read_or_panic(), 2);
    }

    #[test]
    fn a_healthy_mutex_locks() {
        let lock = Mutex::new(String::new());
        lock.lock_or_panic().push_str("ok");
        assert_eq!(*lock.lock_or_panic(), "ok");
    }

    #[test]
    #[should_panic(expected = "lock poisoned")]
    fn a_poisoned_rwlock_panics_on_read() {
        let lock = RwLock::new(0);
        let _ = std::panic::catch_unwind(|| {
            let _guard = lock.write_or_panic();
            panic!("poison it");
        });
        drop(lock.read_or_panic());
    }

    #[test]
    #[should_panic(expected = "lock poisoned")]
    fn a_poisoned_mutex_panics_on_lock() {
        let lock = Mutex::new(0);
        let _ = std::panic::catch_unwind(|| {
            let _guard = lock.lock_or_panic();
            panic!("poison it");
        });
        drop(lock.lock_or_panic());
    }
}
