### Install

Download **`HELVE-setup.exe`** below and run it. The wizard never asks for
administrator rights and installs for your account only.

> **Windows will warn you, and you can go ahead.** The installer is not signed,
> so SmartScreen shows "Windows protected your PC" and hides the button. Click
> **More info**, then **Run anyway**. A signing certificate costs money that a
> pre-alpha does not yet justify.

Once installed, right-click any folder in Explorer and choose **Open with
HELVE** to open it as a project. Files get the same entry and open in the File
Viewer with their folder as the project.

### Before you file a bug

**HELVE is pre-alpha.** The window runs, and so do its own apps: Home, the File
Explorer, the File Viewer and Tutorials. The stack tools, Forger and Journeyman,
are placeholder repositories and do not load.

**An installed build cannot find a stack yet, and every tool reads
`not installed`. That reading is correct.** HELVE looks for `helve.toml` next to
its executable or at `$HELVE_MANIFEST`, and an installed copy has neither
pointed at your code. Run from a source checkout to watch a stack resolve.

**Windows only.** macOS and Linux are untested rather than excluded.

---
