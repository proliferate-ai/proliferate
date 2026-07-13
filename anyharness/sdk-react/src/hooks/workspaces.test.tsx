// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  anyHarnessWorkspaceDetailKey,
  anyHarnessWorkspacePurgePreflightKey,
  anyHarnessWorkspaceQueryKeyRoots,
  anyHarnessWorkspaceRetirePreflightKey,
} from "../lib/query-keys.js";
import {
  useRuntimeWorkspacesQuery,
  useWorkspaceQuery,
} from "./workspaces.js";

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  clientConnection: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: (connection: unknown) => {
    mocks.clientConnection(connection);
    return {
      workspaces: {
        list: mocks.listWorkspaces,
        get: mocks.getWorkspace,
      },
    };
  },
}));

describe("sdk-react workspace query request options", () => {
  afterEach(() => {
    cleanup();
    mocks.listWorkspaces.mockReset();
    mocks.getWorkspace.mockReset();
    mocks.clientConnection.mockReset();
  });

  it("passes query signals to runtime workspace list without adding them to query keys", async () => {
    mocks.listWorkspaces.mockResolvedValue([]);
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useRuntimeWorkspacesQuery(), {
      wrapper: createWrapper(queryClient, "http://runtime-workspaces.test"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.listWorkspaces).toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.queryKey)))
      .not
      .toContain("signal");
  });

  it("composes caller-provided request signals for workspace display queries", async () => {
    mocks.getWorkspace.mockResolvedValue({ id: "anyharness-workspace-1" });
    const callerController = new AbortController();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useWorkspaceQuery({
      requestOptions: {
        signal: callerController.signal,
      },
    }), { wrapper: createWrapper(queryClient, "http://runtime-launch.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const requestOptions = mocks.getWorkspace.mock.calls[0]?.[1];
    expect(mocks.getWorkspace).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(requestOptions?.signal).not.toBe(callerController.signal);
    callerController.abort("caller-cancelled");
    expect(requestOptions?.signal.aborted).toBe(true);
  });

  it("includes retire and purge preflight roots in workspace display cancellation roots", () => {
    const roots = anyHarnessWorkspaceQueryKeyRoots("http://runtime.test", "workspace-1")
      .map((root) => JSON.stringify(root));

    expect(roots).toContain(JSON.stringify(
      anyHarnessWorkspaceRetirePreflightKey("http://runtime.test", "workspace-1"),
    ));
    expect(roots).toContain(JSON.stringify(
      anyHarnessWorkspacePurgePreflightKey("http://runtime.test", "workspace-1"),
    ));
  });

  it("keeps a cloud workspace key stable and free of resolved gateway credentials", async () => {
    mocks.getWorkspace.mockResolvedValue({ id: "anyharness-workspace-1" });
    const queryClient = createQueryClient();
    let credentialGeneration = 1;
    const resolveConnection = vi.fn().mockImplementation(async () => ({
      runtimeUrl: `https://gateway.test/temporary-route-${credentialGeneration}`,
      authToken: `temporary-token-${credentialGeneration}`,
      anyharnessWorkspaceId: "anyharness-workspace-1",
    }));

    const { result } = renderHook(() => useWorkspaceQuery({}), {
      wrapper: createWrapper(queryClient, null, {
        cacheScopeKey: "https://api.test:user-1",
        resolveConnection,
      }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    credentialGeneration = 2;
    await result.current.refetch();

    expect(resolveConnection).toHaveBeenCalledTimes(2);
    expect(resolveConnection).toHaveBeenCalledWith("workspace-1");
    expect(mocks.clientConnection).toHaveBeenCalledWith(expect.objectContaining({
      runtimeUrl: "https://gateway.test/temporary-route-1",
      authToken: "temporary-token-1",
    }));
    expect(mocks.clientConnection).toHaveBeenCalledWith(expect.objectContaining({
      runtimeUrl: "https://gateway.test/temporary-route-2",
      authToken: "temporary-token-2",
    }));
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).toContainEqual(
      anyHarnessWorkspaceDetailKey("https://api.test:user-1", "workspace-1"),
    );
    const serializedKeys = JSON.stringify(
      queryClient.getQueryCache().getAll().map((query) => query.queryKey),
    );
    expect(serializedKeys).not.toContain("temporary-route");
    expect(serializedKeys).not.toContain("temporary-token");
  });

  it("isolates the same logical workspace across actor cache scopes", async () => {
    mocks.getWorkspace
      .mockResolvedValueOnce({ id: "anyharness-workspace-1", actor: "user-1" })
      .mockResolvedValueOnce({ id: "anyharness-workspace-1", actor: "user-2" });
    const queryClient = createQueryClient();

    const first = renderHook(() => useWorkspaceQuery({}), {
      wrapper: createWrapper(queryClient, null, {
        cacheScopeKey: "https://api.test:user-1",
      }),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useWorkspaceQuery({}), {
      wrapper: createWrapper(queryClient, null, {
        cacheScopeKey: "https://api.test:user-2",
      }),
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(
      anyHarnessWorkspaceDetailKey("https://api.test:user-1", "workspace-1"),
    )).toMatchObject({ actor: "user-1" });
    expect(queryClient.getQueryData(
      anyHarnessWorkspaceDetailKey("https://api.test:user-2", "workspace-1"),
    )).toMatchObject({ actor: "user-2" });
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(
  queryClient: QueryClient,
  runtimeUrl: string | null,
  options?: {
    cacheScopeKey?: string;
    resolveConnection?: () => Promise<{
      runtimeUrl: string;
      authToken?: string;
      anyharnessWorkspaceId: string;
    }>;
  },
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime
          runtimeUrl={runtimeUrl}
          cacheScopeKey={options?.cacheScopeKey}
        >
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={options?.resolveConnection ?? (async () => ({
              runtimeUrl: runtimeUrl ?? "https://gateway.test",
              anyharnessWorkspaceId: "anyharness-workspace-1",
            }))}
          >
            {children}
          </AnyHarnessWorkspace>
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
