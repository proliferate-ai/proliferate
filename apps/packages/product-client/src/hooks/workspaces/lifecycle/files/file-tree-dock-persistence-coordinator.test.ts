import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILE_TREE_DOCK_STORAGE_KEY,
  LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
} from "#product/lib/domain/files/file-tree-dock-state";
import {
  resetFileTreeStoreForTests,
  selectFileTreeDesiredWidth,
  selectFileTreeRequestedVisibility,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";
import {
  attachFileTreeDockPersistence,
  resetFileTreeDockPersistenceForTests,
  type FileTreeDockAttachment,
} from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-coordinator";
import { fileTreeDockStorePort } from "#product/hooks/workspaces/lifecycle/files/use-file-tree-dock-persistence-lifecycle";
import {
  createFileTreeDockStorageHarness,
  flushLane,
  mutateAndRelay,
  waitForPending,
  type FileTreeDockStorageHarness,
} from "#product/hooks/workspaces/lifecycle/files/file-tree-dock-persistence-test-support";

const KEY = FILE_TREE_DOCK_STORAGE_KEY;
const LEGACY_KEY = LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY;
const WS = { primaryKey: null, fallbackKey: "ws-1" };
const LOGICAL = { primaryKey: "logical-1", fallbackKey: "ws-1" };

let harness: FileTreeDockStorageHarness;
let sink: ReturnType<typeof vi.fn>;

function attach(
  storageHarness: FileTreeDockStorageHarness = harness,
  diagnosticSink: (event: unknown) => void = sink,
): FileTreeDockAttachment {
  return attachFileTreeDockPersistence({
    storage: storageHarness.storage,
    statePort: fileTreeDockStorePort,
    sink: diagnosticSink as never,
  });
}

function store() {
  return useFileTreeStore.getState();
}

beforeEach(() => {
  resetFileTreeStoreForTests();
  resetFileTreeDockPersistenceForTests();
  harness = createFileTreeDockStorageHarness();
  sink = vi.fn();
});

afterEach(() => {
  resetFileTreeStoreForTests();
  resetFileTreeDockPersistenceForTests();
});

describe("required reads gate every mutation", () => {
  it("performs zero writes/removals while the required read is in flight", async () => {
    harness.manual = true;
    harness.seed(LEGACY_KEY, { width: 512 });
    const attachment = attach();

    mutateAndRelay(attachment, () => store().setDesiredWidth(640));
    mutateAndRelay(attachment, () => store().setRequestedVisibility(WS, true));

    expect(harness.callCount("set", KEY)).toBe(0);
    expect(harness.callCount("remove", LEGACY_KEY)).toBe(0);
    expect(harness.pending).toHaveLength(1);
    expect(harness.pending[0]).toMatchObject({ kind: "get", key: KEY });
  });

  it("merges field-wise after the reads settle: dirty fields win, untouched hydrate", async () => {
    harness.seed(KEY, {
      version: 1,
      width: 300,
      requestedVisibilityByWorkspace: { "logical-9": true, "logical-1": false },
    });
    harness.manual = true;
    const attachment = attach();

    mutateAndRelay(attachment, () => store().setDesiredWidth(640));
    harness.manual = false;
    harness.settleNext();
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(640);
    expect(store().requestedVisibilityByWorkspace).toEqual({
      "logical-9": true,
      "logical-1": false,
    });
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 640,
      requestedVisibilityByWorkspace: { "logical-9": true, "logical-1": false },
    });
  });

  it("blocks after exactly two failed reads and retries on the next mutation", async () => {
    harness.failNext("get", KEY, 2);
    const attachment = attach();
    await flushLane(attachment);

    expect(harness.callCount("get", KEY)).toBe(2);
    expect(attachment.inspect().readPhase).toBe("blocked");
    expect(harness.callCount("set", KEY)).toBe(0);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenLastCalledWith({ operation: "read-current", outcome: "failed" });

    mutateAndRelay(attachment, () => store().setDesiredWidth(640));
    await flushLane(attachment);

    expect(harness.callCount("get", KEY)).toBe(3);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 640,
      requestedVisibilityByWorkspace: {},
    });
  });

  it("retries a blocked read cycle on a same-authority remount", async () => {
    harness.failNext("get", KEY, 2);
    const first = attach();
    await flushLane(first);
    first.detach();

    const second = attach();
    await flushLane(second);

    expect(harness.callCount("get", KEY)).toBe(3);
    expect(second.inspect().readPhase).toBe("clear");
  });

  it("never treats a failed read as absence and never migrates on it", async () => {
    harness.seed(LEGACY_KEY, { width: 512 });
    harness.failNext("get", KEY, 2);
    const attachment = attach();
    await flushLane(attachment);

    expect(harness.callCount("get", LEGACY_KEY)).toBe(0);
    expect(harness.values.has(LEGACY_KEY)).toBe(true);
  });
});

