/**
 * Identifier minting. PRD §3.1 makes a node's identity a UUIDv7 and PRD §12.3
 * requires that a duplicate "mint a new UUIDv7 and append a suffix to the
 * slug" — a copy is a new thing, never the same thing twice.
 *
 * UUIDv7 rather than v4 because the first 48 bits are the mint time, so a
 * directory of `nodes/<uuid>.json` sorts chronologically without a stored
 * timestamp, which is the reason PRD §3.1 chose it.
 */

/** 48-bit millisecond timestamp, then version 7, then randomness (RFC 9562
 *  §5.7). Layout: `unix_ts_ms` 48 | `ver` 4 | `rand_a` 12 | `var` 2 |
 *  `rand_b` 62. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = Math.max(0, Math.floor(now));

  for (let i = 0; i < 6; i += 1) {
    // Big-endian: byte 0 is the most significant of the 48-bit timestamp.
    bytes[i] = Math.floor(timestamp / 2 ** (8 * (5 - i))) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** `crypto.getRandomValues` where the host has it — every browser and every
 *  Node this repository builds against does. The arithmetic fallback keeps a
 *  bare runtime working rather than throwing inside a duplicate. */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const source = globalThis.crypto;
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Shape and version check, used by the duplicate test to prove a minted id
 *  is neither the original nor a v4. */
export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

/**
 * The suffix PRD §12.3 requires on a duplicate's slug. No wireframe draws one,
 * so the form is this engine's own [P]: `-copy`, then `-copy-2`, `-copy-3`,
 * counting until the result is unused. Slugs are unique within a parent
 * (PRD §3.2), so `taken` is the sibling set, not the whole graph.
 */
export function duplicateSlug(slug: string, taken: ReadonlySet<string>): string {
  const first = `${slug}-copy`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = `${slug}-copy-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
