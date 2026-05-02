import { beforeEach, describe, expect, it } from "vitest";
import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { useWorkspaceFileBuffersStore } from "./workspace-file-buffers-store";

describe("workspace file buffers store", () => {
  beforeEach(() => {
    useWorkspaceFileBuffersStore.getState().reset();
  });

  it("can replace a dirty conflict buffer with the latest disk contents", () => {
    const store = useWorkspaceFileBuffersStore.getState();
    store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
    store.updateBuffer("src/app.ts", "local edit");
    store.ensureBufferFromRead("src/app.ts", readFile("remote edit", "v2"));

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"]?.saveState)
      .toBe("conflict");

    store.replaceBufferFromRead("src/app.ts", readFile("remote edit", "v2"));

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"]).toMatchObject({
      baseContent: "remote edit",
      localContent: "remote edit",
      baseVersionToken: "v2",
      isDirty: false,
      saveState: "idle",
    });
  });

  it("preserves edits typed while a save is in flight", () => {
    const store = useWorkspaceFileBuffersStore.getState();
    store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
    store.updateBuffer("src/app.ts", "save payload");
    store.setBufferSaveState("src/app.ts", "saving");
    store.updateBuffer("src/app.ts", "typed while saving");

    store.applyFileSave("src/app.ts", "v2", "save payload");

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"]).toMatchObject({
      baseContent: "save payload",
      localContent: "typed while saving",
      baseVersionToken: "v2",
      isDirty: true,
      saveState: "idle",
    });
  });

  it("resets every path-scoped draft", () => {
    const store = useWorkspaceFileBuffersStore.getState();
    store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
    store.updateBuffer("src/app.ts", "local edit");

    store.reset();

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath).toEqual({});
  });

  it("renames buffers under a moved directory", () => {
    const store = useWorkspaceFileBuffersStore.getState();
    store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
    store.ensureBufferFromRead("src-old/app.ts", readFile("other", "v1"));

    store.renamePathPrefix("src", "lib");

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"]).toBeUndefined();
    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["lib/app.ts"]).toMatchObject({
      path: "lib/app.ts",
      localContent: "old",
    });
    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src-old/app.ts"]).toMatchObject({
      path: "src-old/app.ts",
      localContent: "other",
    });
  });

  it("clears buffers under a deleted directory", () => {
    const store = useWorkspaceFileBuffersStore.getState();
    store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
    store.ensureBufferFromRead("src-old/app.ts", readFile("other", "v1"));

    store.clearPathPrefix("src");

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"]).toBeUndefined();
    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src-old/app.ts"]).toMatchObject({
      path: "src-old/app.ts",
    });
  });
});

function readFile(content: string, versionToken: string): ReadWorkspaceFileResponse {
  return {
    content,
    isText: true,
    path: "src/app.ts",
    sizeBytes: content.length,
    tooLarge: false,
    versionToken,
  } as ReadWorkspaceFileResponse;
}
