// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  anyHarnessSessionKey,
  anyHarnessSessionSubagentsKey,
  anyHarnessSessionsKey,
} from "../lib/query-keys.js";
import { useCloseSubagentMutation } from "./sessions.js";

const mocks = vi.hoisted(() => ({
  closeSubagent: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      closeSubagent: mocks.closeSubagent,
    },
  }),
}));

describe("useCloseSubagentMutation", () => {
  afterEach(() => {
    cleanup();
    mocks.closeSubagent.mockReset();
    vi.restoreAllMocks();
  });

  it("closes by stable subagent id and invalidates parent and child session state", async () => {
    mocks.closeSubagent.mockResolvedValue({
      parentSessionId: "parent-1",
      subagentId: "subagent-1",
      childSessionId: "child-1",
      sessionLinkId: "link-1",
      label: "API surface check",
      closed: true,
      alreadyClosed: false,
      closedAt: "2026-05-13T18:03:42Z",
      activeWorkCloseMode: "finish_current_turn",
    });
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const runtimeUrl = "http://runtime-close.test";
    const { result } = renderHook(() => useCloseSubagentMutation(), {
      wrapper: createWrapper(queryClient, runtimeUrl),
    });

    await result.current.mutateAsync({
      parentSessionId: "parent-1",
      subagentId: "subagent-1",
      requestOptions: { headers: { "x-trace": "trace-close" } },
    });

    expect(mocks.closeSubagent).toHaveBeenCalledWith(
      "parent-1",
      "subagent-1",
      { headers: { "x-trace": "trace-close" } },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, "workspace-1", "parent-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: anyHarnessSessionKey(runtimeUrl, "workspace-1", "child-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: anyHarnessSessionsKey(runtimeUrl, "workspace-1"),
    });
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
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
