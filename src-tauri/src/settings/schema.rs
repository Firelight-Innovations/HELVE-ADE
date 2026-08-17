//! The shell's own settings.
//!
//! One rule governs what may be added here, and `docs/settings.md` states it in
//! full: **a setting is a decision, and something has to read it.** A row that
//! writes a value nothing consumes is worse than an absent row — it is a
//! promise the interface does not keep, and the person who finds out is the one
//! who changed it and watched nothing happen.
//!
//! So every key below is followed to its reader in the test at the bottom of
//! this file, and every one whose reader is not immediate says so in its
//! [`Applies`].

use super::{Applies, Control, Group, SelectOption, Setting};

/// The key of every setting, for the Rust that reads one.
///
/// Constants rather than string literals at the call sites, and the test at the
/// bottom of this file checks each of them still resolves to a descriptor of
/// the type its reader expects. A typo in a literal would fall back to the
/// zero value silently; a typo here does not compile.
pub mod keys {
    pub const TERMINAL_DEFAULT_SHELL: &str = "terminal.defaultShell";
    pub const TERMINAL_OPEN_ON_LAUNCH: &str = "terminal.openOnLaunch";
    pub const SEARCH_MAX_MATCHES: &str = "search.maxMatches";
    pub const SEARCH_MAX_FILES: &str = "search.maxFiles";
    pub const SEARCH_MAX_FILE_SIZE_MB: &str = "search.maxFileSizeMb";
    pub const MCP_WRITE_PROJECT_CONFIG: &str = "mcp.writeProjectConfig";
}

/// Every group the shell itself registers, in no particular order — `Group::order`
/// decides what the screen draws first.
pub fn groups() -> &'static [&'static Group] {
    GROUPS
}

static GROUPS: &[&Group] = &[&APPEARANCE, &EDITOR, &TERMINAL, &SEARCH, &MCP];

// --- appearance -------------------------------------------------------------
//
// Applied by the frontend as custom properties on the document root, over the
// top of `src/tokens.css` rather than inside it. That file is the decoded
// handoff and says nothing in it is a choice; a user's accent is a choice, so
// it belongs in a layer above rather than as an edit to the spec's own values.

static ACCENTS: &[SelectOption] = &[
    SelectOption {
        value: "#d98a3f",
        label: "Amber",
        description: "The colour the interface was designed in.",
    },
    SelectOption {
        value: "#4f8ff7",
        label: "Blue",
        description: "",
    },
    SelectOption {
        value: "#5fb37a",
        label: "Green",
        description: "",
    },
    SelectOption {
        value: "#a97bf0",
        label: "Violet",
        description: "",
    },
    SelectOption {
        value: "#d9635f",
        label: "Coral",
        description: "",
    },
];

static APPEARANCE_SETTINGS: &[Setting] = &[
    Setting {
        key: "appearance.accentColor",
        title: "Accent colour",
        description: "The active tab's rule, focus rings, drop targets and primary buttons.",
        control: Control::Select {
            default: "#d98a3f",
            options: ACCENTS,
        },
        applies: Applies::Now,
    },
    Setting {
        key: "appearance.interfaceFontFamily",
        title: "Interface font",
        description: "Tabs, menus, labels. The bundled fallbacks stay behind whatever you name, \
                      so a font this machine does not have degrades rather than breaks.",
        control: Control::Text {
            default: "IBM Plex Sans",
            placeholder: "IBM Plex Sans",
        },
        applies: Applies::Now,
    },
    Setting {
        key: "appearance.monoFontFamily",
        title: "Monospace font",
        description: "Paths, diffs and anything the interface draws in a fixed pitch. Not the \
                      editor — that has its own, under Editor.",
        control: Control::Text {
            default: "IBM Plex Mono",
            placeholder: "IBM Plex Mono",
        },
        applies: Applies::Now,
    },
];

