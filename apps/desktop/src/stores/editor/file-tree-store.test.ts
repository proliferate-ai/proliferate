import { afterEach, describe, expect, it } from "vitest";
import { createMemoryProductStorage } from "@/test/product-storage-test-utils";
import {
  FILE_TREE_MIN_WIDTH,
  FILE_TREE_STORAGE_KEY,
  hydrateFileTreeStore,
  resetFileTreeStoreForTests,
  setFileTreeStoreStorageContext,
  useFileTreeStore,
} from "./file-tree-store";

afterEach(() => {
  resetFileTreeStoreForTests();
});

describe("file tree store", () => {
  it("persists a clamped width through the context", async () => {
    const memory = createMemoryProductStorage();
    setFileTreeStoreStorageContext(memory.context);

    useFileTreeStore.getState().setWidth(10);
    await Promise.resolve();

    expect(useFileTreeStore.getState().width).toBe(FILE_TREE_MIN_WIDTH);
    expect(memory.readJson(FILE_TREE_STORAGE_KEY)).toEqual({ width: FILE_TREE_MIN_WIDTH });
  });

  it("hydrates the persisted width (clamped) and never persists expandedPaths", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(FILE_TREE_STORAGE_KEY, { width: 520 });
    setFileTreeStoreStorageContext(memory.context);

    await hydrateFileTreeStore(memory.context);

    expect(useFileTreeStore.getState().width).toBe(520);
    useFileTreeStore.getState().toggleExpanded("a/b");
    await Promise.resolve();
    // expandedPaths mutations never write.
    expect(memory.readJson(FILE_TREE_STORAGE_KEY)).toEqual({ width: 520 });
  });

  it("does not let a late hydration overwrite a user resize", async () => {
    const memory = createMemoryProductStorage();
    memory.values.set(FILE_TREE_STORAGE_KEY, { width: 300 });
    setFileTreeStoreStorageContext(memory.context);

    useFileTreeStore.getState().setWidth(640);
    await hydrateFileTreeStore(memory.context);

    expect(useFileTreeStore.getState().width).toBe(640);
  });
});
