// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCredentialsBridge } from "@proliferate/product-client/host/desktop-bridge";

import { useAgentCredentialsStore } from "@/stores/agents/agent-credentials-store";
import { useLocalAgentCredentials } from "./use-local-agent-credentials";

const hostState = vi.hoisted(() => ({
  credentials: null as DesktopCredentialsBridge | null,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: hostState.credentials
      ? { localCredentials: hostState.credentials }
      : null,
  }),
}));

function makeCredentials(): DesktopCredentialsBridge {
  return {
    listConfigured: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  };
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  hostState.credentials = null;
  useAgentCredentialsStore.getState().clearRestartRequired();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLocalAgentCredentials", () => {
  it("does not query and rejects writes when Desktop credentials are absent", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLocalAgentCredentials(), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.configuredEnvVarNames).toEqual([]);
    await expect(result.current.saveCredential("OPENAI_API_KEY", "secret"))
      .rejects.toThrow("only available in Desktop");
  });

  it("lists, saves, and removes credentials through the Desktop bridge", async () => {
    const credentials = makeCredentials();
    vi.mocked(credentials.listConfigured).mockResolvedValue(["OPENAI_API_KEY"]);
    vi.mocked(credentials.set).mockResolvedValue(undefined);
    vi.mocked(credentials.remove).mockResolvedValue(undefined);
    hostState.credentials = credentials;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLocalAgentCredentials(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.configuredEnvVarNames).toEqual(["OPENAI_API_KEY"]);
    });
    await act(async () => {
      await result.current.saveCredential("OPENAI_API_KEY", "secret");
      await result.current.deleteCredential("OPENAI_API_KEY");
    });

    expect(credentials.set).toHaveBeenCalledWith("OPENAI_API_KEY", "secret");
    expect(credentials.remove).toHaveBeenCalledWith("OPENAI_API_KEY");
    expect(useAgentCredentialsStore.getState().restartRequired).toBe(true);
  });
});
