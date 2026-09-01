/**
 * The fixtures below are the shape of the real files, cut to the lines the
 * check reads. Real ones would make the tests pass for the wrong reason: the
 * whole point of this check is to notice a surface that has *drifted*, and a
 * fixture read off disk can never be in that state.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_SUFFIX,
  IDENTITY,
  SUPERSEDED_PRODUCTS,
  agentIdentifier,
  jsList,
  problems,
  renameShellKeys,
  rustConst,
  rustList,
  shellKeyStems,
  supersede,
} from "./check-identity.mjs";

const IDENTITY_RS = `
pub const IDENTIFIER: &str = "com.example.thing";
pub const SUPERSEDED: &[&str] = &["com.example.old"];
`;

/** What the pinned product-name list looks like inside this script's own text. */
const SELF = 'export const SUPERSEDED_PRODUCTS = ["Old"];';

const OLD_PRODUCTS = ["Old"];

const NSH = `
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\\Classes\\Directory\\shell\\OpenWithThing" "" "Open with Thing"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\\Classes\\Directory\\shell\\OpenWithThing"
  DeleteRegKey HKCU "Software\\Classes\\Directory\\shell\\OpenWithOld"
!macroend
`;

const PINNED = { identifier: "com.example.thing", productName: "Thing" };

/** Every surface agreeing, as the object `problems` takes. */
function agreeing(overrides = {}) {
  return {
    "src-tauri/tauri.conf.json": JSON.stringify({
      identifier: "com.example.thing",
      productName: "Thing",
    }),
    "src-tauri/src/userdata/identity.rs": IDENTITY_RS,
    "src-tauri/src/plugins/install.rs": 'pub const KEYRING_SERVICE: &str = "com.example.thing";',
    "package.json": JSON.stringify({
      scripts: {
        "ui:build": 'tauri build --config {\\"identifier\\":\\"com.example.thing.agent\\"}',
      },
    }),
    "src-tauri/installer-hooks.nsh": NSH,
    ...overrides,
  };
}

describe("rustConst and rustList", () => {
  it("reads a pinned string and a pinned list", () => {
    expect(rustConst(IDENTITY_RS, "IDENTIFIER")).toBe("com.example.thing");
    expect(rustList(IDENTITY_RS, "SUPERSEDED")).toEqual(["com.example.old"]);
    expect(rustList("pub const SUPERSEDED: &[&str] = &[];", "SUPERSEDED")).toEqual([]);
  });

  it("returns null rather than guessing when the constant is gone", () => {
    expect(rustConst("", "IDENTIFIER")).toBeNull();
    expect(rustList("", "SUPERSEDED")).toBeNull();
  });
});

describe("agentIdentifier", () => {
  it("finds the override through both layers of escaping", () => {
    const pkg = {
      scripts: { "ui:build": 'tauri build --config {\\"identifier\\":\\"com.a.b.agent\\"}' },
    };
    expect(agentIdentifier(pkg)).toBe("com.a.b.agent");
  });

  it("is null when ui:build overrides nothing", () => {
    expect(agentIdentifier({ scripts: { "ui:build": "tauri build" } })).toBeNull();
    expect(agentIdentifier({})).toBeNull();
  });
});

