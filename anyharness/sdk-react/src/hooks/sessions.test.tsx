// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { useSessionQuery, useSetSessionConfigOptionMutation } from "./sessions.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  setConfigOption: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      get: mocks.getSession,
      setConfigOption: mocks.setConfigOption,
    },
  }),
}));

describe("sdk-react session config mutation request options", () => {
  afterEach(() => {
    cleanup();
    mocks.getSession.mockReset();
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

  it("can settle on transport acknowledgement while active invalidation remains deferred", async () => {
    const refetch = deferred<{ id: string }>();
    mocks.getSession
      .mockResolvedValueOnce({ id: "session-1" })
      .mockImplementationOnce(() => refetch.promise);
    mocks.setConfigOption.mockResolvedValue({
      applyState: "applied",
      session: { id: "session-1" },
    });
    const queryClient = createQueryClient();
    const controller = new AbortController();
    const { result } = renderHook(() => ({
      session: useSessionQuery("session-1"),
      mutation: useSetSessionConfigOptionMutation(),
    }), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.session.isSuccess).toBe(true));

    await act(async () => {
      await expect(result.current.mutation.mutateAsync({
        workspaceId: "workspace-1",
        sessionId: "session-1",
        request: { configId: "collaboration_mode", value: "plan" },
        requestOptions: { signal: controller.signal },
        awaitInvalidations: false,
      })).resolves.toMatchObject({ applyState: "applied" });
    });

    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
    expect(controller.signal.aborted).toBe(false);

    await act(async () => {
      refetch.resolve({ id: "session-1" });
      await refetch.promise;
    });

    expect(result.current.mutation.isSuccess).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  it("continues to await active invalidation by default", async () => {
    const refetch = deferred<{ id: string }>();
    mocks.getSession
      .mockResolvedValueOnce({ id: "session-1" })
      .mockImplementationOnce(() => refetch.promise);
    mocks.setConfigOption.mockResolvedValue({
      applyState: "applied",
      session: { id: "session-1" },
    });
    const queryClient = createQueryClient();
    const { result } = renderHook(() => ({
      session: useSessionQuery("session-1"),
      mutation: useSetSessionConfigOptionMutation(),
    }), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.session.isSuccess).toBe(true));

    let settled = false;
    let mutation!: ReturnType<typeof result.current.mutation.mutateAsync>;
    act(() => {
      mutation = result.current.mutation.mutateAsync({
        workspaceId: "workspace-1",
        sessionId: "session-1",
        request: { configId: "collaboration_mode", value: "plan" },
      });
      void mutation.then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);

    await act(async () => {
      refetch.resolve({ id: "session-1" });
      await mutation;
    });

    expect(settled).toBe(true);
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
  });
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
