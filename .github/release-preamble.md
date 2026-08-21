> **Read this before you install.**
>
> **The installers are not signed.** Windows SmartScreen will show a blue
> "Windows protected your PC" box and hide the Run button behind **More info**.
> Click **More info**, then **Run anyway**. A code signing certificate costs
> money that a pre-alpha does not yet justify, so this is expected rather than
> a sign that something is wrong.
>
> **HELVE is pre-alpha.** The window runs, and so do its own apps: Home, the
> File Explorer, the File Viewer and Tutorials. The stack tools, Forger and
> Journeyman, are placeholder repositories and do not load.
>
> **An installed build cannot find a stack yet.** HELVE looks for `helve.toml`
> next to its executable or at `$HELVE_MANIFEST`, and an installed copy has
> neither pointed at your code. Every tool will read `not cloned`. To see the
> stack resolve, run from a source checkout instead. See
> [Releases and updates](../blob/main/docs/dev/releases.md).
>
> **Windows only.** macOS and Linux are untested rather than excluded.

---
