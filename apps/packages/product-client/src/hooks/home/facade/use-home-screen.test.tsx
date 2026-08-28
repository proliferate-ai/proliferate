// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeScreen } from "#product/hooks/home/facade/use-home-screen";

const mocks = vi.hoisted(() => ({
  readyAgents: [{ kind: "claude", displayName: "Claude" }],
  agentsLoading: false,
  navigate: vi.fn(),
  openAddRepoFlow: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({
    data: { repositories: [] },
    isPending: false,
  }),
}));

vi.mock("#product/hooks/agents/derived/use-agent-catalog", () => ({
  useAgentCatalog: () => ({
    readyAgents: mocks.readyAgents,
    isLoading: mocks.agentsLoading,
  }),
}));

vi.mock("#product/hooks/agents/lifecycle/use-auth-setup-onboarding-evidence", () => ({
  useAuthSetupOnboardingEvidence: () => null,
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: false }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({ isAddingRepo: false }),
}));

vi.mock("#product/stores/ui/add-repo-flow-store", () => ({
  useAddRepoFlowStore: (selector: (state: { openFlow: () => void }) => unknown) =>
    selector({ openFlow: mocks.openAddRepoFlow }),
}));

vi.mock("#product/hooks/workspaces/derived/use-standard-repo-projection", () => ({
  useStandardRepoProjection: () => ({
    localWorkspaces: [],
    repoRoots: [],
    isLoading: false,
  }),
}));

vi.mock("#product/stores/preferences/user-preferences-store", () => ({
  useUserPreferencesStore: (
    selector: (state: { defaultChatAgentKind: string }) => unknown,
  ) => selector({ defaultChatAgentKind: "claude" }),
}));

vi.mock("#product/stores/preferences/workspace-ui-store", () => ({
  useWorkspaceUiStore: (
    selector: (state: { hiddenRepoRootIds: string[] }) => unknown,
  ) => selector({ hiddenRepoRootIds: [] }),
}));

describe("useHomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgents = [{ kind: "claude", displayName: "Claude" }];
    mocks.agentsLoading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("carries no dismissal state — the readiness card has no dismiss affordance", () => {
    const { result } = renderHook(() => useHomeScreen());

    expect(result.current).not.toHaveProperty("modelProbeInputs");
    expect(result.current).not.toHaveProperty("dismissModelProbeCard");
  });

  // D-R1/D-R2 fix: the readiness card now lives in its own hook
  // (useHomeInstallationReadiness), sourced from the reconcile job
  // snapshot rather than this facade's stale agents-list read. This facade
  // no longer carries readyAgents/installingAgents at all — asserting their
  // absence catches a regression back to the removed, job-blind source.
  it("no longer exposes readyAgents/installingAgents — the readiness card is sourced elsewhere", () => {
    const { result } = renderHook(() => useHomeScreen());

    expect(result.current).not.toHaveProperty("readyAgents");
    expect(result.current).not.toHaveProperty("installingAgents");
  });
});

describe("useHomeScreen agent-settings routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgents = [
      { kind: "claude", displayName: "Claude" },
      { kind: "codex", displayName: "Codex" },
    ];
    mocks.agentsLoading = false;
  });
  afterEach(() => cleanup());

  it("opens the pane of the harness it was handed, not always Claude", () => {
    // The terminal "no agents are supported" notice justifies itself by
    // showing WHICH agents are unsupported. Sending every caller to the
    // Claude pane makes that false whenever Claude is not the one: that pane
    // only reports it has not been observed.
    const { result } = renderHook(() => useHomeScreen());
    act(() => result.current.handleHomeAction("agent-settings", { harnessKind: "cursor" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings?section=agent-cursor");

    // No harness named, and an unmappable one, both keep the old default.
    act(() => result.current.handleHomeAction("agent-settings"));
    act(() => result.current.handleHomeAction("agent-settings", { harnessKind: "nope" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/settings?section=agent-claude");
  });
});
