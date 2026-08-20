import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import type { PersistedFileTreeDockV1 } from "#product/lib/domain/files/file-tree-dock-state";

/**
 * Raw, outcome-bearing storage access for the docked file tree.
 *
 * The shared `readPersistedJson` / `writePersistedJson` / `removePersistedKey`
 * helpers intentionally capture and swallow failures and the latter two return
 * `Promise<void>`, so they cannot prove the ordering the dock's migration
 * requires (new-key read before legacy read, new-record write before legacy-key
 * removal, bounded retries). This adapter therefore performs exactly one
 * requested storage operation per call and reports its outcome.
 *
 * It deliberately owns no required-read or revision state, branching/migration
 * or retry policy, authority registry, diagnostic sink, attachment token, UI
 * commit target, or authority switching — the workspace file-tree lifecycle
 * coordinator owns all of that. A `failed` outcome carries the raw error so the
 * caller's bounded diagnostic sink can classify it; the caller must never attach
 * payloads, key contents, paths, or workspace identifiers to diagnostics.
 */
export type FileTreeDockReadOutcome =
  /** The key was present; `raw` is its decoded JSON, or `undefined` if malformed. */
  | { status: "settled"; raw: unknown }
  /** The key is positively absent. */
  | { status: "missing" }
  /** The read itself failed; absence must not be inferred. */
  | { status: "failed"; error: unknown };

export type FileTreeDockMutationOutcome =
  | { status: "succeeded" }
  | { status: "failed"; error: unknown };

export async function readFileTreeDockRecord(
  storage: ProductStorage,
  key: string,
): Promise<FileTreeDockReadOutcome> {
  let stored: string | null;
  try {
    stored = await storage.getItem(key);
  } catch (error) {
    return { status: "failed", error };
  }
  if (stored === null) {
    return { status: "missing" };
  }
  try {
    return { status: "settled", raw: JSON.parse(stored) as unknown };
  } catch {
    // Present but malformed: a corrupt record still wins over the legacy key,
    // so this is a settled undecodable value rather than absence or failure.
    return { status: "settled", raw: undefined };
  }
}

export async function writeFileTreeDockRecord(
  storage: ProductStorage,
  key: string,
  record: PersistedFileTreeDockV1,
): Promise<FileTreeDockMutationOutcome> {
  try {
    await storage.setItem(key, JSON.stringify(record));
    return { status: "succeeded" };
  } catch (error) {
    return { status: "failed", error };
  }
}

export async function removeFileTreeDockKey(
  storage: ProductStorage,
  key: string,
): Promise<FileTreeDockMutationOutcome> {
  try {
    await storage.removeItem(key);
    return { status: "succeeded" };
  } catch (error) {
    return { status: "failed", error };
  }
}
