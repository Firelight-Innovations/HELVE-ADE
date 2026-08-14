/**
 * Every call this app makes to its host, in one file.
 *
 * The shapes below mirror `src-tauri/src/apps/files.rs` and are *restated* here
 * rather than imported from the shell's source. That is not duplication for its
 * own sake: an app knows its host only through `@helve/bridge`, and the day this
 * one is extracted into a tool repository of its own, nothing in `apps/files/`
 * may be reaching into `src/`. The restatement is what makes that true, and
 * `pnpm build` is not what catches a drift between the two — a Rust test is.
 *
 * Wrapping `invoke` also means the method-name strings appear exactly once.
 * Nothing outside this module spells `"files/read-bytes"`.
 */
import { HelveRpcError, invoke } from "@helve/bridge";

// --- what the backend returns -------------------------------------------------

/** `"other"` is a pipe, a socket, a device node, or a broken symlink. */
export type EntryKind = "dir" | "file" | "other";

export interface Entry {
  name: string;
  path: string;
  kind: EntryKind;
  /** `null` for anything that is not a file — a directory has no one size. */
  size: number | null;
  /** Milliseconds since the Unix epoch, or `null` when the entry could not be
   *  stat'd. Used to notice a file changing under an open tab. */
  mtime: number | null;
}

export interface Listing {
  path: string;
  /** `null` at a drive root — there is no "up" from there. */
  parent: string | null;
  entries: Entry[];
}

export interface Root {
  path: string;
  /** The folder's last component, for the explorer header. */
  name: string;
}

export interface Stat {
  path: string;
  name: string;
  kind: EntryKind;
  size: number | null;
  mtime: number | null;
  /** `false` rather than an error, so polling for external changes can tell
   *  "deleted" apart from "the call failed". */
  exists: boolean;
}

export interface FileText {
  path: string;
  text: string;
  /** The file was longer than `limit`; this is its first part. */
  truncated: boolean;
  /** Bytes the backend is willing to return. The frontend formats it; the
   *  number lives in Rust so the two cannot drift. */
  limit: number;
  mtime: number | null;
}

export interface FileBytes {
  path: string;
  /** Standard base64, no data-URI prefix. See `toBytes`. */
  base64: string;
  /** The decoded length, so a caller can size a buffer without decoding. */
  size: number;
  mtime: number | null;
}

export interface WriteResult {
  path: string;
  /** The mtime the file now has. Becomes the next write's `baseMtime`. */
  mtime: number | null;
}

// --- the calls ----------------------------------------------------------------

/** Where the tree roots: the open project, else the manifest's directory. */
export const getRoot = () => invoke<Root>("files/root");

/** One directory's immediate children, sorted directories-first by name. */
export const list = (path: string | null) => invoke<Listing>("files/list", { path });

/** One entry as it is *right now* — the external-change poll. */
export const stat = (path: string) => invoke<Stat>("files/stat", { path });

/** One text file, up to the backend's cap. Rejects non-UTF-8; see `isNotText`. */
export const readText = (path: string) => invoke<FileText>("files/read", { path });

/** One file's raw bytes, base64'd. Rejects rather than truncating. */
export const readBytes = (path: string) => invoke<FileBytes>("files/read-bytes", { path });

/**
 * Overwrite a file, refusing if it changed since `baseMtime`.
 *
 * `baseMtime` is the mtime that came back with the read this text was edited
 * from — pass it through unchanged. A `null` means "the file had no readable
 * mtime", and the backend treats that as "write anyway", because refusing a
 * save on a filesystem that cannot report times would make the app unusable
 * there rather than safer.
 */
export const write = (path: string, text: string, baseMtime: number | null) =>
  invoke<WriteResult>("files/write", { path, text, baseMtime });

/** Select the item in the OS file manager. */
export const reveal = (path: string) => invoke<null>("files/reveal", { path });

/** Hand the file to whatever the OS opens it with. */
export const openExternal = (path: string) => invoke<null>("files/open-external", { path });

// --- reading the errors -------------------------------------------------------

/**
 * A `files/write` that lost a race, and the mtime it lost to.
 *
 * The backend refuses with `INVALID_PARAMS` and a `data` payload rather than a
 * new error code, so this is the only place that knows the payload's shape.
 * Returns `null` for every other failure, including a write that failed for a
 * reason the user cannot resolve by reloading.
 */
export function staleWrite(err: unknown): { mtime: number | null } | null {
  if (!(err instanceof HelveRpcError)) return null;
  const data = err.data as { kind?: unknown; mtime?: unknown } | undefined;
  if (!data || data.kind !== "stale") return null;
  return { mtime: typeof data.mtime === "number" ? data.mtime : null };
}

/**
 * Whether a `files/read` failed because the file is not UTF-8 text.
 *
 * This is what lets the text viewer be the *fallback* for unknown extensions
 * rather than a list of them: "is this text" is not knowable from a name, so
 * the app tries, and hands off to the unsupported viewer on this one error.
 *
 * Matched on the message because the backend answers `INVALID_PARAMS` here as
 * it does for several other things, and a dedicated code would be a protocol
 * change for one caller. If this ever needs to be reliable rather than merely
 * right, it becomes a `data.kind` like `staleWrite` above.
 */
export function isNotText(err: unknown): boolean {
  return err instanceof HelveRpcError && err.message.includes("not a UTF-8 text file");
}

/** The failing method, plus whatever the host said about why. */
export function describe(method: string, err: unknown): string {
  if (err instanceof HelveRpcError) return `${method} — [${err.code}] ${err.message}`;
  return `${method} — ${String(err)}`;
}

// --- helpers ------------------------------------------------------------------

/**
 * Base64 back to bytes.
 *
 * `atob` gives a binary string — one character per byte — which is the only
 * decoder available without pulling in a dependency, and is fast enough for the
 * 32 MiB the backend will hand over. Callers that pass the result to something
 * which *transfers* the buffer (pdf.js does) must copy first; see `PdfViewer`.
 */
export function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Bytes as a person reads them. Binary units, since these are file sizes. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10, none above — enough to tell 1.2 MiB from 1.9 MiB
  // without printing a precision the number doesn't carry.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A path's last component, with the separator guessed from the path itself.
 *
 * Both separators are checked because a Windows path can contain either and the
 * backend returns whatever `Display` produced. Nothing here parses paths beyond
 * this — the backend owns path semantics, and a frontend that started joining
 * them would be the second implementation of a thing that is already hard.
 */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The extension, lowercased, without the dot. `""` when there is none.
 *
 * A leading dot does not start an extension: `.gitignore` is a *name*, not an
 * extension-less file called "" of type "gitignore". The icon resolver and the
 * viewer registry both depend on that.
 */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}
