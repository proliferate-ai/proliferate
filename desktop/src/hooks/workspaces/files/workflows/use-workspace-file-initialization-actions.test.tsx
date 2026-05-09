// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFileBuffersStore } from "@/stores/editor/workspace-file-buffers-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";
import {
  useWorkspaceFileInitializationActions,
  type WorkspaceFileAccessContext,
} from "./use-workspace-file-initialization-actions";

const mocks = vi.hoisted(() => ({
  getWorkspaceRuntimeBlockReason: vi.fn(),
  prefetchWorkspaceDirectory: vi.fn(),
  resolveWorkspaceConnectionFromContext: vi.fn(),
  useAnyHarnessWorkspaceContext: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  resolveWorkspaceConnectionFromContext: mocks.resolveWorkspaceConnectionFromContext,
  useAnyHarnessWorkspaceContext: mocks.useAnyHarnessWorkspaceContext,
}));

vi.mock("@/hooks/access/anyharness/files/use-workspace-files-cache", () => ({
  useWorkspaceFilesCache: () => ({
    prefetchWorkspaceDirectory: mocks.prefetchWorkspaceDirectory,
  }),
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: mocks.getWorkspaceRuntimeBlockReason,
  }),
}));

describe("useWorkspaceFileInitializationActions", () => {
  beforeEach(() => {
    useWorkspaceViewerTabsStore.getState().reset();
    useWorkspaceFileBuffersStore.getState().reset();
    mocks.getWorkspaceRuntimeBlockReason.mockReturnValue(null);
    mocks.prefetchWorkspaceDirectory.mockResolvedValue(undefined);
    mocks.resolveWorkspaceConnectionFromContext.mockResolvedValue({
      connection: {
        anyharnessWorkspaceId: "anyharness-workspace-1",
        runtimeUrl: "http://runtime-a",
        authToken: null,
      },
    });
    mocks.useAnyHarnessWorkspaceContext.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useWorkspaceViewerTabsStore.getState().reset();
    useWorkspaceFileBuffersStore.getState().reset();
  });

  it("preserves dirty file buffers when the workspace connection is unchanged", () => {
    const { result } = renderHook(() => useWorkspaceFileInitializationActions(fileContext()));

    act(() => {
      result.current.prepareFileWorkspace(accessContext());
      seedDirtyBuffer();
      result.current.prepareFileWorkspace(accessContext());
    });

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath["src/app.ts"])
      .toMatchObject({
        localContent: "local edit",
        isDirty: true,
      });
  });

  it.each([
    {
      name: "AnyHarness workspace id",
      nextContext: accessContext({ anyharnessWorkspaceId: "anyharness-workspace-2" }),
    },
    {
      name: "runtime URL",
      nextContext: accessContext({ runtimeUrl: "http://runtime-b" }),
    },
  ])("resets file buffers when the $name changes", ({ nextContext }) => {
    const { result } = renderHook(() => useWorkspaceFileInitializationActions(fileContext()));

    act(() => {
      result.current.prepareFileWorkspace(accessContext());
      seedDirtyBuffer();
      result.current.prepareFileWorkspace(nextContext);
    });

    expect(useWorkspaceFileBuffersStore.getState().buffersByPath).toEqual({});
    expect(useWorkspaceViewerTabsStore.getState()).not.toHaveProperty("runtimeUrl");
    expect(useWorkspaceViewerTabsStore.getState()).not.toHaveProperty("anyharnessWorkspaceId");
  });
});

function fileContext() {
  return {
    workspaceUiKey: "workspace-ui",
    materializedWorkspaceId: "workspace-1",
    treeStateKey: "tree-1",
  };
}

function accessContext(
  overrides: Partial<WorkspaceFileAccessContext> = {},
): WorkspaceFileAccessContext {
  return {
    workspaceUiKey: "workspace-ui",
    materializedWorkspaceId: "workspace-1",
    anyharnessWorkspaceId: "anyharness-workspace-1",
    runtimeUrl: "http://runtime-a",
    treeStateKey: "tree-1",
    authToken: null,
    ...overrides,
  };
}

function seedDirtyBuffer(): void {
  const store = useWorkspaceFileBuffersStore.getState();
  store.ensureBufferFromRead("src/app.ts", readFile("old", "v1"));
  store.updateBuffer("src/app.ts", "local edit");
}

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
