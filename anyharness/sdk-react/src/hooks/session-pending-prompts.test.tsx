// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  useReorderPendingPromptsMutation,
  useSteerPendingPromptMutation,
} from "./session-pending-prompts.js";

const mocks = vi.hoisted(() => ({
  reorderPendingPrompts: vi.fn(),
  steerPendingPrompt: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      reorderPendingPrompts: mocks.reorderPendingPrompts,
      steerPendingPrompt: mocks.steerPendingPrompt,
    },
  }),
}));

describe("pending prompt queue mutations", () => {
  beforeEach(() => {
    mocks.reorderPendingPrompts.mockReset();
    mocks.steerPendingPrompt.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("surfaces concurrent reorder and steer failures and refreshes authoritative state", async () => {
    mocks.reorderPendingPrompts.mockRejectedValueOnce(new Error("stale order"));
    mocks.steerPendingPrompt.mockRejectedValueOnce(new Error("interrupt degraded"));
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const rendered = renderHook(() => ({
      reorder: useReorderPendingPromptsMutation(),
      steer: useSteerPendingPromptMutation(),
    }), { wrapper: createWrapper(queryClient) });

    let outcomes: PromiseSettledResult<unknown>[] = [];
    await act(async () => {
      outcomes = await Promise.allSettled([
        rendered.result.current.reorder.mutateAsync({
          sessionId: "session-1",
          expectedSeqs: [1, 2],
          desiredSeqs: [2, 1],
        }),
        rendered.result.current.steer.mutateAsync({
          sessionId: "session-1",
          seq: 2,
        }),
      ]);
    });

    expect(mocks.reorderPendingPrompts).toHaveBeenCalledWith("session-1", {
      expectedSeqs: [1, 2],
      desiredSeqs: [2, 1],
    });
    expect(mocks.steerPendingPrompt).toHaveBeenCalledWith("session-1", 2);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ status: "rejected" });
    expect(outcomes[1]).toMatchObject({ status: "rejected" });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    for (const call of invalidate.mock.calls) {
      expect(call[0]).toMatchObject({
        queryKey: ["anyharness", "http://runtime.test", "session", "workspace-1", "session-1"],
      });
    }
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnyHarnessRuntime runtimeUrl="http://runtime.test">
          <AnyHarnessWorkspace
            workspaceId="workspace-1"
            resolveConnection={async () => ({
              runtimeUrl: "http://runtime.test",
              anyharnessWorkspaceId: "workspace-1",
            })}
          >
            {children}
          </AnyHarnessWorkspace>
        </AnyHarnessRuntime>
      </QueryClientProvider>
    );
  };
}
