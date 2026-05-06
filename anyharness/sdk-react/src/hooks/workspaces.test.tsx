// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  anyHarnessWorkspacePurgePreflightKey,
  anyHarnessWorkspaceQueryKeyRoots,
  anyHarnessWorkspaceRetirePreflightKey,
} from "../lib/query-keys.js";
import {
  useRuntimeWorkspacesQuery,
  useWorkspaceSessionLaunchQuery,
} from "./workspaces.js";

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  getSessionLaunchCatalog: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    workspaces: {
      list: mocks.listWorkspaces,
      getSessionLaunchCatalog: mocks.getSessionLaunchCatalog,
    },
  }),
}));

describe("sdk-react workspace query request options", () => {
  afterEach(() => {
    cleanup();
    mocks.listWorkspaces.mockReset();
    mocks.getSessionLaunchCatalog.mockReset();
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

  it("keeps caller-provided request signals for workspace display queries", async () => {
    mocks.getSessionLaunchCatalog.mockResolvedValue({
      workspaceId: "anyharness-workspace-1",
      catalogVersion: "test",
      agents: [],
    });
    const callerController = new AbortController();
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useWorkspaceSessionLaunchQuery({
      requestOptions: {
        signal: callerController.signal,
      },
    }), { wrapper: createWrapper(queryClient, "http://runtime-launch.test") });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.getSessionLaunchCatalog).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      expect.objectContaining({
        signal: callerController.signal,
      }),
    );
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

function createWrapper(queryClient: QueryClient, runtimeUrl: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl={runtimeUrl}>
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl,
              anyharnessWorkspaceId: "anyharness-workspace-1",
            })}
          >
            {children}
          </AnyHarnessWorkspace>
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
