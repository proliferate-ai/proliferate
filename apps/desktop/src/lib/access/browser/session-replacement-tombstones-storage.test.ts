// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  readSessionReplacementTombstones,
  writeSessionReplacementTombstones,
} from "@/lib/access/browser/session-replacement-tombstones-storage";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    },
  });
  window.localStorage.clear();
});

describe("session replacement tombstone storage", () => {
  it("persists and clears workspace-scoped cleanup records", () => {
    expect(writeSessionReplacementTombstones({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["client-old", "runtime-old"],
      }],
    })).toBe(true);

    expect(readSessionReplacementTombstones()).toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old", "client-old"],
      }],
    });

    expect(writeSessionReplacementTombstones({})).toBe(true);
    expect(readSessionReplacementTombstones()).toEqual({});
  });

  it("reads legacy runtime-id arrays", () => {
    window.localStorage.setItem(
      "proliferate.session-replacement-tombstones.v1",
      JSON.stringify({ "workspace-1": ["runtime-old"] }),
    );

    expect(readSessionReplacementTombstones()).toEqual({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old"],
      }],
    });
  });

  it("reports failed writes and removals instead of accepting volatile cleanup", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        removeItem: () => {
          throw new Error("storage unavailable");
        },
        setItem: () => {
          throw new Error("storage unavailable");
        },
      },
    });

    expect(writeSessionReplacementTombstones({
      "workspace-1": [{
        runtimeSessionId: "runtime-old",
        suppressedSessionIds: ["runtime-old"],
      }],
    })).toBe(false);
    expect(writeSessionReplacementTombstones({})).toBe(false);
  });
});
