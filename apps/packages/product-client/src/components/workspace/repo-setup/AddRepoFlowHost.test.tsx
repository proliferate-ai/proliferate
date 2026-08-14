// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import type {
  AddRepoFlowOption,
  AddRepoFlowProps,
} from "#product/components/workspace/repo-setup/AddRepoFlow";
import type {
  DesktopBridge,
  DirectoryPickerResult,
} from "@proliferate/product-client/host/desktop-bridge";
import { AddRepoFlowHost } from "#product/components/workspace/repo-setup/AddRepoFlowHost";
import type { CloudRepoPickerProps } from "#product/lib/domain/workspaces/cloud/cloud-repo-picker-view";
import { useAddRepoFlowStore } from "#product/stores/ui/add-repo-flow-store";
import { useCloudRepositoryIntentStore } from "#product/stores/cloud/cloud-repository-intent-store";

// PR2-GATING-01: Add Repository's cloud path routes through the shared readiness
// resolver. On an operator-incomplete deployment the cloud step must show the
// operator-must-configure explanation and NEVER the older prerequisite model's
// "Authorize GitHub App" user-auth CTA.

const capabilities = vi.hoisted(() => ({
  value: {
    githubRepositoryAccessStatus: "ready" as string,
    managedCloudStatus: "ready" as string,
    githubRepositoryAccessDisplayName: "proliferate-app" as string | null,
  },
}));

const auth = vi.hoisted(() => ({ status: "authenticated" as string }));
const cloudHook = vi.hoisted(() => ({
  onRepositorySelected: null as null | ((repo: { gitOwner: string; gitRepoName: string }) => void),
  legacyManual: vi.fn(),
  clonePicker: null as CloudRepoPickerProps | null,
  cloudPicker: null as CloudRepoPickerProps | null,
  // What the stubbed picker currently reports as its own prerequisite blocker;
  // a test clears it to stand for "GitHub is connected now".
  blocker: undefined as CloudRepoPickerProps["blocker"],
  // What the entry step was told about the one-time GitHub connection.
  githubConnected: undefined as boolean | undefined,
}));

// The user-authorization status query: `data` is undefined while it loads.
const githubStatus = vi.hoisted(() => ({
  data: { connected: true } as { connected: boolean } | undefined,
}));
const productHost = vi.hoisted(() => ({
  desktop: null as DesktopBridge | null,
}));
const addRepoHook = vi.hoisted(() => ({
  addRepoFromPath: vi.fn(),
}));
const addRepoFlow = vi.hoisted(() => ({
  onPickOption: null as null | ((option: AddRepoFlowOption) => void),
}));

// The OLD prerequisite-model blocker useAddCloudEnvironment produces: a
// user-auth CTA. If the resolver gate did not take precedence, this is what
// would render on an operator-incomplete deployment (the exact bug).
const OLD_PREREQ_BLOCKER = {
  title: "Authorize GitHub App",
  description: "Authorize the Proliferate GitHub App.",
  actionLabel: "Authorize GitHub App",
  onAction: vi.fn(),
};

vi.mock("#product/hooks/capabilities/derived/use-app-capabilities", () => ({
  useAppCapabilities: () => capabilities.value,
}));

vi.mock("#product/hooks/auth/facade/use-product-auth", () => ({
  useProductAuthStatus: () => auth.status,
}));

vi.mock("#product/hooks/workspaces/workflows/use-add-cloud-environment", () => ({
  useAddCloudEnvironment: (input: {
    onRepositorySelected?: (repo: { gitOwner: string; gitRepoName: string }) => void;
    onCopyText: (value: string) => void | Promise<void>;
  }): CloudRepoPickerProps => {
    if (input.onRepositorySelected) {
      cloudHook.onRepositorySelected = input.onRepositorySelected;
    }
    return {
      query: "",
      manualValue: "acme/manual-clone",
      repositories: [],
      blocker: cloudHook.blocker,
      onQueryChange: vi.fn(),
      onManualValueChange: vi.fn(),
      onAddRepository: vi.fn(),
      onAddManual: cloudHook.legacyManual,
      onLoadMore: vi.fn(),
    };
  },
}));

