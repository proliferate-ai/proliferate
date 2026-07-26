// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSnapshotStatus } from "@anyharness/sdk";
import { HarnessAllModelsSection } from "#product/components/settings/panes/agents/harness/HarnessAllModelsSection";

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
  modelSnapshotStatus: {
    data: undefined as ModelSnapshotStatus | undefined,
    isLoading: false,
  },
}));

const refreshCatalog = vi.hoisted(() => vi.fn());
const upsertOverride = vi.hoisted(() => vi.fn());
const refreshGatewayModels = vi.hoisted(() => vi.fn());
const refreshModelSnapshot = vi.hoisted(() => vi.fn());
const refetchLaunchOptions = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const authSelectionsQuery = vi.hoisted(() => vi.fn());
const cloudCatalogQuery = vi.hoisted(() => vi.fn());
const gatewayModelsQuery = vi.hoisted(() => vi.fn());
const launchOptionsQuery = vi.hoisted(() => vi.fn());
const modelSnapshotStatusQuery = vi.hoisted(() => vi.fn());

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
  useModelSnapshotStatusQuery: (...args: unknown[]) => {
    modelSnapshotStatusQuery(...args);
    return state.modelSnapshotStatus;
  },
  useRefreshModelSnapshotMutation: () => ({
    mutate: refreshModelSnapshot,
    isPending: false,
  }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (value: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.modelSnapshotStatus = { data: undefined, isLoading: false };
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
    expect(refreshModelSnapshot).not.toHaveBeenCalled();
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

describe("HarnessAllModelsSection staleness badge (runtime-gateway path)", () => {
  it("drives BOTH the legacy gateway-models refresh and the model-snapshot refresh on click, so the badge is not permanently stuck (C3-R1)", () => {
    state.cloudActive = true;
    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshGatewayModels).toHaveBeenCalledWith("codex", expect.anything());
    expect(refreshModelSnapshot).toHaveBeenCalledWith(
      { kind: "codex", authContextId: "gateway" },
      expect.anything(),
    );
  });

  it("polls the model-snapshot status route only for the signed-in local+gateway path", () => {
    state.cloudActive = true;
    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(modelSnapshotStatusQuery).toHaveBeenCalledWith("codex", { enabled: true });
  });

  it("renders the refreshing badge while the gateway context is queued or running", () => {
    state.cloudActive = true;
    state.modelSnapshotStatus = {
      data: {
        agent: "codex",
        schemaVersion: 1,
        probeEngine: "owner",
        installIdentity: null,
        contexts: [{
          authContextId: "gateway",
          active: true,
          state: "running",
          identityComparable: true,
          modelCount: 3,
          modeCount: 1,
          stale: false,
        }],
      },
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText("refreshing…")).not.toBeNull();
    expect(screen.queryByText("needs refresh")).toBeNull();
    expect(screen.queryByText(/^refreshed /)).toBeNull();
  });

  it("renders the needs-refresh badge when the gateway context is stale", () => {
    state.cloudActive = true;
    state.modelSnapshotStatus = {
      data: {
        agent: "codex",
        schemaVersion: 1,
        probeEngine: "owner",
        installIdentity: null,
        contexts: [{
          authContextId: "gateway",
          active: true,
          state: "idle",
          identityComparable: true,
          modelCount: 3,
          modeCount: 1,
          stale: true,
        }],
      },
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText("needs refresh")).not.toBeNull();
    expect(screen.queryByText("refreshing…")).toBeNull();
    expect(screen.queryByText(/^refreshed /)).toBeNull();
  });

  it("renders the refreshed-ago badge when the gateway context is idle, fresh, and has an age", () => {
    state.cloudActive = true;
    state.modelSnapshotStatus = {
      data: {
        agent: "codex",
        schemaVersion: 1,
        probeEngine: "owner",
        installIdentity: null,
        contexts: [{
          authContextId: "gateway",
          active: true,
          state: "idle",
          identityComparable: true,
          modelCount: 3,
          modeCount: 1,
          stale: false,
          snapshotAgeSeconds: 90,
        }],
      },
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText("refreshed 1m ago")).not.toBeNull();
    expect(screen.queryByText("needs refresh")).toBeNull();
    expect(screen.queryByText("refreshing…")).toBeNull();
  });

  it("renders no badge when the status document has no matching context yet", () => {
    state.cloudActive = true;
    state.modelSnapshotStatus = { data: undefined, isLoading: false };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText("needs refresh")).toBeNull();
    expect(screen.queryByText("refreshing…")).toBeNull();
    expect(screen.queryByText(/^refreshed /)).toBeNull();
  });
});
