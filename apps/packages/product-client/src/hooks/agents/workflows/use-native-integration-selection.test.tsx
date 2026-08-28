// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeIntegrationsResponse } from "@anyharness/sdk";
import { nativeIntegrationsKey } from "#product/hooks/access/anyharness/agents/use-native-integrations-query";
import { useNativeIntegrations } from "#product/hooks/agents/derived/use-native-integrations";
import { useNativeIntegrationSelection } from "#product/hooks/agents/workflows/use-native-integration-selection";

const clientMocks = vi.hoisted(() => ({
  listNativeIntegrations: vi.fn(),
  setNativeIntegrationSelection: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAnyHarnessCacheScopeKey: () => "test-scope",
  getAnyHarnessClient: () => ({ agents: clientMocks }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string; connectionState: string }) => unknown,
  ) => selector({ runtimeUrl: "http://127.0.0.1:8457", connectionState: "healthy" }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector(toastMocks),
}));

const refreshedListing: NativeIntegrationsResponse = {
  agentKind: "codex",
  integrations: [
    {
      id: "bundle:computer-use",
      agentKind: "codex",
      kind: "bundle",
      displayName: "Computer Use",
      available: true,
      risk: "desktop_control",
      enabled: true,
    },
  ],
  staleSelections: [],
};

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, wrapper };
}

describe("useNativeIntegrationSelection", () => {
  beforeEach(() => {
    clientMocks.listNativeIntegrations.mockReset();
    clientMocks.setNativeIntegrationSelection.mockReset();
    toastMocks.show.mockReset();
  });
  afterEach(cleanup);

  it("PUTs the flipped selection to the harness's integration route", async () => {
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(refreshedListing);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNativeIntegrationSelection("codex"), { wrapper });

    act(() => {
      result.current.setEnabled({
        integrationId: "bundle:computer-use",
        enabled: true,
        displayName: "Computer Use",
      });
    });

    await waitFor(() =>
      expect(clientMocks.setNativeIntegrationSelection).toHaveBeenCalledWith(
        "codex",
        "bundle:computer-use",
        true,
      ),
    );
  });

  it("stores the PUT's refreshed listing so the section rerenders without a refetch", async () => {
    clientMocks.setNativeIntegrationSelection.mockResolvedValue(refreshedListing);
    // The invalidate after the write triggers one background refetch of the
    // now-observed listing; answer it with the same fresh state.
    clientMocks.listNativeIntegrations.mockResolvedValue(refreshedListing);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        listing: useNativeIntegrations("codex", true),
        selection: useNativeIntegrationSelection("codex"),
      }),
      { wrapper },
    );

    const onSettled = vi.fn();
    act(() => {
      result.current.selection.setEnabled(
        {
          integrationId: "bundle:computer-use",
          enabled: true,
          displayName: "Computer Use",
        },
        { onSettled },
      );
    });

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(
      queryClient.getQueryData(
        nativeIntegrationsKey("http://127.0.0.1:8457", "test-scope", "codex"),
      ),
    ).toEqual(refreshedListing);
    await waitFor(() => expect(result.current.listing.rows[0]?.enabled).toBe(true));
    expect(toastMocks.show).not.toHaveBeenCalled();
  });

  it("reports a failed write as a toast naming the integration, not the raw id", async () => {
    clientMocks.setNativeIntegrationSelection.mockRejectedValue(new Error("boom"));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useNativeIntegrationSelection("codex"), { wrapper });

    act(() => {
      result.current.setEnabled({
        integrationId: "bundle:computer-use",
        enabled: true,
        displayName: "Computer Use",
      });
    });

    await waitFor(() =>
      expect(toastMocks.show).toHaveBeenCalledWith("Could not update Computer Use."),
    );
  });
});