vi.mock("#product/hooks/workspaces/workflows/use-add-repo", () => ({
  useAddRepo: () => ({
    addRepoFromPath: addRepoHook.addRepoFromPath,
    isAddingRepo: false,
  }),
}));

// Stub the clone hook (which otherwise pulls in the AnyHarnessRuntime provider);
// these gating tests only exercise the cloud path, not the clone path.
vi.mock("#product/hooks/workspaces/workflows/use-clone-repo", () => ({
  useCloneRepo: () => ({
    cloneRepo: vi.fn(() => Promise.resolve({ succeeded: true, sourceRoot: "/tmp/clone" })),
    isCloning: false,
  }),
}));

vi.mock("#product/hooks/organizations/facade/use-active-organization", () => ({
  useActiveOrganization: () => ({
    activeOrganization: { name: "Acme", membership: { role: "member" } },
    activeOrganizationId: "org-1",
  }),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: productHost.desktop,
    links: { buildReturnUrl: () => "https://app.test/return", openExternal: vi.fn() },
    clipboard: { writeText: vi.fn(async () => undefined) },
  }),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

// The controller's own GitHub reads: the entry footnote's authorization status
// and the check-again invalidation. Neither is what these gating tests are
// about, so both are stubbed at their package boundary.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

vi.mock("@proliferate/cloud-sdk-react", () => ({
  githubAppRootKey: () => ["github-app"],
  repositoriesKey: () => ["repositories"],
  useCloudClient: () => ({ baseUrl: "https://api.test" }),
  useGitHubAppUserAuthorizationStatus: () => ({ data: githubStatus.data }),
}));

// Expose the resolved cloudPicker.blocker title the host hands the flow.
vi.mock("#product/components/workspace/repo-setup/AddRepoFlow", () => ({
  AddRepoFlow: ({
    step,
    cloudPicker,
    clonePicker,
    error,
    githubConnected,
    onPickOption,
  }: AddRepoFlowProps) => {
    const picker = step.kind === "clone" ? clonePicker : cloudPicker;
    cloudHook.githubConnected = githubConnected;
    cloudHook.clonePicker = clonePicker ?? null;
    cloudHook.cloudPicker = cloudPicker ?? null;
    addRepoFlow.onPickOption = onPickOption;
    return (
      <div>
        {picker?.blocker ? `blocker:${picker.blocker.title}` : "no-blocker"}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  },
}));

beforeEach(() => {
  cloudHook.blocker = OLD_PREREQ_BLOCKER;
});

afterEach(() => {
  cleanup();
  capabilities.value = {
    githubRepositoryAccessStatus: "ready",
    managedCloudStatus: "ready",
    githubRepositoryAccessDisplayName: "proliferate-app",
  };
  auth.status = "authenticated";
  cloudHook.onRepositorySelected = null;
  cloudHook.clonePicker = null;
  cloudHook.cloudPicker = null;
  cloudHook.blocker = OLD_PREREQ_BLOCKER;
  cloudHook.githubConnected = undefined;
  githubStatus.data = { connected: true };
  OLD_PREREQ_BLOCKER.onAction.mockClear();
  cloudHook.legacyManual.mockClear();
  productHost.desktop = null;
  addRepoHook.addRepoFromPath.mockReset();
  addRepoFlow.onPickOption = null;
  useAddRepoFlowStore.setState({ open: false, step: { kind: "entry" }, onCompleted: null });
  useCloudRepositoryIntentStore.setState({ activeIntent: null });
});

function openCloudStep() {
  act(() => {
    useAddRepoFlowStore.setState({ open: true, step: { kind: "cloud" }, onCompleted: null });
  });
}

function openCloneStep() {
  act(() => {
    useAddRepoFlowStore.setState({ open: true, step: { kind: "clone" }, onCompleted: null });
  });
}

function desktopWithPicker(result: DirectoryPickerResult): DesktopBridge {
  return {
    files: {
      pickDirectory: vi.fn().mockResolvedValue(result),
    },
  } as unknown as DesktopBridge;
}

describe("AddRepoFlowHost cloud gating (PR2-GATING-01)", () => {
  it("replaces the prerequisite user-auth CTA with the operator explanation when the deployment is operator-incomplete", () => {
    capabilities.value = {
      githubRepositoryAccessStatus: "operator_configuration_required",
      managedCloudStatus: "operator_configuration_required",
      githubRepositoryAccessDisplayName: "proliferate-app",
    };
    render(<AddRepoFlowHost />);
    openCloudStep();

    // The resolver's gate-1 operator blocker replaces the old "Authorize
    // GitHub App" CTA — the user never sees the user-auth CTA.
    expect(screen.getByText(/^blocker:Cloud is not configured on this deployment$/)).toBeTruthy();
    expect(screen.queryByText(/blocker:Authorize GitHub App/)).toBeNull();
  });

  it("shows the operator explanation for a self-managed deployment with add-ons disabled (the t2intent stack's wire: both capabilities \"disabled\", no App slug)", () => {
    // Mirrors tests/intent/specs/workspace-entry.spec.ts's booted deployment:
    // boot.ts seeds no GITHUB_APP_* config, so /meta serves both cloud
    // capabilities "disabled" with a null displayName (capability-contract.spec
    // T2-SH-5). The preflight must still stop at gate 1 with the null-slug copy.
    capabilities.value = {
      githubRepositoryAccessStatus: "disabled",
      managedCloudStatus: "disabled",
      githubRepositoryAccessDisplayName: null,
    };
    render(<AddRepoFlowHost />);
    openCloudStep();

    expect(screen.getByText(/^blocker:Cloud is not configured on this deployment$/)).toBeTruthy();
    expect(screen.queryByText(/blocker:Authorize GitHub App/)).toBeNull();
  });

  it("shows the sign-in blocker (not the user-auth CTA) when signed out", () => {
    auth.status = "anonymous";
    render(<AddRepoFlowHost />);
    openCloudStep();

    expect(screen.getByText(/^blocker:Sign in to continue$/)).toBeTruthy();
    expect(screen.queryByText(/blocker:Authorize GitHub App/)).toBeNull();
  });

  it("defers to the picker's own prerequisite blocker once operator config and sign-in are satisfied", () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    // Gates 1 and 2 satisfied: the picker (per-repo authority) owns the rest,
    // so its prerequisite blocker is what surfaces.
    expect(screen.getByText(/^blocker:Authorize GitHub App$/)).toBeTruthy();
  });

  it("hands a selected repository to the shared ordered-readiness host", () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    act(() => {
      cloudHook.onRepositorySelected?.({ gitOwner: "Acme", gitRepoName: "Rocket" });
    });

    expect(useAddRepoFlowStore.getState().open).toBe(false);
    expect(useCloudRepositoryIntentStore.getState().activeIntent).toEqual({
      kind: "add_cloud_repository",
      repo: {
        gitProvider: "github",
        gitOwner: "Acme",
        gitRepoName: "Rocket",
      },
    });
  });

  it("keeps the completion callback alive across the cloud handoff", () => {
    // Regression: the handoff used to run the store's close(), which nulls
    // `onCompleted` — so the callback was already gone by the time
    // CloudRepoActionDialogHost finished the registration and read it.
    const onCompleted = vi.fn();
    render(<AddRepoFlowHost />);
    act(() => {
      useAddRepoFlowStore.getState().openFlow({ onCompleted });
      useAddRepoFlowStore.getState().setStep({ kind: "cloud" });
    });

    act(() => {
      cloudHook.onRepositorySelected?.({ gitOwner: "Acme", gitRepoName: "Rocket" });
    });

    expect(useAddRepoFlowStore.getState().open).toBe(false);
    expect(useAddRepoFlowStore.getState().onCompleted).toBe(onCompleted);
  });

  it("keeps the completion callback alive across the clone handoff", () => {
    const onCompleted = vi.fn();
    render(<AddRepoFlowHost />);
    act(() => {
      useAddRepoFlowStore.getState().openFlow({ onCompleted });
      useAddRepoFlowStore.getState().setStep({ kind: "clone" });
    });

    act(() => cloudHook.clonePicker?.onAddManual());

    expect(useAddRepoFlowStore.getState().open).toBe(false);
    expect(useAddRepoFlowStore.getState().onCompleted).toBe(onCompleted);
  });

  it("gates Clone on GitHub repository access, not managed Cloud", () => {
    capabilities.value = {
      githubRepositoryAccessStatus: "ready",
      managedCloudStatus: "disabled",
      githubRepositoryAccessDisplayName: "proliferate-app",
    };
    render(<AddRepoFlowHost />);
    openCloneStep();

    // The GitHub-only preflight is ready, so the picker owns the next gate.
    expect(screen.getByText(/^blocker:Authorize GitHub App$/)).toBeTruthy();
  });

  it("shows the operator blocker before Clone when GitHub access is disabled", () => {
    capabilities.value = {
      githubRepositoryAccessStatus: "disabled",
      managedCloudStatus: "ready",
      githubRepositoryAccessDisplayName: null,
    };
    render(<AddRepoFlowHost />);
    openCloneStep();

    expect(screen.getByText(/^blocker:GitHub repository access is not configured$/)).toBeTruthy();
    expect(screen.queryByText(/blocker:Authorize GitHub App/)).toBeNull();
  });

  it("routes manual owner/repo entry to the clone intent, never Cloud setup", () => {
    render(<AddRepoFlowHost />);
    openCloneStep();

    act(() => cloudHook.clonePicker?.onAddManual());

    expect(cloudHook.legacyManual).not.toHaveBeenCalled();
    expect(useCloudRepositoryIntentStore.getState().activeIntent).toEqual({
      kind: "clone_from_github",
      repo: {
        gitProvider: "github",
        gitOwner: "acme",
        gitRepoName: "manual-clone",
      },
    });
  });
});

