// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { useSetSessionConfigOptionMutation } from "./sessions.js";

const mocks = vi.hoisted(() => ({
  setConfigOption: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      setConfigOption: mocks.setConfigOption,
    },
  }),
}));

describe("sdk-react session config mutation request options", () => {
  afterEach(() => {
    cleanup();
    mocks.setConfigOption.mockReset();
  });

  it("passes caller abort signals to SessionsClient.setConfigOption", async () => {
    mocks.setConfigOption.mockResolvedValue({
      applyState: "applied",
      session: { id: "session-1" },
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const controller = new AbortController();
    const { result } = renderHook(() => useSetSessionConfigOptionMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        sessionId: "session-1",
        request: { configId: "collaboration_mode", value: "plan" },
        requestOptions: { signal: controller.signal },
      });
    });

    expect(mocks.setConfigOption).toHaveBeenCalledWith(
      "session-1",
      { configId: "collaboration_mode", value: "plan" },
      { signal: controller.signal },
    );
  });
});

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
