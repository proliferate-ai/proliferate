// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeScreen } from "#product/hooks/home/facade/use-home-screen";

const mocks = vi.hoisted(() => ({
  readyAgents: [{ kind: "claude", displayName: "Claude" }],
  installingAgents: [{ kind: "codex", displayName: "Codex" }],
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
    installingAgents: mocks.installingAgents,
    isLoading: mocks.agentsLoading,
  }),
}));

vi.mock("#product/hooks/agents/lifecycle/use-auth-setup-onboarding-step", () => ({
  useAuthSetupOnboardingStep: () => "hidden",
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

describe("useHomeScreen per-agent readiness passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readyAgents = [{ kind: "claude", displayName: "Claude" }];
    mocks.installingAgents = [{ kind: "codex", displayName: "Codex" }];
    mocks.agentsLoading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("exposes the catalog's ready and installing agents for the readiness card", () => {
    const { result } = renderHook(() => useHomeScreen());

    expect(result.current.readyAgents).toEqual([{ kind: "claude", displayName: "Claude" }]);
    expect(result.current.installingAgents).toEqual([{ kind: "codex", displayName: "Codex" }]);
  });

  it("carries no dismissal state — the readiness card has no dismiss affordance", () => {
    const { result } = renderHook(() => useHomeScreen());

    expect(result.current).not.toHaveProperty("modelProbeInputs");
    expect(result.current).not.toHaveProperty("dismissModelProbeCard");
  });
});
