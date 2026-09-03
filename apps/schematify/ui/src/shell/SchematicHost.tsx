/**
 * The Schematic host — an empty frame this wave. PRD §17 Wave 3 builds the
 * pan/zoom/select engine inside it; this wave only stakes out the space it
 * lives in, at the grid density the Service Schematic uses (PRD §13.5,
 * `--kv-grid-size`).
 */
export function SchematicHost() {
  return (
    <div className="kv-schematic-host">
      <p className="kv-schematic-host__note">Schematic engine — Wave 3.</p>
    </div>
  );
}
