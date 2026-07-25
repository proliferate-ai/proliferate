// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  runtimeAvailability: "ready" as "connecting" | "ready" | "unavailable",
  isAgentSeedHydrating: false,
  localInstallState: "installed" as "installed" | "installing" | "install_required",
}));

const refreshCatalog = vi.hoisted(() => vi.fn());
const upsertOverride = vi.hoisted(() => vi.fn());
const refreshGatewayModels = vi.hoisted(() => vi.fn());
const refetchLaunchOptions = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const authSelectionsQuery = vi.hoisted(() => vi.fn());
const cloudCatalogQuery = vi.hoisted(() => vi.fn());
const gatewayModelsQuery = vi.hoisted(() => vi.fn());
const localLaunchOptionsHook = vi.hoisted(() => vi.fn());

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
}));

vi.mock("@/hooks/access/anyharness/agents/use-local-agent-launch-options", () => ({
  useLocalAgentLaunchOptions: (...args: unknown[]) => {
    localLaunchOptionsHook(...args);
    return {
      query: {
        ...state.launchOptions,
        refetch: refetchLaunchOptions,
      },
      availability: state.runtimeAvailability,
      isAgentSeedHydrating: state.isAgentSeedHydrating,
    };
  },
}));

vi.mock("@/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    agentsByKind: new Map([
      ["codex", { installState: state.localInstallState }],
    ]),
  }),
}));

vi.mock("@/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.cloudActive = false;
  state.runtimeAvailability = "ready";
  state.isAgentSeedHydrating = false;
  state.localInstallState = "installed";
  state.launchOptions.data = {
    agents: [{
      kind: "codex",
      displayName: "Codex",
      defaultModelId: "gpt-5.5",
      models: [{ id: "gpt-5.5", displayName: "GPT 5.5", isDefault: true }],
    }],
  };
  state.launchOptions.isLoading = false;
  state.launchOptions.isFetching = false;
  refetchLaunchOptions.mockImplementation(async () => ({
    data: state.launchOptions.data,
    isError: false,
  }));
});

afterEach(cleanup);

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
    expect(localLaunchOptionsHook).toHaveBeenCalledWith(true, true);

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
    expect(localLaunchOptionsHook).toHaveBeenCalledWith(false, false);
  });

  it("keeps refresh disabled while the local runtime is connecting", () => {
    state.runtimeAvailability = "connecting";

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.getByText("Local runtime is starting...")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Refresh$/ }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("keeps refresh disabled while Codex is updating automatically", () => {
    state.localInstallState = "installing";
    state.launchOptions.data = { agents: [] };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.getAllByText("Codex is updating automatically...")).toHaveLength(1);
    expect((screen.getByRole("button", { name: /^Refresh$/ }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(refetchLaunchOptions).not.toHaveBeenCalled();
  });

  it("uses generic setup copy during seed hydration", () => {
    state.isAgentSeedHydrating = true;
    state.launchOptions.data = { agents: [] };

    render(
      <HarnessAllModelsSection
        harnessKind="opencode"
        displayName="OpenCode"
        surface="local"
      />,
    );

    expect(screen.getAllByText("Local agent setup is finishing...")).toHaveLength(1);
    expect(screen.queryByText("OpenCode is updating automatically...")).toBeNull();
    expect((screen.getByRole("button", { name: /^Refresh$/ }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("distinguishes a failed runtime read from an agent with no ready models", async () => {
    refetchLaunchOptions.mockResolvedValueOnce({ data: undefined, isError: true });

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Local runtime unavailable — could not read Codex models.",
      );
    });

    showToast.mockClear();
    refetchLaunchOptions.mockResolvedValueOnce({
      data: { agents: [{ kind: "codex", displayName: "Codex", models: [] }] },
      isError: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Codex is not ready yet — finish setup before refreshing models.",
      );
    });
  });
});
