import { afterEach, describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import {
  clearCloudDisplayNameBackfillSuppression,
  hydrateCloudDisplayNameSuppression,
  isCloudDisplayNameBackfillSuppressed,
  resetCloudDisplayNameSuppressionForTests,
  setCloudDisplayNameSuppressionStorageContext,
  suppressCloudDisplayNameBackfill,
} from "./cloud-display-name-backfill-suppression";

const KEY = "proliferate.cloudDisplayNameBackfillSuppression.v1";

afterEach(() => {
  resetCloudDisplayNameSuppressionForTests();
});

describe("cloud display name backfill suppression", () => {
  it("persists a user reset suppression until it is cleared", async () => {
    const memory = createMemoryProductStorage();
    setCloudDisplayNameSuppressionStorageContext(memory.context);

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(false);

    suppressCloudDisplayNameBackfill("cloud-1");
    await Promise.resolve();

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(true);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-2")).toBe(false);
    expect(memory.readJson(KEY)).toEqual({ "cloud-1": true });

    clearCloudDisplayNameBackfillSuppression("cloud-1");
    await Promise.resolve();

    expect(isCloudDisplayNameBackfillSuppressed("cloud-1")).toBe(false);
    // Empty map removes the key rather than persisting `{}`.
    expect(memory.values.has(KEY)).toBe(false);
  });

  it("hydrates the persisted suppression map into the in-memory cache", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, { "cloud-9": true });
    setCloudDisplayNameSuppressionStorageContext(memory.context);

    await hydrateCloudDisplayNameSuppression(memory.context);

    expect(isCloudDisplayNameBackfillSuppressed("cloud-9")).toBe(true);
  });

  it("merges a new suppression onto the hydrated map", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(KEY, { "cloud-disk": true });
    setCloudDisplayNameSuppressionStorageContext(memory.context);

    await hydrateCloudDisplayNameSuppression(memory.context);
    suppressCloudDisplayNameBackfill("cloud-live");
    await Promise.resolve();

    expect(isCloudDisplayNameBackfillSuppressed("cloud-live")).toBe(true);
    expect(isCloudDisplayNameBackfillSuppressed("cloud-disk")).toBe(true);
    expect(memory.readJson(KEY)).toEqual({ "cloud-disk": true, "cloud-live": true });
  });
});
