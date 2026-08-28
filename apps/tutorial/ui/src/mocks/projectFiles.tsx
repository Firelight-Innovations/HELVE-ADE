/** What "set up as an OpenKaava project" writes: exactly two new entries beside
 *  whatever the folder already had — see `firstProject.ts`. */
import { MockTreeRow, MockWindow } from "./chrome";

export default function ProjectFiles() {
  return (
    <MockWindow title="Anvil/">
      <MockTreeRow depth={0} label="Anvil.kaava" tone="accent" />
      <MockTreeRow depth={0} label=".kaava/" tone="accent" />
      <MockTreeRow depth={0} label="src/" />
      <MockTreeRow depth={0} label="assets/" />
      <MockTreeRow depth={0} label="README.md" />
    </MockWindow>
  );
}
