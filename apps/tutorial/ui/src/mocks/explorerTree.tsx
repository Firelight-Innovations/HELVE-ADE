/** The File Explorer tree, with git status colouring a couple of rows — see
 *  `apps/files/ui/src/explorer/Explorer.tsx` and `GIT_KIND_TOKEN` for the
 *  tones a change letter takes. */
import { Col, MockTreeRow, MockWindow } from "./chrome";

export default function ExplorerTree() {
  return (
    <MockWindow title="Anvil">
      <Col gap="xs">
        <span className="tut__mock-field">Filter</span>
        {/* `src/` and `assets/` carry the same tone as the change inside them —
            `decorate`'s rule 2 in `gitStatus.ts`: a directory with no change of
            its own but one somewhere below it is tinted with no letter, because
            the folder itself was not edited. Only the file git actually named
            gets a badge, which this primitive has no slot for — see the report. */}
        <MockTreeRow depth={0} label="src/" tone="warn" />
        <MockTreeRow depth={1} label="main.rs" tone="warn" selected />
        <MockTreeRow depth={1} label="lib.rs" />
        <MockTreeRow depth={0} label="assets/" tone="ok" />
        <MockTreeRow depth={1} label="icon.png" tone="ok" />
        <MockTreeRow depth={0} label="README.md" />
      </Col>
    </MockWindow>
  );
}
