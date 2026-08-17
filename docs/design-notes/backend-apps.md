# Backend apps design notes

Design rationale moved out of `src-tauri/src/apps` to keep comment concentration under the caps in
STANDARDS.md §10. Each source file below points back at its section here.

## src-tauri/src/apps/mod.rs

### The three consumers that make a wider `REGISTRY` expensive

Three of those consumers make the cost concrete, and all three are silent
failures rather than compile errors:

  * `roster` is what boot blocks on until each app reports a painted
    frame. A terminal has no frame to report, so a terminal in the roster is
    a splash screen that waits out its full timeout on **every launch**.
  * `is_app` gates `tool_frontend::resolve`, and a `true` there sends
    something looking for a frontend down a path that has none.
  * `call` would find a row with no dispatch to call.