describe("AddRepoFlowHost waiting on GitHub", () => {
  it("parks on the waiting panel once the checklist CTA has sent the user to GitHub", () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    expect(cloudHook.cloudPicker?.blocker?.waiting).toBeUndefined();

    act(() => {
      cloudHook.cloudPicker?.blocker?.onAction?.();
    });

    // The CTA still runs — the waiting panel is in addition to opening GitHub,
    // not instead of it.
    expect(OLD_PREREQ_BLOCKER.onAction).toHaveBeenCalled();
    expect(cloudHook.cloudPicker?.blocker?.waiting?.title)
      .toBe("Finish authorizing on GitHub");
    expect(cloudHook.cloudPicker?.blocker?.waiting?.checkAgainLabel)
      .toBe("I've done this — Check again");
  });

  it("leaves the waiting panel on Cancel without re-querying", () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    act(() => {
      cloudHook.cloudPicker?.blocker?.onAction?.();
    });
    act(() => {
      cloudHook.cloudPicker?.blocker?.waiting?.onCancel();
    });

    expect(cloudHook.cloudPicker?.blocker?.waiting).toBeUndefined();
  });

  it("re-checks on demand and confirms arrival once nothing blocks the picker", async () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    act(() => {
      cloudHook.cloudPicker?.blocker?.onAction?.();
    });
    await act(async () => {
      cloudHook.cloudPicker?.blocker?.waiting?.onCheckAgain();
      await Promise.resolve();
    });

    // Still blocked (the stubbed picker never clears its prerequisite), so no
    // premature "connected" claim — but the waiting panel is done.
    await waitFor(() => {
      expect(cloudHook.cloudPicker?.blocker?.waiting).toBeUndefined();
    });
    expect(cloudHook.cloudPicker?.connectedBanner).toBeNull();
  });

  it("confirms the connection when a background refetch clears the blocker, with no Check again", async () => {
    // The user departs for GitHub, finishes there, and comes back to a window
    // that has already refetched on focus. Nothing was pressed in-app, so a
    // banner gated on the manual re-check would never fire — and the picker
    // would look like a bare list that never acknowledged the work.
    render(<AddRepoFlowHost />);
    openCloudStep();

    act(() => {
      cloudHook.cloudPicker?.blocker?.onAction?.();
    });
    // The refetch has landed: the picker has no prerequisite left to report.
    cloudHook.blocker = undefined;
    act(() => {
      useAddRepoFlowStore.setState({ step: { kind: "cloud" } });
    });

    await waitFor(() => {
      expect(cloudHook.cloudPicker?.connectedBanner)
        .toBe("GitHub connected. Choose a repository.");
    });
    // And the waiting panel is not left parked, ready to resurrect on a later
    // blocker as a panel about a trip already made.
    expect(cloudHook.cloudPicker?.blocker?.waiting).toBeUndefined();
  });

  it("confirms the connection on arrival once the re-check clears the blocker", async () => {
    render(<AddRepoFlowHost />);
    openCloudStep();

    act(() => {
      cloudHook.cloudPicker?.blocker?.onAction?.();
    });
    // Standing in for the user having finished on GitHub: the next render's
    // picker has no prerequisite left to report.
    cloudHook.blocker = undefined;
    await act(async () => {
      cloudHook.cloudPicker?.blocker?.waiting?.onCheckAgain();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(cloudHook.cloudPicker?.connectedBanner)
        .toBe("GitHub connected. Choose a repository.");
    });
  });
});