describe("problems", () => {
  it("says nothing when every surface agrees", () => {
    expect(problems(agreeing(), PINNED, OLD_PRODUCTS)).toEqual([]);
  });

  it("rejects an identifier that does not match the pinned identity", () => {
    const drifted = agreeing({
      "src-tauri/tauri.conf.json": JSON.stringify({
        identifier: "com.example.renamed",
        productName: "Thing",
      }),
    });
    const found = problems(drifted, PINNED, OLD_PRODUCTS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/identifier is "com.example.renamed"/);
    expect(found[0]).toMatch(/single-instance mutex/);
  });

  /**
   * The rename that prompted all of this changed both, and a check that caught
   * only the identifier would have reported half of it — the config directory
   * moving, and not the second install directory beside the first.
   */
  it("rejects a product name that does not match, separately from the identifier", () => {
    const drifted = agreeing({
      "src-tauri/tauri.conf.json": JSON.stringify({
        identifier: "com.example.thing",
        productName: "Renamed",
      }),
    });
    const found = problems(drifted, PINNED, OLD_PRODUCTS);
    expect(found.some((p) => /productName is "Renamed"/.test(p))).toBe(true);
    expect(found.some((p) => /Add\/Remove Programs key/.test(p))).toBe(true);
  });

  it("rejects a keyring service that drifted away from the identifier", () => {
    const drifted = agreeing({
      "src-tauri/src/plugins/install.rs": 'const KEYRING_SERVICE: &str = "com.example.old";',
    });
    expect(problems(drifted, PINNED, OLD_PRODUCTS).some((p) => /KEYRING_SERVICE/.test(p))).toBe(
      true,
    );
  });

  it("accepts the agent suffix on ui:build, and only that suffix", () => {
    expect(problems(agreeing(), PINNED, OLD_PRODUCTS)).toEqual([]);

    const bare = agreeing({
      "package.json": JSON.stringify({
        scripts: { "ui:build": 'tauri build --config {\\"identifier\\":\\"com.example.thing\\"}' },
      }),
    });
    const found = problems(bare, PINNED, OLD_PRODUCTS);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/share a config directory/);
  });

  it("rejects an identity that is also in the superseded list", () => {
    const selfSuperseding = agreeing({
      "src-tauri/src/userdata/identity.rs": IDENTITY_RS.replace(
        '&["com.example.old"]',
        '&["com.example.thing"]',
      ),
    });
    const found = problems(selfSuperseding, PINNED, OLD_PRODUCTS);
    expect(found.some((p) => /cannot supersede itself/.test(p))).toBe(true);
  });

  /**
   * The uninstall macro is the only thing that ever removes these keys, so a
   * superseded name missing from it is a menu entry nothing will ever clean up.
   */
  it("rejects an uninstall macro that forgets a superseded key", () => {
    const forgetful = agreeing({
      "src-tauri/installer-hooks.nsh": NSH.replace(
        '  DeleteRegKey HKCU "Software\\Classes\\Directory\\shell\\OpenWithOld"\n',
        "",
      ),
    });
    const found = problems(forgetful, PINNED, OLD_PRODUCTS);
    expect(found.some((p) => /does not delete OpenWithOld/.test(p))).toBe(true);
  });

  it("rejects an install macro writing a key stem the identity does not name", () => {
    const stale = agreeing({
      "src-tauri/installer-hooks.nsh": NSH.replaceAll("OpenWithThing", "OpenWithOld"),
    });
    expect(problems(stale, PINNED, OLD_PRODUCTS).some((p) => /writes OpenWithOld/.test(p))).toBe(
      true,
    );
  });
});

describe("shellKeyStems", () => {
  it("splits the stems by which macro they are in", () => {
    expect(shellKeyStems(NSH)).toEqual({ install: ["Thing"], uninstall: ["Thing", "Old"] });
  });
});

describe("renameShellKeys", () => {
  it("points the install macro at the new stem and keeps deleting the old one", () => {
    const next = renameShellKeys(NSH, "Thing", "Newer");
    const stems = shellKeyStems(next);
    expect(stems.install).toEqual(["Newer"]);
    expect(stems.uninstall).toContain("Newer");
    expect(stems.uninstall).toContain("Thing");
    expect(stems.uninstall).toContain("Old");
  });

  it("does not accumulate duplicate deletions when adopted twice", () => {
    const once = renameShellKeys(NSH, "Thing", "Newer");
    const twice = renameShellKeys(once, "Newer", "Newest");
    const lines = twice.split("\n").filter((l) => l.includes("OpenWithNewer"));
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("is a no-op when the name did not move", () => {
    expect(renameShellKeys(NSH, "Thing", "Thing")).toBe(NSH);
  });
});

describe("supersede", () => {
  it("prepends what was replaced, newest first", () => {
    const rs = supersede(IDENTITY_RS, "SUPERSEDED", "com.example.older");
    expect(rustList(rs, "SUPERSEDED")).toEqual(["com.example.older", "com.example.old"]);
  });

  /**
   * Two list syntaxes, because the identifier's list is Rust and the product
   * name's is this script's own JavaScript. One function writes both, so a
   * rename cannot record half of itself.
   */
  it("writes a JavaScript list as well as a Rust one", () => {
    const js = supersede(SELF, "SUPERSEDED_PRODUCTS", "Older");
    expect(jsList(js, "SUPERSEDED_PRODUCTS")).toEqual(["Older", "Old"]);
  });

  it("does not record a value that is already there", () => {
    expect(supersede(IDENTITY_RS, "SUPERSEDED", "com.example.old")).toBe(IDENTITY_RS);
    expect(supersede(SELF, "SUPERSEDED_PRODUCTS", "Old")).toBe(SELF);
  });

  it("leaves text alone when the list it was pointed at is not there", () => {
    expect(supersede("nothing here", "SUPERSEDED", "com.example.old")).toBe("nothing here");
  });
});

describe("the identity this repository ships", () => {
  /**
   * A guard on the constant itself. `--adopt` rewrites five files off these
   * two strings, and a typo in either would be applied everywhere before
   * anybody read the diff.
   */
  it("is a reverse-DNS identifier and a bare product name", () => {
    expect(IDENTITY.identifier).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
    expect(IDENTITY.productName).toMatch(/^[A-Za-z0-9]+$/);
    expect(AGENT_SUFFIX.startsWith(".")).toBe(true);
  });

  it("does not list its own product name as superseded", () => {
    expect(SUPERSEDED_PRODUCTS).not.toContain(IDENTITY.productName);
  });
});
