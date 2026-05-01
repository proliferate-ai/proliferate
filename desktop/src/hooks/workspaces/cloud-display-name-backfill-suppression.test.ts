import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCloudDisplayNameBackfillSuppression,
  isCloudDisplayNameBackfillSuppressed,
  suppressCloudDisplayNameBackfill,
} from "./cloud-display-name-backfill-suppression";

describe("cloud display name backfill suppression", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => {
          storage.delete(key);
        },
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a user reset suppression until it is cleared", () => {
    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(false);

    suppressCloudDisplayNameBackfill("cloud-1");

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-2")).toBe(false);

    clearCloudDisplayNameBackfillSuppression("cloud-1");

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(false);
  });
});
