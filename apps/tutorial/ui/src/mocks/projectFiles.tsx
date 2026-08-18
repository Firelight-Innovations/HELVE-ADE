/** What "set up as a HELVE project" writes: exactly two new entries beside
 *  whatever the folder already had — see `firstProject.ts`. */
import { MockTreeRow, MockWindow } from "./chrome";

export default function ProjectFiles() {
  return (
    <MockWindow title="Anvil/">
      <MockTreeRow depth={0} label="Anvil.helve" tone="accent" />
      <MockTreeRow depth={0} label=".helve/" tone="accent" />
      <MockTreeRow depth={0} label="src/" />
      <MockTreeRow depth={0} label="assets/" />
      <MockTreeRow depth={0} label="README.md" />
    </MockWindow>
  );
}