describe("one-time legacy migration", () => {
  it("takes the new key first and never reads the legacy key when it exists", async () => {
    harness.seed(KEY, { version: 1, width: 300, requestedVisibilityByWorkspace: {} });
    harness.seed(LEGACY_KEY, { width: 900 });
    const attachment = attach();
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(300);
    expect(harness.callCount("get", LEGACY_KEY)).toBe(0);
    expect(harness.values.has(LEGACY_KEY)).toBe(true);
  });

  it("normalizes a corrupt new record instead of falling back to the legacy key", async () => {
    harness.values.set(KEY, "{not json");
    harness.seed(LEGACY_KEY, { width: 900 });
    const attachment = attach();
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(400);
    expect(harness.callCount("get", LEGACY_KEY)).toBe(0);
  });

  it("migrates exactly the unversioned width and removes the old key only after the write", async () => {
    harness.seed(LEGACY_KEY, { width: 512, expandedPaths: ["src"], open: true });
    const attachment = attach();
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(512);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 512,
      requestedVisibilityByWorkspace: {},
    });
    expect(harness.values.has(LEGACY_KEY)).toBe(false);
    const order = harness.calls.map((call) => `${call.kind}:${call.key}`);
    expect(order.indexOf(`set:${KEY}`)).toBeLessThan(order.indexOf(`remove:${LEGACY_KEY}`));
  });

  it("ignores a versioned legacy payload and writes nothing", async () => {
    harness.seed(LEGACY_KEY, { version: 1, width: 512 });
    const attachment = attach();
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(400);
    expect(harness.callCount("set", KEY)).toBe(0);
    expect(harness.values.has(LEGACY_KEY)).toBe(true);
  });

  it("lets a concurrent user write win over the legacy width", async () => {
    harness.seed(LEGACY_KEY, { width: 512 });
    harness.manual = true;
    const attachment = attach();
    mutateAndRelay(attachment, () => store().setDesiredWidth(700));
    mutateAndRelay(attachment, () => store().setRequestedVisibility(WS, true));
    harness.manual = false;
    harness.settleNext(); // new-key read: missing
    await flushLane(attachment);

    expect(selectFileTreeDesiredWidth(store())).toBe(700);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 700,
      requestedVisibilityByWorkspace: { "ws-1": true },
    });
    expect(harness.values.has(LEGACY_KEY)).toBe(false);
  });

  it("keeps the old key and merged live state after two failed migration writes", async () => {
    harness.seed(LEGACY_KEY, { width: 512 });
    harness.failNext("set", KEY, 2);
    const attachment = attach();
    await flushLane(attachment);

    expect(harness.callCount("set", KEY)).toBe(2);
    expect(harness.values.has(LEGACY_KEY)).toBe(true);
    expect(selectFileTreeDesiredWidth(store())).toBe(512);
    const inspection = attachment.inspect();
    expect(inspection.pendingWrite).toBe(true);
    expect(inspection.writeBlocked).toBe(true);
    expect(inspection.latestSnapshot.width).toBe(512);
  });

  it("retries a failed old-key removal once immediately and again on remount", async () => {
    harness.seed(LEGACY_KEY, { width: 512 });
    harness.failNext("remove", LEGACY_KEY, 2);
    const attachment = attach();
    await flushLane(attachment);

    expect(harness.callCount("remove", LEGACY_KEY)).toBe(2);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 512,
      requestedVisibilityByWorkspace: {},
    });
    expect(selectFileTreeDesiredWidth(store())).toBe(512);
    expect(sink).toHaveBeenLastCalledWith({ operation: "remove-legacy", outcome: "failed" });

    attachment.detach();
    const remounted = attach();
    await flushLane(remounted);

    expect(harness.callCount("remove", LEGACY_KEY)).toBe(3);
    expect(harness.values.has(LEGACY_KEY)).toBe(false);
  });
});

