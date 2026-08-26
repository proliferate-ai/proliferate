// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRepoActionDialogHost } from "#product/components/workspace/repo-setup/CloudRepoActionDialogHost";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";
import type { CloudRepositoryIntent } from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";

// The live mutable readiness inputs the host reads. `configured` is what the
// host derives from `useRepositories`; flipping it mid-flight simulates the
// environment-save query invalidation that flips `cloudEnvironmentConfigured`
// under the running continuation (the B1 regression).
const state = vi.hoisted(() => ({
  authorized: true,
  authorityStatus: "ready" as string,
  managedCloud: "ready" as string,
  githubAccess: "ready" as string,
  cloudComputeEnabled: true,
  configured: false,
  reflectSaveInRepositories: true,
  authorityEnabled: false,
  saveCloudEnvironment: vi.fn((_args?: unknown) => Promise.resolve<unknown>(undefined)),
  authorityRefetch: vi.fn(() => Promise.resolve({})),
  showRepoAddedToast: vi.fn(),
  cloneRepo: vi.fn((..._args: unknown[]) =>
    Promise.resolve<unknown>({ succeeded: true, sourceRoot: "/Users/dev/src/repo-b" })),
}));

function repositoriesData() {
  return {
    repositories: state.configured
      ? [{
          id: "repo-config-1",
          gitProvider: "github",
          gitOwner: "proliferate-ai",
          gitRepoName: "repo-b",
          environments: [{
            id: "env-1",
            repoConfigId: "repo-config-1",
            kind: "cloud",
            desktopInstallId: null,
            localPath: null,
            defaultBranch: "main",
            setupScript: "",
            runCommand: "",
          }],
        }]
      : [],
  };
}

vi.mock("@proliferate/cloud-sdk-react", () => ({
  useCloudClient: () => ({ baseUrl: "https://cloud.test" }),
  useGitHubRepoAuthority: (_input: unknown, enabled: boolean) => {
    state.authorityEnabled = enabled;
    return ({
    data: { authorized: state.authorized, status: state.authorityStatus },
    isPending: false,
    isError: state.authorityStatus === "error",
    refetch: state.authorityRefetch,
    });
  },
  useRepositories: () => ({ data: repositoriesData(), isPending: false }),
  useSaveRepoEnvironment: () => ({
    mutateAsync: (args: unknown) => {
      // Mirror the real save: mark the environment configured (as if the
      // repositories query were invalidated + refetched) BEFORE resolving, so
      // the host re-renders with a flipped readiness flag while the
      // continuation promise is still in flight.
      return state.saveCloudEnvironment(args).then((result: unknown) => {
        if (!state.reflectSaveInRepositories) {
          return result;
        }
        act(() => {
          state.configured = true;
          bumpRepositories();
        });
        return result;
      });
    },
  }),
  useValidateCloudRepoBranches: () => ({
    mutateAsync: () => Promise.resolve({ defaultBranch: "main" }),
  }),
  githubAppRootKey: () => ["github-app"],
  repositoriesKey: () => ["repositories"],
}));

// Force the host to re-render when repositories data changes mid-flight.
let bumpRepositories = () => {};
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("#product/domain/environments/cloud-environments", () => ({
  buildMinimalCloudEnvironmentConfigRequest: (branch: string) => ({ defaultBranch: branch }),
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
    cloudComputeEnabled: state.cloudComputeEnabled,
    managedCloudStatus: state.managedCloud,
    githubRepositoryAccessStatus: state.githubAccess,
    githubRepositoryAccessDisplayName: "proliferate-app",
  }),
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => "authenticated",
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { name: "Acme", membership: { role: "admin" } },
    activeOrganizationId: "org-1",
  }),
}));

vi.mock("#product/lib/domain/settings/admin-roles", () => ({
  isSettingsAdminRole: () => true,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    links: { buildReturnUrl: () => "proliferate://return" },
    clipboard: { writeText: vi.fn() },
  }),
}));

vi.mock("#product/hooks/settings/workflows/use-github-app-user-authorization", () => ({
  useGitHubAppUserAuthorization: () => ({ authorize: vi.fn(), authorizing: false, error: null }),
}));

vi.mock("#product/hooks/settings/workflows/use-github-app-installation", () => ({
  useGitHubAppInstallation: () => ({
    install: vi.fn(),
    openInstallationSettings: vi.fn(),
    installing: false,
    error: null,
  }),
}));

