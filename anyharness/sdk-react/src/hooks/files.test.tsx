// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { useStatWorkspaceFileQuery } from "./files.js";

const mocks = vi.hoisted(() => ({
  stat: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    files: {
      stat: mocks.stat,
    },
  }),
}));

describe("workspace file stat query", () => {
  afterEach(() => {
    cleanup();
    mocks.stat.mockReset();
  });

  it("stats the workspace root when the path is empty", async () => {
    mocks.stat.mockResolvedValue({
      path: "",
      kind: "directory",
    });
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => useStatWorkspaceFileQuery({ path: "" }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.stat).toHaveBeenCalledOnce();
    expect(mocks.stat).toHaveBeenCalledWith(
      "anyharness-workspace-1",
      "",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not stat when the path is null", async () => {
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => useStatWorkspaceFileQuery({ path: null }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mocks.stat).not.toHaveBeenCalled();
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl="http://runtime-files.test">
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl: "http://runtime-files.test",
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
