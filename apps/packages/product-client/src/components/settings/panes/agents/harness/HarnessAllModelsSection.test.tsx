// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSnapshotStatus } from "@anyharness/sdk";
import { HarnessAllModelsSection } from "#product/components/settings/panes/agents/harness/HarnessAllModelsSection";

const state = vi.hoisted(() => ({
  cloudActive: false,
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
  agentModels: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: false,
  },
  modelSnapshotStatus: {
    data: undefined as ModelSnapshotStatus | undefined,
    isLoading: false,
  },
}));

const upsertOverride = vi.hoisted(() => vi.fn());
const refreshModelSnapshot = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());
const cloudAgentModelsQuery = vi.hoisted(() => vi.fn());
const launchOptionsQuery = vi.hoisted(() => vi.fn());
const modelSnapshotStatusQuery = vi.hoisted(() => vi.fn());

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useAgentModels: (...args: unknown[]) => {
    cloudAgentModelsQuery(...args);
    return state.agentModels;
  },
  useUpsertAgentModelOverride: () => ({ mutate: upsertOverride, isPending: false }),
}));

vi.mock("@anyharness/sdk-react", () => ({
  useAgentLaunchOptionsQuery: (...args: unknown[]) => {
    launchOptionsQuery(...args);
    return state.launchOptions;
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

function composedStatus(
  overrides: Partial<ModelSnapshotStatus> = {},
): ModelSnapshotStatus {
  return {
    agent: "codex",
    schemaVersion: 2,
    probeEngine: "owner",
    state: "idle",
    modelCount: 0,
    modeCount: 0,
    ...overrides,
  };
}

/**
 * §7's list is reference material, so the status row is also the disclosure and
 * the pane opens with it collapsed (agent-auth.md pane anatomy §7). The
 * collapsed subtree is aria-hidden, so role queries for the table's controls
 * need the row clicked first.
 */
function expandModelList() {
  fireEvent.click(screen.getByRole("button", { name: "Models" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.cloudActive = false;
  state.agentModels = { data: undefined, isLoading: false };
  state.modelSnapshotStatus = { data: undefined, isLoading: false };
});

describe("HarnessAllModelsSection local surface (the composed observation)", () => {
  it("renders the ONE composed observation: models, age, modes, and provenance", () => {
    state.modelSnapshotStatus = {
      data: composedStatus({
        probedAt: "2026-07-27T09:12:03Z",
        snapshotAgeSeconds: 90,
        modelCount: 2,
        modeCount: 1,
        models: [
          { id: "gpt-5.5", name: "GPT 5.5", provider: "openai" },
          { id: "grok-5", provider: "xai" },
        ] as unknown as ModelSnapshotStatus["models"],
        modes: [{ id: "build", name: "Build" }] as unknown as ModelSnapshotStatus["modes"],
        attestation: {
          name: "codex",
          version: "0.3.112",
        } as unknown as ModelSnapshotStatus["attestation"],
        installIdentity: {
          role: "agent_process",
          version: "1.18.3",
          source: "pinned_archive",
        } as unknown as ModelSnapshotStatus["installIdentity"],
      }),
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    // The observation's list is the menu — the seed does not backfill it.
    expect(screen.queryByText("GPT 5.5")).not.toBeNull();
    expect(screen.queryByText("grok-5")).not.toBeNull();
    expect(modelSnapshotStatusQuery).toHaveBeenCalledWith("codex", { enabled: true });
    // Seed fallback is not fetched once an observation exists.
    expect(launchOptionsQuery).toHaveBeenCalledWith({ enabled: false });
    // probedAt age suffix on the collapsed content line, no badge pile.
    expect(screen.queryByText(/refreshed 1m ago/)).not.toBeNull();
    expect(screen.queryByText(/shipped catalog, not probed yet/)).toBeNull();
    // Observation rows have no override endpoint: switches are on and disabled.
    expandModelList();
    // Diagnostics-only provenance + modes now render in the expanded body.
    expect(
      screen.queryByText("Observed by codex 0.3.112 · install 1.18.3 (pinned_archive)"),
    ).not.toBeNull();
    expect(screen.queryByText("Modes: Build")).not.toBeNull();
    for (const element of screen.getAllByRole("switch")) {
      expect((element as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("serves the shipped-catalog seed marked unverified before the first observation", () => {
    state.modelSnapshotStatus = {
      data: composedStatus(),
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(launchOptionsQuery).toHaveBeenCalledWith({ enabled: true });
    expandModelList();
    expect(screen.queryByText("GPT 5.5")).not.toBeNull();
    expect(screen.queryByText(/shipped catalog, not probed yet/)).not.toBeNull();
  });

  it("calls the param-less refresh route from the Refresh button, signed in or out", () => {
    state.modelSnapshotStatus = {
      data: composedStatus({
        probedAt: "2026-07-27T09:12:03Z",
        snapshotAgeSeconds: 30,
        models: [{ id: "gpt-5.5" }] as unknown as ModelSnapshotStatus["models"],
      }),
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ }));

    expect(refreshModelSnapshot).toHaveBeenCalledWith("codex", expect.anything());
    expect(upsertOverride).not.toHaveBeenCalled();
    // The local surface never touches the cloud layered read.
    expect(cloudAgentModelsQuery).toHaveBeenCalledWith("codex", false);
  });

  it("shows the refreshing state while the engine is queued or running", () => {
    state.modelSnapshotStatus = {
      data: composedStatus({ state: "running" }),
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    expect(screen.queryByText(/Probing…/)).not.toBeNull();
  });

  it("keeps the last-good observation with a failed-refresh indicator", () => {
    state.modelSnapshotStatus = {
      data: composedStatus({
        probedAt: "2026-07-27T08:00:00Z",
        snapshotAgeSeconds: 4000,
        models: [{ id: "gpt-5.5", name: "GPT 5.5" }] as unknown as ModelSnapshotStatus["models"],
        lastAttempt: {
          at: "2026-07-27T09:00:00Z",
          outcome: "failed",
          detail: "harness crashed",
        } as unknown as ModelSnapshotStatus["lastAttempt"],
        lastError: "harness crashed",
      }),
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="local"
      />,
    );

    // Never an empty picker: the last-good list keeps serving, with the
    // failed-refresh suffix taking priority over the freshness line.
    expandModelList();
    expect(screen.queryByText("GPT 5.5")).not.toBeNull();
    expect(screen.queryByText(/last refresh failed/)).not.toBeNull();
    expect(screen.queryByText(/refreshed 1h ago/)).toBeNull();
  });
});

describe("HarnessAllModelsSection cloud surface (the layered read)", () => {
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
    expect(cloudAgentModelsQuery).toHaveBeenCalledWith("codex", false);
  });

  it("renders the layered read with override toggles and no Refresh affordance", () => {
    state.cloudActive = true;
    state.agentModels = {
      data: {
        harnessKind: "codex",
        models: [
          { id: "gpt-5.5", displayName: "GPT 5.5", enabled: true },
          { id: "gpt-5.5-mini", displayName: "GPT 5.5 Mini", enabled: false },
        ],
        origin: "snapshot",
        probedAt: "2026-07-27T09:12:03Z",
      },
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="cloud"
      />,
    );

    expect(screen.queryByText("GPT 5.5")).not.toBeNull();
    // The context-free layered read: keyed by harness alone, no authContextId.
    expect(cloudAgentModelsQuery).toHaveBeenCalledWith("codex", true);
    // Ingest is Worker-authenticated only — no product-side refresh exists.
    expect(screen.queryByRole("button", { name: /^Refresh$/ })).toBeNull();
    expect(screen.queryByText(/shipped catalog, not probed yet/)).toBeNull();

    expandModelList();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(upsertOverride).toHaveBeenCalledTimes(1);
    expect(refreshModelSnapshot).not.toHaveBeenCalled();
  });

  it("marks the read-time catalog seed as unverified", () => {
    state.cloudActive = true;
    state.agentModels = {
      data: {
        harnessKind: "codex",
        models: [{ id: "gpt-5.5", displayName: "GPT 5.5", enabled: true }],
        origin: "catalog",
        probedAt: null,
      },
      isLoading: false,
    };

    render(
      <HarnessAllModelsSection
        harnessKind="codex"
        displayName="Codex"
        surface="cloud"
      />,
    );

    expect(screen.queryByText(/shipped catalog, not probed yet/)).not.toBeNull();
  });
});
