//! Process-wide state, handed to commands by Tauri.
//!
//! Tauri may run commands on several threads at once, so anything shared has to
//! be `Send + Sync`. The usual Rust answer is a lock. We use `RwLock` rather
//! than `Mutex` because the snapshot is read on every UI query but rewritten
//! only on an explicit reload — many readers, rare writer.

use crate::boot::BootStatus;
use crate::discovery::StackSnapshot;
use crate::sync::RwLockExt;
use std::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    snapshot: RwLock<Option<StackSnapshot>>,
    // Tauri's event system is fire-and-forget with no replay buffer: a
    // listener that subscribes *after* an event fired simply never sees it.
    // The splash webview can take tens to hundreds of milliseconds to load,
    // mount React, and register its `boot:status` listener, while
    // `boot::start`'s filesystem work can finish in under a millisecond on a
    // warm cache — so in the common case, `Ready` fires before anyone is
    // listening for it. Keeping the latest status here gives the frontend a
    // second way to find out: it polls this once on mount for whatever it
    // missed, in addition to subscribing for whatever hasn't happened yet.
    // See `boot::emit` for the write side, and `Splash.tsx` for how the two
    // are reconciled without opening a race in the *other* direction.
    boot_status: RwLock<Option<BootStatus>>,
}

impl AppState {
    pub fn store(&self, snapshot: StackSnapshot) {
        // Poisoning is a panic here, not an error — see `sync`.
        *self.snapshot.write_or_panic() = Some(snapshot);
    }

    /// A clone of the last snapshot, or `None` before the first load.
    ///
    /// Cloning keeps the lock held for the shortest possible time — the caller
    /// gets its own copy instead of a guard it might hold across an await.
    pub fn get(&self) -> Option<StackSnapshot> {
        self.snapshot.read_or_panic().clone()
    }

    /// Overwrite the latest boot status. Called from `boot::emit`, always
    /// immediately before the same value goes out over the `boot:status`
    /// event — see that function for why the ordering matters.
    pub fn store_boot_status(&self, status: BootStatus) {
        *self.boot_status.write_or_panic() = Some(status);
    }

    /// The latest boot status, or `None` if `boot::start` hasn't reported one
    /// yet (a narrow window right at process start). `commands::boot_status`
    /// is where that `None` becomes a concrete fallback value for the
    /// frontend — this stays symmetric with `get`'s `Option<StackSnapshot>`
    /// rather than inventing a placeholder `BootStatus` here.
    pub fn boot_status(&self) -> Option<BootStatus> {
        self.boot_status.read_or_panic().clone()
    }
}
