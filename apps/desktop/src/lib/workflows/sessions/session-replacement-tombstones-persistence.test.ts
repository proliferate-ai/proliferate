import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";
import {
  readSessionReplacementTombstones,
  writeSessionReplacementTombstones,
} from "./session-replacement-tombstones-persistence";

const values = new Map<string, string>();
const captureException = vi.fn();
const context: ProductStorageContext = {
  storage: {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  },
  captureException,
};

beforeEach(() => {
  values.clear();
  captureException.mockClear();
});

describe("session replacement tombstone persistence", () => {
  it("persists and clears workspace-scoped cleanup records", async () => {
    await writeSessionReplacementTombstones(context, {
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["client-old", "runtime-old"],
      }],
    });

    await expect(readSessionReplacementTombstones(context)).resolves.toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old", "client-old"],
      }],
    });

    await writeSessionReplacementTombstones(context, {});
    await expect(readSessionReplacementTombstones(context)).resolves.toEqual({});
  });

  it("reads legacy runtime-id arrays", async () => {
    values.set(
      "proliferate.session-replacement-tombstones.v1",
      JSON.stringify({ "workspace-1": ["runtime-old"] }),
    );

    await expect(readSessionReplacementTombstones(context)).resolves.toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old"],
      }],
    });
  });

  it("captures failed writes and removals without rejecting", async () => {
    const failingContext: ProductStorageContext = {
      storage: {
        getItem: async () => null,
        setItem: async () => {
          throw new Error("storage unavailable");
        },
        removeItem: async () => {
          throw new Error("storage unavailable");
        },
      },
      captureException,
    };

    await expect(writeSessionReplacementTombstones(failingContext, {
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old"],
      }],
    })).resolves.toBe(false);
    await expect(writeSessionReplacementTombstones(failingContext, {}))
      .resolves.toBe(false);
    expect(captureException).toHaveBeenCalledTimes(2);
  });
});
