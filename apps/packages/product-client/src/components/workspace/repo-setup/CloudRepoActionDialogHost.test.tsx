// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRepoActionDialogHost } from "#product/components/workspace/repo-setup/CloudRepoActionDialogHost";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";
import type { CloudRepositoryIntent } from "#product/lib/domain/workspaces/cloud/cloud-repository-intent";

// The live mutable readiness inputs the host reads. `configured` is what the
// host derives from `useRepositories`; flipping it mid-flight simulates the
// environment-save query invalidation that flips `cloudEnvironmentConfigured`
// under the running continuation (the B1 regression).
const state = vi.hoisted(() => ({
  authorized: true,
  authorityStatus: "ready" as string,
  managedCloud: "ready" as string,
  githubAccess: "ready" as string,
  configured: false,
  saveCloudEnvironment: vi.fn((_args?: unknown) => Promise.resolve<unknown>(undefined)),
  createCloudWorkspace: vi.fn((..._args: unknown[]) => Promise.resolve()),
  authorityRefetch: vi.fn(() => Promise.resolve({})),
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
  useGitHubRepoAuthority: () => ({
    data: { authorized: state.authorized, status: state.authorityStatus },
    isPending: false,
    isError: state.authorityStatus === "error",
    refetch: state.authorityRefetch,
  }),
  useRepositories: () => ({ data: repositoriesData(), isPending: false }),
  useSaveRepoEnvironment: () => ({
    mutateAsync: (args: unknown) => {
      // Mirror the real save: mark the environment configured (as if the
      // repositories query were invalidated + refetched) BEFORE resolving, so
      // the host re-renders with a flipped readiness flag while the
      // continuation promise is still in flight.
      return state.saveCloudEnvironment(args).then((result: unknown) => {
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

vi.mock("@proliferate/product-domain/environments/cloud-environments", () => ({
  buildMinimalCloudEnvironmentConfigRequest: (branch: string) => ({ defaultBranch: branch }),
}));

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => ({
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

vi.mock("#product/hooks/cloud/workflows/use-create-cloud-workspace", () => ({
  useCreateCloudWorkspace: () => ({
    createCloudWorkspaceAndEnter: (...args: unknown[]) => state.createCloudWorkspace(...args),
  }),
}));

// The clone path is exercised elsewhere; here we only need the host to mount, so
// stub the clone hook (which otherwise pulls in the AnyHarnessRuntime provider).
vi.mock("#product/hooks/workspaces/workflows/use-clone-repo", () => ({
  useCloneRepo: () => ({
    cloneRepo: vi.fn(() => Promise.resolve({ succeeded: true, sourceRoot: "/tmp/clone" })),
    isCloning: false,
  }),
}));

vi.mock("#product/lib/domain/settings/github-app-copy", () => ({
  buildCloudAdminRequestMessage: () => "request",
}));

// Keep the Dialog kit inline so its body renders in jsdom without a portal.
vi.mock("@proliferate/ui/kit/Dialog", () => ({
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

function resetState() {
  state.authorized = true;
  state.authorityStatus = "ready";
  state.managedCloud = "ready";
  state.githubAccess = "ready";
  state.configured = false;
  state.saveCloudEnvironment.mockClear();
  state.saveCloudEnvironment.mockImplementation(() => Promise.resolve());
  state.createCloudWorkspace.mockClear();
  state.createCloudWorkspace.mockImplementation(() => Promise.resolve());
  state.authorityRefetch.mockClear();
}

describe("CloudRepoActionDialogHost", () => {
  beforeEach(() => {
    resetState();
    useCloudRepositoryIntentStore.setState({ activeIntent: null });
  });

  afterEach(() => {
    cleanup();
    useCloudRepositoryIntentStore.setState({ activeIntent: null });
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
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
    });
    rerender();

    await waitFor(() => {
      expect(state.saveCloudEnvironment).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(state.createCloudWorkspace).toHaveBeenCalledTimes(1);
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
      useCloudRepositoryIntentStore.getState().begin(setupIntent);
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