describe("serialized writer", () => {
  it("coalesces out-of-order mutations behind one in-flight write", async () => {
    harness.manual = true;
    const attachment = attach();
    await waitForPending(harness);
    harness.settleNext(); // new key missing
    await waitForPending(harness);
    harness.settleNext(); // legacy key missing
    await Promise.resolve();

    mutateAndRelay(attachment, () => store().setDesiredWidth(500));
    await waitForPending(harness);

    mutateAndRelay(attachment, () => store().setDesiredWidth(600));
    mutateAndRelay(attachment, () => store().setRequestedVisibility(WS, true));
    expect(harness.pending).toHaveLength(1);

    harness.settleNext(); // first write completes (stale revision)
    await Promise.resolve();
    await Promise.resolve();
    harness.manual = false;
    harness.settleNext();
    await flushLane(attachment);

    expect(harness.callCount("set", KEY)).toBe(2);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 600,
      requestedVisibilityByWorkspace: { "ws-1": true },
    });
    expect(attachment.inspect().dirtyWidth).toBe(false);
  });

  it("bounds a failing write to two attempts and retries on the next mutation", async () => {
    const attachment = attach();
    await flushLane(attachment);
    harness.failNext("set", KEY, 2);

    mutateAndRelay(attachment, () => store().setDesiredWidth(500));
    await flushLane(attachment);

    expect(harness.callCount("set", KEY)).toBe(2);
    expect(attachment.inspect()).toMatchObject({
      writeBlocked: true,
      pendingWrite: true,
      dirtyWidth: true,
    });
    expect(sink).toHaveBeenCalledWith({ operation: "write", outcome: "failed" });

    mutateAndRelay(attachment, () => store().setDesiredWidth(520));
    await flushLane(attachment);

    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 520,
      requestedVisibilityByWorkspace: {},
    });
    expect(attachment.inspect().dirtyWidth).toBe(false);
  });

  it("retries a blocked write on a same-authority remount", async () => {
    const attachment = attach();
    await flushLane(attachment);
    harness.failNext("set", KEY, 2);
    mutateAndRelay(attachment, () => store().setDesiredWidth(500));
    await flushLane(attachment);
    attachment.detach();

    const remounted = attach();
    await flushLane(remounted);

    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 500,
      requestedVisibilityByWorkspace: {},
    });
  });
});

describe("logical-key promotion", () => {
  async function hydrateWithFallback(): Promise<FileTreeDockAttachment> {
    harness.seed(KEY, {
      version: 1,
      width: 400,
      requestedVisibilityByWorkspace: { "ws-1": true },
    });
    const attachment = attach();
    await flushLane(attachment);
    return attachment;
  }

  it("promotes the fallback into the primary in one record write with no visible flip", async () => {
    const attachment = await hydrateWithFallback();

    attachment.ensureRequestedVisibilityPromotion(LOGICAL);
    expect(selectFileTreeRequestedVisibility(store(), LOGICAL)).toBe(true);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true });

    await flushLane(attachment);

    expect(harness.callCount("set", KEY)).toBe(1);
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 400,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
    expect(attachment.inspect().promotions).toHaveLength(0);
  });

  it("keeps the effective fallback in memory while promotion writes fail", async () => {
    const attachment = await hydrateWithFallback();
    harness.failNext("set", KEY, 2);

    attachment.ensureRequestedVisibilityPromotion(LOGICAL);
    await flushLane(attachment);

    expect(harness.callCount("set", KEY)).toBe(2);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true });
    expect(selectFileTreeRequestedVisibility(store(), LOGICAL)).toBe(true);
    expect(attachment.inspect().promotions).toHaveLength(1);
  });

  it("rebases a deferred promotion over a later width mutation", async () => {
    const attachment = await hydrateWithFallback();
    harness.manual = true;

    attachment.ensureRequestedVisibilityPromotion(LOGICAL);
    await Promise.resolve();
    expect(harness.pending).toHaveLength(1);

    mutateAndRelay(attachment, () => store().setDesiredWidth(620));
    harness.settleNext(); // the superseded in-flight write completes
    await Promise.resolve();
    await Promise.resolve();

    // The stale completion committed nothing: the fallback is still effective.
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true });

    harness.manual = false;
    harness.settleNext();
    await flushLane(attachment);

    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 620,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
  });

  it("lets an explicit same-boolean primary write supersede the pending pair", async () => {
    const attachment = await hydrateWithFallback();
    harness.manual = true;

    attachment.ensureRequestedVisibilityPromotion(LOGICAL);
    await Promise.resolve();
    mutateAndRelay(attachment, () => store().setRequestedVisibility(LOGICAL, true));

    expect(attachment.inspect().promotions).toHaveLength(0);

    harness.settleNext(); // stale in-flight write
    await Promise.resolve();
    await Promise.resolve();
    harness.manual = false;
    harness.settleNext();
    await flushLane(attachment);

    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 400,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });
  });

  it("composes a second distinct pair into the same latest snapshot", async () => {
    harness.seed(KEY, {
      version: 1,
      width: 400,
      requestedVisibilityByWorkspace: { "ws-1": true, "ws-2": false },
    });
    const attachment = attach();
    await flushLane(attachment);
    harness.manual = true;

    attachment.ensureRequestedVisibilityPromotion(LOGICAL);
    await Promise.resolve();
    attachment.ensureRequestedVisibilityPromotion({
      primaryKey: "logical-2",
      fallbackKey: "ws-2",
    });
    expect(attachment.inspect().promotions).toHaveLength(2);

    harness.settleNext(); // superseded write
    await Promise.resolve();
    await Promise.resolve();
    harness.manual = false;
    harness.settleNext();
    await flushLane(attachment);

    expect(harness.readJson(KEY)).toEqual({
      version: 1,
      width: 400,
      requestedVisibilityByWorkspace: { "logical-1": true, "logical-2": false },
    });
    expect(store().requestedVisibilityByWorkspace).toEqual({
      "logical-1": true,
      "logical-2": false,
    });
  });
});

