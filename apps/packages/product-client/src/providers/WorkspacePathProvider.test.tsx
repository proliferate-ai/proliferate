// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductResolvedWorkspaceConnection } from "#product/lib/access/anyharness/resolve-workspace-connection";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as { path?: string | null } | undefined,
    isPending: true,
    isError: false,
  },
  queryOptions: [] as Array<{ workspaceId: string | null; enabled: boolean }>,
}));

vi.mock("@anyharness/sdk-react", () => ({
  useWorkspaceQuery: (options: { workspaceId: string | null; enabled: boolean }) => {
    mocks.queryOptions.push(options);
    return mocks.query;
  },
}));

import {
  ProductWorkspaceConnectionProvider,
  type ProductWorkspaceConnectionResolver,
} from "#product/providers/ProductWorkspaceConnectionProvider";
import {
  useWorkspacePath,
  WorkspacePathProvider,
} from "#product/providers/WorkspacePathProvider";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

function StateProbe() {
  return <pre data-testid="state">{JSON.stringify(useWorkspacePath())}</pre>;
}

function renderProvider(resolveConnection: ProductWorkspaceConnectionResolver) {
  return render(
    <ProductWorkspaceConnectionProvider resolveConnection={resolveConnection}>
      <WorkspacePathProvider>
        <StateProbe />
      </WorkspacePathProvider>
    </ProductWorkspaceConnectionProvider>,
  );
}

function state(): ReturnType<typeof useWorkspacePath> {
  return JSON.parse(screen.getByTestId("state").textContent ?? "null");
}

function resolved(
  filesystemOrigin: ProductResolvedWorkspaceConnection["filesystemOrigin"],
): ProductResolvedWorkspaceConnection {
  return {
    connection: {
      runtimeUrl: "https://runtime.test",
      anyharnessWorkspaceId: "runtime-workspace",
      runtimeGeneration: 1,
    },
    filesystemOrigin,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.data = undefined;
  mocks.query.isPending = true;
  mocks.query.isError = false;
  mocks.queryOptions.length = 0;
  useSessionSelectionStore.setState({
    selectedWorkspaceId: null,
    selectedLogicalWorkspaceId: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("WorkspacePathProvider", () => {
  it("keeps null selection pending without resolving or querying", () => {
    const resolveConnection = vi.fn<ProductWorkspaceConnectionResolver>();
    renderProvider(resolveConnection);

    expect(state()).toEqual({
      materializedWorkspaceId: null,
      filesystemOrigin: { status: "pending", origin: null },
      workspaceRoot: { status: "pending", path: null },
    });
    expect(resolveConnection).not.toHaveBeenCalled();
    expect(mocks.queryOptions.at(-1)).toEqual({ workspaceId: null, enabled: false });
  });

  it.each([
    ["desktop-local" as const, "/workspaces/local/", "/workspaces/local"],
    ["remote" as const, "/workspaces/cloud", "/workspaces/cloud"],
  ])("settles %s provenance and a normalized runtime root", async (
    filesystemOrigin,
    runtimePath,
    expectedPath,
  ) => {
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-materialized",
      selectedLogicalWorkspaceId: "logical:workspace",
    });
    mocks.query.data = { path: runtimePath };
    mocks.query.isPending = false;
    const resolveConnection = vi.fn<ProductWorkspaceConnectionResolver>()
      .mockResolvedValue(resolved(filesystemOrigin));
    renderProvider(resolveConnection);

    await waitFor(() => expect(state().filesystemOrigin).toEqual({
      status: "settled",
      origin: filesystemOrigin,
    }));
    expect(state()).toMatchObject({
      materializedWorkspaceId: "workspace-materialized",
      workspaceRoot: { status: "settled", path: expectedPath },
    });
    expect(resolveConnection).toHaveBeenCalledWith("workspace-materialized");
    expect(mocks.queryOptions.at(-1)).toEqual({
      workspaceId: "workspace-materialized",
      enabled: true,
    });
  });

  it.each([undefined, null, "relative/root", "/root/../escape", "/bad\0root"])(
    "marks invalid runtime root %s unavailable",
    async (runtimePath) => {
      useSessionSelectionStore.setState({ selectedWorkspaceId: "workspace-1" });
      mocks.query.data = { path: runtimePath };
      mocks.query.isPending = false;
      const resolveConnection = vi.fn<ProductWorkspaceConnectionResolver>()
        .mockResolvedValue(resolved("desktop-local"));
      renderProvider(resolveConnection);

      await waitFor(() => expect(state().filesystemOrigin.status).toBe("settled"));
      expect(state().workspaceRoot).toEqual({ status: "unavailable", path: null });
    },
  );

  it("marks a rejected provenance resolution unknown without exposing its error", async () => {
    useSessionSelectionStore.setState({ selectedWorkspaceId: "cloud:cloud-1" });
    mocks.query.isPending = false;
    mocks.query.isError = true;
    const resolveConnection = vi.fn<ProductWorkspaceConnectionResolver>()
      .mockRejectedValue(new Error("secret path /private/workspace"));
    renderProvider(resolveConnection);

    await waitFor(() => expect(state().filesystemOrigin).toEqual({
      status: "rejected",
      origin: null,
    }));
    expect(state().workspaceRoot).toEqual({ status: "unavailable", path: null });
    expect(screen.getByTestId("state").textContent).not.toContain("secret path");
  });

  it("resets on selection change and ignores a stale completion", async () => {
    let resolveFirst!: (value: ProductResolvedWorkspaceConnection) => void;
    let resolveSecond!: (value: ProductResolvedWorkspaceConnection) => void;
    const first = new Promise<ProductResolvedWorkspaceConnection>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<ProductResolvedWorkspaceConnection>((resolve) => {
      resolveSecond = resolve;
    });
    const resolveConnection = vi.fn<ProductWorkspaceConnectionResolver>((workspaceId) => (
      workspaceId === "workspace-1" ? first : second
    ));
    useSessionSelectionStore.setState({ selectedWorkspaceId: "workspace-1" });
    renderProvider(resolveConnection);
    await waitFor(() => expect(resolveConnection).toHaveBeenCalledWith("workspace-1"));

    act(() => {
      useSessionSelectionStore.setState({
        selectedWorkspaceId: "workspace-2",
        selectedLogicalWorkspaceId: "logical:workspace-2",
      });
    });
    expect(state()).toMatchObject({
      materializedWorkspaceId: "workspace-2",
      filesystemOrigin: { status: "pending", origin: null },
    });
    await waitFor(() => expect(resolveConnection).toHaveBeenCalledWith("workspace-2"));

    await act(async () => {
      resolveFirst(resolved("desktop-local"));
      await first;
    });
    expect(state().filesystemOrigin).toEqual({ status: "pending", origin: null });

    await act(async () => {
      resolveSecond(resolved("remote"));
      await second;
    });
    expect(state().filesystemOrigin).toEqual({ status: "settled", origin: "remote" });
  });
});