// Stub the clone hook (which otherwise pulls in the AnyHarnessRuntime provider).
vi.mock("#product/hooks/workspaces/workflows/use-clone-repo", () => ({
  useCloneRepo: () => ({
    cloneRepo: (...args: unknown[]) => state.cloneRepo(...args),
    isCloning: false,
  }),
}));

// The receipt itself is tested at its own hook; here we assert WHICH receipt
// each completion path reports, so keep the real builder and spy on the show.
vi.mock("#product/hooks/workspaces/ui/use-repo-added-toast", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#product/hooks/workspaces/ui/use-repo-added-toast")
  >()),
  useRepoAddedToast: () => state.showRepoAddedToast,
}));

vi.mock("#product/lib/domain/settings/github-app-copy", () => ({
  buildCloudAdminRequestMessage: () => "request",
}));

// Keep the Dialog kit inline so its body renders in jsdom without a portal.
vi.mock("#product/primitives/Dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const setupIntent: CloudRepositoryIntent = {
  kind: "create_cloud_workspace",
  repo: { gitProvider: "github", gitOwner: "proliferate-ai", gitRepoName: "repo-b" },
  continuation: { repoGroupKeyToExpand: null, baseBranch: null },
};

const addIntent: CloudRepositoryIntent = {
  kind: "add_cloud_repository",
  repo: { gitProvider: "github", gitOwner: "proliferate-ai", gitRepoName: "repo-b" },
};

function resetState() {
  state.authorized = true;
  state.authorityStatus = "ready";
  state.managedCloud = "ready";
  state.githubAccess = "ready";
  state.cloudComputeEnabled = true;
  state.configured = false;
  state.reflectSaveInRepositories = true;
  state.authorityEnabled = false;
  state.saveCloudEnvironment.mockClear();
  state.saveCloudEnvironment.mockImplementation(() => Promise.resolve());
  state.authorityRefetch.mockClear();
  state.showRepoAddedToast.mockClear();
  state.cloneRepo.mockClear();
  state.cloneRepo.mockImplementation(() =>
    Promise.resolve({ succeeded: true, sourceRoot: "/Users/dev/src/repo-b" }));
}