describe("AddRepoFlowHost entry footnote", () => {
  it("does not warn about connecting GitHub while the status is still unknown", () => {
    // The status query has not resolved. Treating that as "not connected"
    // flashed "Clone and Cloud need a one-time GitHub connection" at every
    // already-connected user, every time they opened the menu.
    githubStatus.data = undefined;
    render(<AddRepoFlowHost />);
    act(() => {
      useAddRepoFlowStore.setState({ open: true, step: { kind: "entry" } });
    });

    expect(cloudHook.githubConnected).toBe(true);
  });

  it("warns once the status actually says GitHub is unconnected", () => {
    githubStatus.data = { connected: false };
    render(<AddRepoFlowHost />);
    act(() => {
      useAddRepoFlowStore.setState({ open: true, step: { kind: "entry" } });
    });

    expect(cloudHook.githubConnected).toBe(false);
  });
});

describe("AddRepoFlowHost local directory picker", () => {
  it.each([
    [
      "native_host_required",
      "Open the Desktop app to choose a local folder.",
    ],
    [
      "picker_failed",
      "The folder picker is unavailable right now. Try again.",
    ],
  ] as const)("explains the %s picker failure", async (reason, message) => {
    productHost.desktop = desktopWithPicker({ kind: "unavailable", reason });
    render(<AddRepoFlowHost />);

    act(() => {
      useAddRepoFlowStore.setState({ open: true, step: { kind: "entry" } });
      addRepoFlow.onPickOption?.("add-existing-folder");
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(message);
    });
    expect(addRepoHook.addRepoFromPath).not.toHaveBeenCalled();
  });

  it("keeps a normal native picker cancellation silent", async () => {
    productHost.desktop = desktopWithPicker({ kind: "cancelled" });
    render(<AddRepoFlowHost />);

    await act(async () => {
      useAddRepoFlowStore.setState({ open: true, step: { kind: "entry" } });
      addRepoFlow.onPickOption?.("add-existing-folder");
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(addRepoHook.addRepoFromPath).not.toHaveBeenCalled();
  });
});