describe("storage-authority continuity", () => {
  it("keeps one coordinator across a host/context refresh and reports through the newest sink", async () => {
    harness.manual = true;
    const firstSink = vi.fn();
    const first = attach(harness, firstSink);
    await waitForPending(harness);
    harness.settleNext(); // new key missing
    await waitForPending(harness);
    harness.settleNext(); // legacy missing
    await Promise.resolve();
    mutateAndRelay(first, () => store().setDesiredWidth(500));
    await waitForPending(harness);

    // Same storage object, new ProductStorageContext identity.
    first.detach();
    const secondSink = vi.fn();
    const second = attach(harness, secondSink);
    expect(second.inspect()).toMatchObject({ readPhase: "clear", busy: true });

    harness.settleNext("fail");
    await Promise.resolve();
    await Promise.resolve();

    expect(firstSink).not.toHaveBeenCalled();
    expect(secondSink).toHaveBeenCalledWith({ operation: "write", outcome: "failed" });
    expect(harness.callCount("get", KEY)).toBe(1);
  });

  it("never races an earlier noncancelable operation across unmount/remount", async () => {
    harness.manual = true;
    const first = attach();
    expect(harness.pending).toHaveLength(1);

    first.detach();
    const second = attach();

    expect(harness.pending).toHaveLength(1);
    expect(harness.callCount("get", KEY)).toBe(1);

    harness.manual = false;
    harness.settleNext();
    await flushLane(second);

    expect(second.inspect().readPhase).toBe("clear");
  });

  it("isolates a different storage object and rejects stale old-authority commits", async () => {
    const other = createFileTreeDockStorageHarness();
    other.seed(KEY, {
      version: 1,
      width: 900,
      requestedVisibilityByWorkspace: { "logical-9": true },
    });
    harness.manual = true;
    harness.seed(KEY, {
      version: 1,
      width: 300,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });

    const first = attach();
    mutateAndRelay(first, () => store().setDesiredWidth(500));
    first.detach();

    const second = attach(other);
    await flushLane(second);

    expect(selectFileTreeDesiredWidth(store())).toBe(900);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-9": true });

    // The old authority's read now completes; it must not commit into the new
    // authority's UI, and its dirty state stays in its own coordinator.
    harness.manual = false;
    harness.settleNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(selectFileTreeDesiredWidth(store())).toBe(900);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-9": true });
    expect(first.inspect().dirtyWidth).toBe(true);
    expect(other.callCount("set", KEY)).toBe(0);
  });
});
