import { describe, expect, it, vi } from "vitest";
import type { ProductStorage } from "@proliferate/product-client/host/product-host";
import { createMemoryProductStorage } from "#product/test/product-storage-test-utils";
import {
  FILE_TREE_DOCK_STORAGE_KEY,
  LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY,
} from "#product/lib/domain/files/file-tree-dock-state";
import {
  readFileTreeDockRecord,
  removeFileTreeDockKey,
  writeFileTreeDockRecord,
} from "#product/lib/access/persistence/file-tree-dock-storage";

const RECORD = {
  version: 1 as const,
  width: 480,
  requestedVisibilityByWorkspace: { "logical-1": true },
};

function failingStorage(error: unknown): ProductStorage {
  return {
    getItem: vi.fn(() => Promise.reject(error)),
    setItem: vi.fn(() => Promise.reject(error)),
    removeItem: vi.fn(() => Promise.reject(error)),
  };
}

describe("readFileTreeDockRecord", () => {
  it("settles with the decoded JSON when the key is present", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(FILE_TREE_DOCK_STORAGE_KEY, RECORD);

    await expect(
      readFileTreeDockRecord(memory.storage, FILE_TREE_DOCK_STORAGE_KEY),
    ).resolves.toEqual({ status: "settled", raw: RECORD });
  });

  it("reports a positively absent key as missing", async () => {
    const memory = createMemoryProductStorage();

    await expect(
      readFileTreeDockRecord(memory.storage, FILE_TREE_DOCK_STORAGE_KEY),
    ).resolves.toEqual({ status: "missing" });
  });

  it("settles a present-but-malformed value rather than reporting absence", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(FILE_TREE_DOCK_STORAGE_KEY, "{not json");

    await expect(
      readFileTreeDockRecord(memory.storage, FILE_TREE_DOCK_STORAGE_KEY),
    ).resolves.toEqual({ status: "settled", raw: undefined });
  });

  it("reports a rejected read as failed and never as missing", async () => {
    const error = new Error("read boom");

    await expect(
      readFileTreeDockRecord(failingStorage(error), FILE_TREE_DOCK_STORAGE_KEY),
    ).resolves.toEqual({ status: "failed", error });
  });
});

describe("writeFileTreeDockRecord", () => {
  it("serializes the record and reports success", async () => {
    const memory = createMemoryProductStorage();

    await expect(
      writeFileTreeDockRecord(memory.storage, FILE_TREE_DOCK_STORAGE_KEY, RECORD),
    ).resolves.toEqual({ status: "succeeded" });
    expect(memory.readJson(FILE_TREE_DOCK_STORAGE_KEY)).toEqual(RECORD);
  });

  it("reports a rejected write as failed without throwing", async () => {
    const error = new Error("write boom");

    await expect(
      writeFileTreeDockRecord(failingStorage(error), FILE_TREE_DOCK_STORAGE_KEY, RECORD),
    ).resolves.toEqual({ status: "failed", error });
  });
});

describe("removeFileTreeDockKey", () => {
  it("removes the key and reports success", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY, { width: 512 });

    await expect(
      removeFileTreeDockKey(memory.storage, LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY),
    ).resolves.toEqual({ status: "succeeded" });
    expect(memory.values.has(LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY)).toBe(false);
  });

  it("reports a rejected removal as failed", async () => {
    const error = new Error("remove boom");

    await expect(
      removeFileTreeDockKey(failingStorage(error), LEGACY_FILE_TREE_OVERLAY_STORAGE_KEY),
    ).resolves.toEqual({ status: "failed", error });
  });
});