describe("CloudRepoActionDialogHost", () => {
  beforeEach(() => {
    resetState();
    useCloudRepositoryIntentStore.setState({ activeIntent: null });
    useAddRepoFlowStore.setState({
      open: false,
      step: { kind: "entry" },
      onCompleted: null,
    });
  });

  afterEach(() => {
    cleanup();
    useCloudRepositoryIntentStore.setState({ activeIntent: null });
    useAddRepoFlowStore.setState({
      open: false,
      step: { kind: "entry" },
      onCompleted: null,
    });
  });

  it("clears the intent and closes on success even when the readiness flag flips mid-flight (B1)", async () => {
    let rerender = () => {};
    function Harness() {
      const [, setTick] = requireState();
      bumpRepositories = () => setTick((n) => n + 1);
      rerender = bumpRepositories;
      return <CloudRepoActionDialogHost />;
    }

    render(<Harness />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(addIntent);
    });
    rerender();

    await waitFor(() => {
      expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);
    });
    // Terminal success clears the intent (dialog closes) despite the flag flip.
    await waitFor(() => {
      expect(useCloudRepositoryIntentStore.getState().activeIntent).toBeNull();
    });
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("surfaces an error with a retry when the continuation fails (S2)", async () => {
    state.saveCloudEnvironment.mockImplementation(() =>
      Promise.reject(new Error("Save failed")));

    let rerender = () => {};
    function Harness() {
      const [, setTick] = requireState();
      bumpRepositories = () => setTick((n) => n + 1);
      rerender = bumpRepositories;
      return <CloudRepoActionDialogHost />;
    }

    render(<Harness />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    rerender();

    expect(await screen.findByText("Couldn't finish Cloud setup")).toBeTruthy();
    expect(await screen.findByText("Save failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The intent stays for retry.
    expect(useCloudRepositoryIntentStore.getState().activeIntent).not.toBeNull();
  });

  it("saves the environment once and refuses a stale create-workspace intent without re-saving on retry (PR2-RETRY-07, cull part 2)", async () => {
    state.reflectSaveInRepositories = false;

    let rerender = () => {};
    function Harness() {
      const [, setTick] = requireState();
      bumpRepositories = () => setTick((n) => n + 1);
      rerender = bumpRepositories;
      return <CloudRepoActionDialogHost />;
    }

    render(<Harness />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    rerender();

    // The cloud workspace stack is deleted: the create arm refuses, and the
    // host surfaces its normal error blocker.
    expect(await screen.findByText("Cloud workspaces are no longer available.")).toBeTruthy();
    expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });

    // Retry refuses again without recreating the already-saved environment.
    expect(await screen.findByText("Cloud workspaces are no longer available.")).toBeTruthy();
    expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);
    expect(useCloudRepositoryIntentStore.getState().activeIntent).not.toBeNull();
  });

  it("does not query repository authority while either managed-cloud operator capability is incomplete (PR2-AUTHORITY-06)", () => {
    state.githubAccess = "operator_configuration_required";
    render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    expect(state.authorityEnabled).toBe(false);
  });

  it("does not query repository authority when cloud compute is disabled even with every other gate ready (PRO-10)", () => {
    // Negative control: with cloudComputeEnabled left at its default true and
    // every other gate ready, authority IS queried (proves the assertion below
    // is actually keyed on cloudComputeEnabled, not some other flag).
    state.cloudComputeEnabled = true;
    const { unmount } = render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    expect(state.authorityEnabled).toBe(true);
    unmount();
    useCloudRepositoryIntentStore.setState({ activeIntent: null });

    // Now flip only cloudComputeEnabled to false: the belt-and-braces gate in
    // requiredOperatorReady must block authority the same way an incomplete
    // operator capability does.
    state.cloudComputeEnabled = false;
    render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    expect(state.authorityEnabled).toBe(false);
  });

  it("completes Add Repository only after the shared readiness host saves the environment", async () => {
    const onCompleted = vi.fn();
    useAddRepoFlowStore.setState({
      open: false,
      step: { kind: "cloud" },
      onCompleted,
    });
    const intent: CloudRepositoryIntent = {
      kind: "add_cloud_repository",
      repo: setupIntent.repo,
    };

    render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(intent);
    });

    await waitFor(() => {
      expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);
      expect(onCompleted).toHaveBeenCalledWith({
        kind: "cloud",
        repoId: "proliferate-ai/repo-b",
      });
      expect(useCloudRepositoryIntentStore.getState().activeIntent).toBeNull();
    });
    expect(useAddRepoFlowStore.getState().onCompleted).toBeNull();
  });

  it("reports the Added receipt when a cloud registration lands", async () => {
    // The flow's own onEnvironmentAdded never runs for a handed-off cloud add,
    // so this is the ONLY place the user can be told the repository arrived.
    useAddRepoFlowStore.setState({ open: false, step: { kind: "cloud" }, onCompleted: null });

    render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin({
        kind: "add_cloud_repository",
        repo: setupIntent.repo,
      });
    });

    await waitFor(() => {
      expect(state.showRepoAddedToast).toHaveBeenCalledWith({
        repoName: "repo-b",
        sourceRoot: "cloud:proliferate-ai/repo-b",
        source: "cloud",
      });
    });
  });

  it("reports the Added receipt with the checkout path when a clone lands", async () => {
    useAddRepoFlowStore.setState({ open: false, step: { kind: "clone" }, onCompleted: null });

    render(<CloudRepoActionDialogHost />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin({
        kind: "clone_from_github",
        repo: setupIntent.repo,
      });
    });

    await waitFor(() => {
      expect(state.showRepoAddedToast).toHaveBeenCalledWith({
        repoName: "repo-b",
        sourceRoot: "/Users/dev/src/repo-b",
        source: "local",
      });
    });
  });

  it("shows progress, not operator copy, while the environment is being configured (S1)", async () => {
    // Fully-configured deployment; gate resolves to 9 (env save pending) then
    // 10. The host must never render the operator-not-configured copy.
    let rerender = () => {};
    // Hold the save open so we observe the in-progress state.
    let resolveSave!: () => void;
    state.saveCloudEnvironment.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSave = () => resolve(); }));

    function Harness() {
      const [, setTick] = requireState();
      bumpRepositories = () => setTick((n) => n + 1);
      rerender = bumpRepositories;
      return <CloudRepoActionDialogHost />;
    }

    render(<Harness />);
    act(() => {
      useCloudRepositoryIntentStore.getState().begin(addIntent);
    });
    rerender();

    await waitFor(() => {
      expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status").textContent).toMatch(/Preparing this repository/);
    expect(screen.queryByText(/is not configured on this deployment/)).toBeNull();
    expect(screen.queryByText(/isn't fully configured/)).toBeNull();

    act(() => { resolveSave(); });
    await waitFor(() => {
      expect(useCloudRepositoryIntentStore.getState().activeIntent).toBeNull();
    });
  });
});

// A local useState so the harness can force re-renders when repositories data
// flips mid-flight.
function requireState() {
  return useState(0);
}
