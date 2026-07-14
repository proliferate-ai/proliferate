import { afterEach, describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import {
  hydrateSessionReplacementTombstones,
  resetSessionReplacementTombstonesStorageForTests,
  setSessionReplacementTombstonesStorageContext,
  writeSessionReplacementTombstones,
} from "@/lib/access/persistence/session-replacement-tombstones-storage";

const KEY = "proliferate.session-replacement-tombstones.v1";

afterEach(() => {
  resetSessionReplacementTombstonesStorageForTests();
});

describe("session replacement tombstone storage", () => {
  it("persists workspace-scoped cleanup records through ProductStorage", async () => {
    const memory = createMemoryProductStorage();
    setSessionReplacementTombstonesStorageContext(memory.context);

    expect(writeSessionReplacementTombstones({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["client-old", "runtime-old"],
      }],
    })).toBe(true);
    await Promise.resolve();

    expect(memory.readJson(KEY)).toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["client-old", "runtime-old"],
      }],
    });

    expect(await hydrateSessionReplacementTombstones(memory.context)).toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old", "client-old"],
      }],
    });
  });

  it("removes the key when the committed map is emptied", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, {
      "workspace-1": [{ runtimeSessionId: "runtime-old", suppressedSessionIds: ["runtime-old"] }],
    });
    setSessionReplacementTombstonesStorageContext(memory.context);

    expect(writeSessionReplacementTombstones({})).toBe(true);
    await Promise.resolve();

    expect(memory.values.has(KEY)).toBe(false);
    expect(await hydrateSessionReplacementTombstones(memory.context)).toEqual({});
  });

  it("hydrates legacy runtime-id arrays into the alias-aware shape", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, { "workspace-1": ["runtime-old"] });
    setSessionReplacementTombstonesStorageContext(memory.context);

    expect(await hydrateSessionReplacementTombstones(memory.context)).toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old"],
      }],
    });
  });

  it("reports success and keeps in-memory state when no host is wired", () => {
    expect(writeSessionReplacementTombstones({
      "workspace-1": [{ runtimeSessionId: "runtime-old", suppressedSessionIds: ["runtime-old"] }],
    })).toBe(true);
    expect(writeSessionReplacementTombstones({})).toBe(true);
  });
});
