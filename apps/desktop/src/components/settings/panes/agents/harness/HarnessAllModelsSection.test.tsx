// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessAllModelsSection } from "./HarnessAllModelsSection";

const state = vi.hoisted(() => ({
  cloudActive: false,
  selections: {
    data: [{
      id: "cached-gateway-selection",
      harnessKind: "codex",
      surface: "local",
      sourceKind: "gateway",
      apiKeyId: null,
      keyTitle: null,
      envVarName: null,
      providerHint: null,
      enabled: true,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    }],
  },
  launchOptions: {
    data: {
      agents: [{
        kind: "codex",
        displayName: "Codex",
        defaultModelId: "gpt-5.5",
        models: [{ id: "gpt-5.5", displayName: "GPT 5.5", isDefault: true }],
      }],
    },
    isLoading: false,
    isFetching: false,
  },
  gatewayModels: {
    data: {
      models: [{ id: "cloud-only", displayName: "Cloud-only model" }],
      source: "seed",
    },
    isLoading: false,
  },
}));

const refreshCatalog = vi.hoisted(() => vi.fn());
const upsertOverride = vi.hoisted(() => vi.fn());
const refreshGatewayModels = vi.hoisted(() => vi.fn());
const refetchLaunchOptions = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const authSelectionsQuery = vi.hoisted(() => vi.fn());
const cloudCatalogQuery = vi.hoisted(() => vi.fn());
const gatewayModelsQuery = vi.hoisted(() => vi.fn());
const launchOptionsQuery = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAuthSelections: (...args: unknown[]) => {
    authSelectionsQuery(...args);
    return state.selections;
  },
  useAgentCatalog: (...args: unknown[]) => {
    cloudCatalogQuery(...args);
    return { data: undefined, isLoading: false };
  },
  useRefreshAgentCatalog: () => ({ mutate: refreshCatalog, isPending: false }),
  useUpsertCatalogOverride: () => ({ mutate: upsertOverride, isPending: false }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentGatewayModelsQuery: (...args: unknown[]) => {
    gatewayModelsQuery(...args);
    return state.gatewayModels;
  },
  useRefreshAgentGatewayModelsMutation: () => ({
    mutate: refreshGatewayModels,
    isPending: false,
  }),
  useAgentLaunchOptionsQuery: (...args: unknown[]) => {
    launchOptionsQuery(...args);
    return {
      ...state.launchOptions,
      refetch: refetchLaunchOptions,
    };
  },
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
});

describe("HarnessAllModelsSection signed-out behavior", () => {
  it("lists local runtime models read-only and refreshes without Cloud mutations", () => {
    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText("GPT 5.5")).not.toBeNull();
    expect(screen.queryByText("Cloud-only model")).toBeNull();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect(authSelectionsQuery).toHaveBeenCalledWith(null, false);
    expect(cloudCatalogQuery).toHaveBeenCalledWith(
      { harnessKind: "codex", surface: "local", route: "native" },
      false,
    );
    expect(gatewayModelsQuery).toHaveBeenCalledWith("codex", { enabled: false });
    expect(launchOptionsQuery).toHaveBeenCalledWith({ enabled: true });

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refetchLaunchOptions).toHaveBeenCalledTimes(1);
    expect(refreshCatalog).not.toHaveBeenCalled();
    expect(upsertOverride).not.toHaveBeenCalled();
    expect(refreshGatewayModels).not.toHaveBeenCalled();
  });

  it("keeps the signed-out Cloud surface gated", () => {
    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="cloud"
      />,
    );

    expect(screen.queryByText("GPT 5.5")).toBeNull();
    expect(
      screen.queryByText(
        "Sign in to Proliferate Cloud to manage how Codex authenticates to models.",
      ),
    ).not.toBeNull();
    expect(cloudCatalogQuery).toHaveBeenCalledWith(
      { harnessKind: "codex", surface: "cloud", route: "gateway" },
      false,
    );
    expect(gatewayModelsQuery).toHaveBeenCalledWith("codex", { enabled: false });
    expect(launchOptionsQuery).toHaveBeenCalledWith({ enabled: false });
  });
});
