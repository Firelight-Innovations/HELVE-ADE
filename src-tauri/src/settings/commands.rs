//! What the settings screen calls.
//!
//! Declared here rather than in `commands.rs` for the reason `git`, `search`
//! and `mcp` declare their own: the command is the module's public surface, and
//! separating the two means a change to what settings expose is one file rather
//! than two that have to agree.
//!
//! Every write goes through [`super::commit`] on its way out, so persisting and
//! announcing are not two things a caller can do one of.

use super::{commit, Registry, Snapshot};
use crate::error::Result;
use serde_json::Value;
use tauri::{AppHandle, State};

/// Every group this build has, and every value changed away from its default.
///
/// The whole screen in one call. Fetched once on open and then kept current by
/// `settings:changed`, the same shape `useShellState` and `useLayoutPresets`
/// already use — see `settings::SETTINGS_CHANGED_EVENT` for why the event
/// carries the whole map.
#[tauri::command]
pub fn settings_snapshot(registry: State<'_, Registry>) -> Snapshot {
    registry.snapshot()
}

/// Change one setting, returning the value that was actually stored.
///
/// Not necessarily the one passed in — a number is clamped into its range — so
/// the control redraws from what comes back rather than from what it sent. That
/// is what makes a stepper held at the top edge stop at the maximum instead of
/// drifting past it and being silently corrected on the next launch.
#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    registry: State<'_, Registry>,
    key: String,
    value: Value,
) -> Result<Value> {
    let stored = registry.set(&key, value)?;
    commit(&app);
    Ok(stored)
}

/// Put one setting back to what it ships with, returning that default.
#[tauri::command]
pub fn settings_reset(app: AppHandle, registry: State<'_, Registry>, key: String) -> Result<Value> {
    let default = registry.reset(&key)?;
    commit(&app);
    Ok(default)
}

/// Put a whole section back, returning how many settings actually moved.
///
/// A count rather than nothing, because the button that calls this is worth
/// disabling when the answer would be zero — and because an id naming no
/// registered group is not an error here. The screen only ever draws groups the
/// registry gave it, so a zero means "nothing in this section had been
/// changed", which is a state and not a failure.
#[tauri::command]
pub fn settings_reset_group(app: AppHandle, registry: State<'_, Registry>, id: String) -> usize {
    let moved = registry.reset_group(&id);
    if moved > 0 {
        commit(&app);
    }
    moved
}