static APPEARANCE: Group = Group {
    id: "appearance",
    title: "Appearance",
    description: "How the interface is drawn.",
    order: 0,
    settings: APPEARANCE_SETTINGS,
};

// --- editor -----------------------------------------------------------------
//
// Read by the File Viewer and the File Explorer's preview through
// `settings/all` on the bridge, and handed to Monaco when an editor is
// created. Every one of them is `Next`: Monaco takes its options at
// construction, and a frame that is already mounted keeps the ones it was built
// with until it is reopened.

static LINE_NUMBERS: &[SelectOption] = &[
    SelectOption {
        value: "on",
        label: "On",
        description: "",
    },
    SelectOption {
        value: "off",
        label: "Off",
        description: "",
    },
    SelectOption {
        value: "relative",
        label: "Relative",
        description: "Distance from the cursor, which is what a vim-style motion counts.",
    },
];

static WHITESPACE: &[SelectOption] = &[
    SelectOption {
        value: "none",
        label: "Never",
        description: "",
    },
    SelectOption {
        value: "boundary",
        label: "Except between words",
        description: "Leading, trailing and runs — the ones that are usually a mistake.",
    },
    SelectOption {
        value: "all",
        label: "Always",
        description: "",
    },
];

static EDITOR_SETTINGS: &[Setting] = &[
    Setting {
        key: "editor.fontSize",
        title: "Font size",
        description: "",
        control: Control::Number {
            default: 13,
            min: 8,
            max: 32,
            step: 1,
            unit: "px",
        },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.fontFamily",
        title: "Font",
        description: "",
        control: Control::Text {
            default: "IBM Plex Mono",
            placeholder: "IBM Plex Mono",
        },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.tabSize",
        title: "Tab width",
        description: "How many columns a tab character occupies.",
        control: Control::Number {
            default: 2,
            min: 1,
            max: 8,
            step: 1,
            unit: "columns",
        },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.wordWrap",
        title: "Wrap long lines",
        description: "",
        control: Control::Toggle { default: false },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.minimap",
        title: "Show the minimap",
        description: "The scaled-down overview down the right-hand edge.",
        control: Control::Toggle { default: false },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.lineNumbers",
        title: "Line numbers",
        description: "",
        control: Control::Select {
            default: "on",
            options: LINE_NUMBERS,
        },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
    Setting {
        key: "editor.renderWhitespace",
        title: "Show whitespace",
        description: "",
        control: Control::Select {
            default: "none",
            options: WHITESPACE,
        },
        applies: Applies::Next {
            what: "the next editor you open",
        },
    },
];

static EDITOR: Group = Group {
    id: "editor",
    title: "Editor",
    description: "How files are drawn where they are edited — the File Viewer, and previews.",
    order: 20,
    settings: EDITOR_SETTINGS,
};

// --- terminal ---------------------------------------------------------------

static SHELLS: &[SelectOption] = &[
    SelectOption {
        value: "auto",
        label: "Whatever this machine has",
        description: "PowerShell 7 if it is installed, then Windows PowerShell, then cmd.",
    },
    SelectOption {
        value: "pwsh",
        label: "PowerShell 7",
        description: "",
    },
    SelectOption {
        value: "powershell",
        label: "Windows PowerShell",
        description: "",
    },
    SelectOption {
        value: "cmd",
        label: "Command Prompt",
        description: "",
    },
    SelectOption {
        value: "bash",
        label: "bash",
        description: "",
    },
    SelectOption {
        value: "zsh",
        label: "zsh",
        description: "",
    },
];

static TERMINAL_SETTINGS: &[Setting] = &[
    Setting {
        key: keys::TERMINAL_DEFAULT_SHELL,
        title: "Shell",
        description: "What a new terminal runs. A shell this machine does not have falls back to \
                      the automatic order rather than opening a terminal that dies immediately.",
        control: Control::Select {
            default: "auto",
            options: SHELLS,
        },
        applies: Applies::Next {
            what: "the next terminal you open",
        },
    },
    Setting {
        key: keys::TERMINAL_OPEN_ON_LAUNCH,
        title: "Open a terminal at launch",
        description: "Only on a launch with no session to restore. A restored session brings its \
                      own terminals back, and this has never added one on top of them.",
        control: Control::Toggle { default: true },
        // The one setting in this build that genuinely means it. It is read in
        // `lib.rs`'s setup, once, at the only moment a launch terminal could be
        // opened — there is no later point at which switching it on could do
        // anything, and saying "applies now" would be a lie the screen tells.
        applies: Applies::Restart,
    },
];

static TERMINAL: Group = Group {
    id: "terminal",
    title: "Terminal",
    description: "The shells HELVE spawns, in the panel and in panes.",
    order: 30,
    settings: TERMINAL_SETTINGS,
};

// --- search -----------------------------------------------------------------
//
// The three caps `search.rs` used to hold as constants. They are settings
// because the right answer depends on the repository: a cap that keeps search
// responsive in a monorepo truncates a small project's honest result set, and
// the response says `truncated` either way with no way for the person reading
// it to do anything about it.

static SEARCH_SETTINGS: &[Setting] = &[
    Setting {
        key: keys::SEARCH_MAX_MATCHES,
        title: "Match limit",
        description: "How many matches one search collects before it stops and reports that it \
                      was truncated.",
        control: Control::Number {
            default: 1000,
            min: 50,
            max: 20_000,
            step: 50,
            unit: "matches",
        },
        applies: Applies::Next {
            what: "the next search",
        },
    },
    Setting {
        key: keys::SEARCH_MAX_FILES,
        title: "File limit",
        description: "How many distinct files one search reports. Separate from the match limit \
                      because one file with a thousand hits and a thousand files with one each \
                      are different kinds of too many.",
        control: Control::Number {
            default: 500,
            min: 20,
            max: 5000,
            step: 20,
            unit: "files",
        },
        applies: Applies::Next {
            what: "the next search",
        },
    },
    Setting {
        key: keys::SEARCH_MAX_FILE_SIZE_MB,
        title: "Skip files larger than",
        description: "A file above this is not opened. Minified bundles and checked-in binaries \
                      are what this exists for.",
        control: Control::Number {
            default: 8,
            min: 1,
            max: 256,
            step: 1,
            unit: "MB",
        },
        applies: Applies::Next {
            what: "the next search",
        },
    },
];

static SEARCH: Group = Group {
    id: "search",
    title: "Search",
    description: "What a project-wide search will and will not read.",
    order: 40,
    settings: SEARCH_SETTINGS,
};

// --- MCP --------------------------------------------------------------------
//
// The section with the servers in it. Those are not settings — they are a list
// the registry owns, with a switch on each row — so they are drawn by a panel
// of their own above these, and `docs/settings.md` describes that escape hatch
// and why this is the only section using it.

static MCP_SETTINGS: &[Setting] = &[Setting {
    key: keys::MCP_WRITE_PROJECT_CONFIG,
    title: "Write .mcp.json into open projects",
    description: "How an agent finds these servers. The file names environment variables rather \
                  than a port or a token, so it holds no secret and is safe to commit. Switching \
                  this off leaves the servers running and unreachable — connect to them by hand.",
    control: Control::Toggle { default: true },
    applies: Applies::Now,
}];

static MCP: Group = Group {
    id: "mcp",
    title: "MCP servers",
    description: "What HELVE offers the coding agents running in its terminals.",
    order: 60,
    settings: MCP_SETTINGS,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Registry;
    use serde_json::json;

    fn seeded() -> Registry {
        let registry = Registry::default();
        for group in groups() {
            registry.register(group);
        }
        for group in crate::apps::settings_groups() {
            registry.register(group);
        }
        registry
    }

    /// Two groups claiming one id would mean the second is silently dropped by
    /// `Registry::register`, and the settings it declares would simply not
    /// appear. An app is the likely offender: it registers late and against a
    /// list it cannot see.
    #[test]
    fn every_group_id_is_unique() {
        let registry = seeded();
        let mut ids: Vec<&str> = registry.snapshot().groups.iter().map(|g| g.id).collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(total, ids.len(), "two groups share an id");
    }

    /// The prefix rule from `Group::id`. It is what makes a key readable on its
    /// own, and what stops two apps colliding on `fontSize`.
    #[test]
    fn every_key_is_prefixed_by_its_group() {
        for group in seeded().snapshot().groups {
            for setting in group.settings {
                assert!(
                    setting.key.starts_with(&format!("{}.", group.id)),
                    "{:?} is in group {:?} but is not prefixed by it",
                    setting.key,
                    group.id
                );
            }
        }
    }

    /// No two settings anywhere may share a key. `Registry::find` takes the
    /// first match, so a collision means one of the two rows writes to the
    /// other's value and neither author would see it.
    #[test]
    fn every_key_is_unique_across_every_group() {
        let registry = seeded();
        let mut keys: Vec<&str> = registry
            .snapshot()
            .groups
            .iter()
            .flat_map(|g| g.settings.iter().map(|s| s.key))
            .collect();
        let total = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(total, keys.len(), "two settings share a key");
    }

    /// The point of the `keys` module: a constant that no longer names a
    /// setting, or names one of a different type, would make its reader fall
    /// back to a zero value with nothing on screen to say so.
    #[test]
    fn every_exported_key_resolves_to_a_setting_of_the_type_its_reader_expects() {
        let registry = seeded();

        for (key, expected) in [
            (keys::TERMINAL_DEFAULT_SHELL, "string"),
            (keys::TERMINAL_OPEN_ON_LAUNCH, "bool"),
            (keys::SEARCH_MAX_MATCHES, "number"),
            (keys::SEARCH_MAX_FILES, "number"),
            (keys::SEARCH_MAX_FILE_SIZE_MB, "number"),
            (keys::MCP_WRITE_PROJECT_CONFIG, "bool"),
        ] {
            let value = registry
                .get(key)
                .unwrap_or_else(|| panic!("{key} is not declared by any group"));
            let actual = match value {
                serde_json::Value::Bool(_) => "bool",
                serde_json::Value::Number(_) => "number",
                serde_json::Value::String(_) => "string",
                other => panic!("{key} defaults to {other}, which no reader handles"),
            };
            assert_eq!(actual, expected, "{key} is read as a {expected}");
        }
    }

    /// A default outside its own control's range would be unreachable: the
    /// screen would draw a clamped value, and setting it back would not clear
    /// the stored entry, so the row would look permanently modified.
    #[test]
    fn every_default_is_a_value_its_own_control_accepts() {
        let registry = seeded();
        for group in registry.snapshot().groups {
            for setting in group.settings {
                let default = registry.get(setting.key).expect("declared");
                assert_eq!(
                    registry.set(setting.key, default.clone()),
                    Ok(default),
                    "{}'s default is not one its control accepts unchanged",
                    setting.key
                );
                assert!(
                    registry.changed().is_empty(),
                    "{} stored its own default rather than clearing it",
                    setting.key
                );
            }
        }
    }

    /// A description that starts with the title reads as a stutter on screen,
    /// where the two are drawn one under the other. Empty is allowed — a title
    /// that says everything needs no second line.
    #[test]
    fn no_description_repeats_its_own_title() {
        for group in seeded().snapshot().groups {
            for setting in group.settings {
                assert!(
                    !setting.description.starts_with(setting.title),
                    "{}'s description restates its title",
                    setting.key
                );
            }
        }
    }

    #[test]
    fn the_mcp_toggle_governs_whether_the_project_file_is_written() {
        let registry = seeded();
        assert_eq!(
            registry.get(keys::MCP_WRITE_PROJECT_CONFIG),
            Some(json!(true)),
            "discovery is on by default, or nothing finds the servers"
        );
    }
}
