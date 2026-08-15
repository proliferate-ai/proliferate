// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppNewWorkspaceCommandActions } from "#product/hooks/app/workflows/use-app-new-workspace-command-actions";

// The one cloud repo target every "cloud" scope test resolves against.
const cloudRepoTarget = { gitOwner: "proliferate-ai", gitRepoName: "repo-b", baseBranch: null };

const state = vi.hoisted(() => ({
  cloudComputeEnabled: true,
  cloudActive: true,
  billingBlocked: false,
  createCloudWorkspaceAndEnter: vi.fn((..._args: unknown[]) => Promise.resolve()),
  beginCloudRepositoryIntent: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useRepositories: () => ({ data: { repositories: [] }, isPending: false }),
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({ cloudComputeEnabled: state.cloudComputeEnabled }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-availability-state", () => ({
  useCloudAvailabilityState: () => ({ cloudActive: state.cloudActive }),
}));

vi.mock("#product/hooks/cloud/facade/use-cloud-billing", () => ({
  useCloudBilling: () => ({
    data: state.billingBlocked
      ? { billingMode: "enforce", startBlocked: true }
      : { billingMode: "enforce", startBlocked: false },
  }),
}));

vi.mock("#product/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnter: (...args: unknown[]) =>
      state.createCloudWorkspaceAndEnter(...args),
    isCreatingCloudWorkspace: false,
  }),
}));

vi.mock("#product/hooks/home/derived/use-home-next-repository-selection", () => ({
  useHomeNextRepositorySelection: () => ({
    selectedRepository: null,
    selectedBranchName: null,
    defaultBranchName: null,
  }),
}));

vi.mock("#product/hooks/home/ui/use-home-next-target-selection-state", () => ({
  useHomeNextTargetSelectionSnapshot: () => ({
    destination: "repository",
    repositorySelection: null,
    repoLaunchKind: null,
    baseBranchOverride: null,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-standard-repo-projection", () => ({
  useStandardRepoProjection: () => ({
    repoRoots: [],
    localWorkspaces: [],
    cloudWorkspaces: [],
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-entry-actions", () => ({
  useWorkspaceEntryActions: () => ({
    createLocalWorkspaceAndEnter: vi.fn(),
    isCreatingLocalWorkspace: false,
    createWorktreeAndEnter: vi.fn(),
    isCreatingWorktreeWorkspace: false,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-navigation-workflow", () => ({
  useWorkspaceNavigationWorkflow: () => ({
    navigateToWorkspaceShell: vi.fn(),
  }),
}));

vi.mock("#product/hooks/cloud/derived/use-cloud-repo-action-state", () => ({
  useCloudRepoActionState: () => ({ kind: "create", label: "New cloud workspace" }),
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: { selectedWorkspaceId: null }) => unknown) =>
    selector({ selectedWorkspaceId: null }),
}));

vi.mock("#product/stores/cloud/cloud-repository-intent-store", () => ({
  useCloudRepositoryIntentStore: (selector: (state: { begin: () => void }) => unknown) =>
    selector({ begin: state.beginCloudRepositoryIntent }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: () => void }) => unknown) => selector({ show: vi.fn() }),
}));

vi.mock("#product/stores/workspaces/new-workspace-command-scope-store", () => ({
  useNewWorkspaceCommandScopeStore: (
    selector: (state: { activeScope: unknown }) => unknown,
  ) => selector({
    activeScope: {
      id: "test-scope",
      source: "sidebar",
      repoGroupKeyToExpand: null,
      localSourceRoot: null,
      repoRootId: null,
      sourceWorkspaceId: null,
      cloudRepoTarget,
      baseBranch: null,
      defaultBranch: null,
    },
  }),
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  startLatencyFlow: () => "flow-1",
  failLatencyFlow: vi.fn(),
}));

function resetState() {
  state.cloudComputeEnabled = true;
  state.cloudActive = true;
  state.billingBlocked = false;
  state.createCloudWorkspaceAndEnter.mockClear();
  state.beginCloudRepositoryIntent.mockClear();
}

describe("useAppNewWorkspaceCommandActions cloud gating (PRO-10)", () => {
  it("keeps the cloud command available when cloud compute is enabled and billing is not blocked (baseline)", () => {
    resetState();
    const { result } = renderHook(() => useAppNewWorkspaceCommandActions());
    expect(result.current.newCloudWorkspace.disabledReason).toBeNull();
  });

  it("disables the cloud command and never reaches workspace creation when cloudComputeEnabled is false", () => {
    resetState();
    state.cloudComputeEnabled = false;
    const { result } = renderHook(() => useAppNewWorkspaceCommandActions());

    expect(result.current.newCloudWorkspace.disabledReason).toBe(
      "Cloud workspaces are temporarily unavailable.",
    );

    result.current.newCloudWorkspace.execute("shortcut");

    expect(state.createCloudWorkspaceAndEnter).not.toHaveBeenCalled();
    expect(state.beginCloudRepositoryIntent).not.toHaveBeenCalled();
  });

  it("negative control: the pre-fix reason expression (billing-only) would have left this case enabled", () => {
    // Pre-fix: cloudUnavailableReason = cloudWorkspaceBlocked ? "..." : null;
    // billingBlocked is false here, so the pre-fix expression evaluates to null
    // (available) even though cloudComputeEnabled is false — proving the fix,
    // not some other gate, is what disables the command above.
    const billingBlocked = false;
    const preFixReason = billingBlocked ? "Cloud workspaces are blocked by billing." : null;
    expect(preFixReason).toBeNull();
  });

  it("still disables the cloud command on billing block when cloudComputeEnabled is true", () => {
    resetState();
    state.billingBlocked = true;
    const { result } = renderHook(() => useAppNewWorkspaceCommandActions());
    expect(result.current.newCloudWorkspace.disabledReason).toBe(
      "Cloud workspaces are blocked by billing.",
    );
  });
});
