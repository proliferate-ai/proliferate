import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import { hasOwnKey } from "#product/lib/domain/files/file-tree-dock-state";
import {
  selectFileTreeDurableSnapshot,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import type { FileTreeDockAttachment } from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-coordinator";

/**
 * Deferred-operation fixtures for the file-tree dock persistence tests. This
 * seam exists only to keep the coordinator and its main test below the
 * max-lines ratchet: it moves test setup, never behavior.
 */
export type StorageOperationKind = "get" | "set" | "remove";

export interface PendingStorageOperation {
  kind: StorageOperationKind;
  key: string;
  value?: string;
  succeed: () => void;
  fail: (error?: unknown) => void;
}

export interface FileTreeDockStorageHarness {
  storage: ProductStorage;
  values: Map<string, string>;
  calls: { kind: StorageOperationKind; key: string }[];
  pending: PendingStorageOperation[];
  /** When true, every operation parks in `pending` until the test settles it. */
  manual: boolean;
  seed: (key: string, value: unknown) => void;
  readJson: <T>(key: string) => T | undefined;
  /** Fail the next `times` operations of this kind on this key. */
  failNext: (kind: StorageOperationKind, key: string, times?: number) => void;
  callCount: (kind: StorageOperationKind, key: string) => number;
  settleNext: (outcome?: "succeed" | "fail") => void;
}

export function createFileTreeDockStorageHarness(): FileTreeDockStorageHarness {
  const values = new Map<string, string>();
  const calls: { kind: StorageOperationKind; key: string }[] = [];
  const pending: PendingStorageOperation[] = [];
  const failures = new Map<string, number>();

  const harness: FileTreeDockStorageHarness = {
    values,
    calls,
    pending,
    manual: false,
    storage: {
      getItem: (key) => run("get", key, () => values.get(key) ?? null),
      setItem: (key, value) =>
        run("set", key, () => {
          values.set(key, value);
        }, value),
      removeItem: (key) =>
        run("remove", key, () => {
          values.delete(key);
        }),
    },
    seed: (key, value) => {
      values.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    readJson: <T,>(key: string) => {
      const raw = values.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },
    failNext: (kind, key, times = 1) => {
      failures.set(`${kind}:${key}`, times);
    },
    callCount: (kind, key) =>
      calls.filter((call) => call.kind === kind && call.key === key).length,
    settleNext: (outcome = "succeed") => {
      const operation = pending.shift();
      if (!operation) {
        throw new Error("no pending storage operation");
      }
      if (outcome === "succeed") {
        operation.succeed();
      } else {
        operation.fail();
      }
    },
  };

  function run<T>(
    kind: StorageOperationKind,
    key: string,
    apply: () => T,
    value?: string,
  ): Promise<T> {
    calls.push({ kind, key });
    const failureKey = `${kind}:${key}`;
    const remaining = failures.get(failureKey) ?? 0;
    const shouldFail = remaining > 0;
    if (shouldFail) {
      failures.set(failureKey, remaining - 1);
    }
    if (!harness.manual) {
      return shouldFail
        ? Promise.reject(new Error(`${kind} failed`))
        : Promise.resolve(apply());
    }
    return new Promise<T>((resolve, reject) => {
      pending.push({
        kind,
        key,
        value,
        succeed: () => resolve(apply()),
        fail: (error) => reject(error ?? new Error(`${kind} failed`)),
      });
    });
  }

  return harness;
}

/**
 * Mirror the production lifecycle relay: apply a synchronous store mutation and
 * hand the coordinator the new revision plus the affected field category.
 */
export function mutateAndRelay(
  attachment: FileTreeDockAttachment,
  mutate: () => void,
): void {
  const before = selectFileTreeDurableSnapshot(useFileTreeStore.getState());
  const beforeRevision = useFileTreeStore.getState().durableRevision;
  mutate();
  const state = useFileTreeStore.getState();
  if (state.durableRevision === beforeRevision) {
    return;
  }
  const snapshot = selectFileTreeDurableSnapshot(state);
  const keys = new Set([
    ...Object.keys(before.requestedVisibilityByWorkspace),
    ...Object.keys(snapshot.requestedVisibilityByWorkspace),
  ]);
  attachment.noteDurableMutation({
    revision: state.durableRevision,
    snapshot,
    widthChanged: snapshot.width !== before.width,
    changedVisibilityKeys: [...keys].filter(
      (key) =>
        hasOwnKey(before.requestedVisibilityByWorkspace, key)
          !== hasOwnKey(snapshot.requestedVisibilityByWorkspace, key)
        || before.requestedVisibilityByWorkspace[key]
          !== snapshot.requestedVisibilityByWorkspace[key],
    ),
  });
}

/** Await until the harness has parked at least one operation (manual mode). */
export async function waitForPending(
  harness: FileTreeDockStorageHarness,
  count = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 50 && harness.pending.length < count; attempt += 1) {
    await Promise.resolve();
  }
  if (harness.pending.length < count) {
    throw new Error(`expected ${count} pending storage operation(s)`);
  }
}

/** Let queued microtask-driven storage operations run to completion. */
export async function flushLane(attachment: FileTreeDockAttachment): Promise<void> {
  await attachment.idle();
  await Promise.resolve();
}
