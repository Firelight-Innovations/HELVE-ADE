//! Process-wide state, handed to commands by Tauri, which may run them on several threads at
//! once — so anything shared has to be `Send + Sync`. `RwLock` rather than `Mutex`: the snapshot
//! is read on every UI query but rewritten only on an explicit reload — many readers, rare writer.

use crate::boot::BootStatus;
use crate::discovery::StackSnapshot;
use crate::sync::RwLockExt;
use std::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    snapshot: RwLock<Option<StackSnapshot>>,
    // Tauri events are fire-and-forget with no replay buffer: a listener that subscribes
    // *after* an event fired never sees it. The splash can take hundreds of milliseconds to
    // mount React and register its `boot:status` listener while `boot::start`'s filesystem
    // work finishes in under one on a warm cache, so `Ready` usually fires first. The frontend
    // polls this once on mount for what it missed and subscribes for the rest; `boot::emit`
    // writes it, and `Splash.tsx` reconciles the two without opening a race the *other* way.
    boot_status: RwLock<Option<BootStatus>>,
}

impl AppState {
    pub fn store(&self, snapshot: StackSnapshot) {
        // Poisoning is a panic here, not an error — see `sync`.
        *self.snapshot.write_or_panic() = Some(snapshot);
    }

    /// A clone of the last snapshot, or `None` before the first load. Cloning
    /// keeps the lock held for the shortest possible time — the caller gets its
    /// own copy instead of a guard it might hold across an await.
    pub fn get(&self) -> Option<StackSnapshot> {
        self.snapshot.read_or_panic().clone()
    }

    /// Overwrite the latest boot status. `boot::emit` calls this immediately
    /// before the same value goes out over `boot:status` — see it for the ordering.
    pub fn store_boot_status(&self, status: BootStatus) {
        *self.boot_status.write_or_panic() = Some(status);
    }

    /// The latest boot status, or `None` if `boot::start` hasn't reported one yet (a narrow
    /// window at process start). `commands::boot_status` turns that into a concrete fallback for
    /// the frontend; symmetric with `get` rather than inventing a placeholder `BootStatus` here.
    pub fn boot_status(&self) -> Option<BootStatus> {
        self.boot_status.read_or_panic().clone()
    }
}
