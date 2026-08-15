// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessError, type Workspace } from "@anyharness/sdk";
import { useWorkspaceArchiveActions } from "#product/hooks/workspaces/workflows/use-workspace-archive-actions";
import { useRepoPreferencesStore } from "#product/stores/preferences/repo-preferences-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const mocks = vi.hoisted(() => ({
  archiveWorkspace: vi.fn(),
  unarchiveWorkspace: vi.fn(),
  invalidateActiveCollections: vi.fn(async () => undefined),
  handleSelectWorkspace: vi.fn(),
  navigate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/workspaces", () => ({
  archiveWorkspace: (...args: unknown[]) => mocks.archiveWorkspace(...args),
  unarchiveWorkspace: (...args: unknown[]) => mocks.unarchiveWorkspace(...args),
}));

vi.mock("#product/hooks/workspaces/cache/use-workspace-collections-invalidation", () => ({
  useWorkspaceCollectionsInvalidation: () => mocks.invalidateActiveCollections,
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: {
      workspaces: [
        { id: "w1", repoRootId: "root-1", path: "/tmp/root-1/w1" } as unknown as Workspace,
      ],
      repoRoots: [{ id: "root-1", path: "/tmp/root-1" }],
    },
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-sidebar-actions", () => ({
  useWorkspaceSidebarActions: () => ({ handleSelectWorkspace: mocks.handleSelectWorkspace }),
}));

vi.mock("#product/stores/sessions/harness-connection-store", () => ({
  useHarnessConnectionStore: (
    selector: (state: { runtimeUrl: string }) => unknown,
  ) => selector({ runtimeUrl: "http://localhost:7007" }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("#product/primitives/utils/show-toast", () => ({
  showToast: (...args: unknown[]) => mocks.showToast(...args),
}));

function archivedError(code: string) {
  return new AnyHarnessError({ type: "about:blank", title: "Conflict", status: 409, code });
}

let queryClient: QueryClient;

function renderActions() {
  queryClient = new QueryClient();
  return renderHook(() => useWorkspaceArchiveActions(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useRepoPreferencesStore.setState({ repoConfigs: {} });
  useUserPreferencesStore.setState({ deleteBranchOnArchive: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useWorkspaceArchiveActions — archive success (T1)", () => {
  it("hides the row optimistically, then raises T1 with Undo + View archived and no description when there is no notice", async () => {
    mocks.archiveWorkspace.mockResolvedValue({ record: {}, notices: [] });
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(true);

    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.title).toBe('Archived "my-workspace"');
    expect(toastInput.description).toBeUndefined();
    expect(toastInput.secondary.label).toBe("Undo");
    expect(toastInput.commit.label).toBe("View archived");
    // T1 auto-dismisses — Undo is an expiring convenience, not a held-open
    // decision, so the toast must carry a finite dwell.
    expect(Number.isFinite(toastInput.duration)).toBe(true);
  });

  it("keeps the row hidden through the list refetch window: T1 fires at settle but the hide releases only when invalidation resolves", async () => {
    mocks.archiveWorkspace.mockResolvedValue({ record: {}, notices: [] });
    let releaseInvalidation!: () => void;
    mocks.invalidateActiveCollections.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        releaseInvalidation = () => resolve(undefined);
      }),
    );
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    // The POST settles and T1 fires — but the active list is still the stale
    // pre-archive snapshot, so releasing the hide here would flash the row.
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(1));
    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(true);
    // Settled means decided: the reconciler must no longer see this id, or a
    // poll tick inside the refetch window would raise a second T1.
    expect(result.current.pendingDecisionIds.has("w1")).toBe(false);

    act(() => releaseInvalidation());
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  // The other half of the sidebar's id-space contract (see MainSidebar's
  // "archives the runtime workspace id" test): whatever id `archive()` is
  // handed is the id the runtime verb addresses AND the id the click-time
  // knobs are resolved from — a logical sidebar id would match no runtime
  // record here, so it would silently lose the repo's archive script on its
  // way to a 404.
  it("posts /archive against the id it was handed and resolves that record's knobs", async () => {
    mocks.archiveWorkspace.mockResolvedValue({ record: {}, notices: [] });
    useRepoPreferencesStore.setState({
      repoConfigs: {
        "/tmp/root-1": {
          defaultBranch: null,
          setupScript: "",
          runCommand: "",
          archiveScript: "echo archiving",
          rerunSetupOnUnarchive: true,
        },
      },
    });
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    expect(mocks.archiveWorkspace).toHaveBeenCalledWith(
      { runtimeUrl: "http://localhost:7007" },
      "w1",
      { deleteBranch: false, archiveScript: "echo archiving" },
    );
  });

  it("carries a warning description when the response has a dirty_submodule notice", async () => {
    mocks.archiveWorkspace.mockResolvedValue({
      record: {},
      notices: [{ kind: "dirty_submodule" }],
    });
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.description).toMatch(/submodule/i);
  });

  it("Undo posts /unarchive and reselects when the workspace was selected", async () => {
    mocks.archiveWorkspace.mockResolvedValue({ record: {}, notices: [] });
    mocks.unarchiveWorkspace.mockResolvedValue({ record: {}, notices: [] });
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", true);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    const toastInput = mocks.showToast.mock.calls[0][0];
    await act(async () => {
      toastInput.secondary.onClick();
      await Promise.resolve();
    });

    expect(mocks.unarchiveWorkspace).toHaveBeenCalledWith(
      { runtimeUrl: "http://localhost:7007" },
      "w1",
      expect.any(Object),
    );
    expect(mocks.handleSelectWorkspace).toHaveBeenCalledWith("w1");
  });
});

describe("useWorkspaceArchiveActions — optimistic-set settle rules", () => {
  it("reinstates the row and raises the matching toast on a phase-1 typed error (T6 example)", async () => {
    mocks.archiveWorkspace.mockRejectedValue(archivedError("WORKSPACE_UNBORN_HEAD"));
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.title).toBe('Couldn\'t archive "my-workspace"');
    expect(toastInput.description).toMatch(/first commit/i);
    expect(toastInput.isError).toBe(true);
  });

  it("reinstates the row on a settled generic (non-2xx) failure too", async () => {
    mocks.archiveWorkspace.mockRejectedValue(new Error("network exploded"));
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it("reinstates the row on an aborted request", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    mocks.archiveWorkspace.mockRejectedValue(abortError);
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it("leaves a timed-out request's id pending and raises NO toast", async () => {
    mocks.archiveWorkspace.mockReturnValue(new Promise(() => {
      // never settles within the test
    }));
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    // Still pending — the reconciler (not this hook) is the decider now.
    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(true);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceArchiveActions — reconciler callbacks", () => {
  it("confirmArchived fires T1 late for the timeout-then-success case", async () => {
    mocks.archiveWorkspace.mockReturnValue(new Promise(() => {}));
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(true);

    act(() => {
      result.current.confirmArchived("w1");
    });

    // Decided immediately (the reconciler must not re-confirm it), hidden
    // until the list invalidation resolves (same no-flash rule as the
    // immediate-success path).
    expect(result.current.pendingDecisionIds.has("w1")).toBe(false);
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    expect(mocks.showToast.mock.calls[0][0].title).toBe('Archived "my-workspace"');
  });

  it("reinstateOptimistic clears the pending id and raises no toast", async () => {
    mocks.archiveWorkspace.mockReturnValue(new Promise(() => {}));
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    act(() => {
      result.current.reinstateOptimistic("w1");
    });

    expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceArchiveActions — failure toast mapping (T4-T10)", () => {
  const cases: Array<{ code: string; titleMatch: RegExp; descriptionMatch: RegExp; persistent: boolean }> = [
    {
      code: "WORKSPACE_GIT_OPERATION_IN_PROGRESS",
      titleMatch: /Couldn't archive/,
      descriptionMatch: /git operation in progress/i,
      persistent: true,
    },
    {
      code: "WORKSPACE_UNBORN_HEAD",
      titleMatch: /Couldn't archive/,
      descriptionMatch: /first commit/i,
      persistent: true,
    },
    {
      code: "WORKSPACE_HOLLOW_CHECKOUT",
      titleMatch: /Couldn't archive/,
      descriptionMatch: /own git checkout/i,
      persistent: true,
    },
    {
      code: "WORKSPACE_ARCHIVE_FAILED",
      titleMatch: /Couldn't archive/,
      descriptionMatch: /Couldn't save the snapshot/i,
      persistent: true,
    },
    {
      code: "WORKSPACE_OPERATION_IN_FLIGHT",
      titleMatch: /is busy/,
      descriptionMatch: /Try again in a moment/i,
      persistent: false,
    },
  ];

  for (const testCase of cases) {
    it(`maps ${testCase.code}`, async () => {
      mocks.archiveWorkspace.mockRejectedValue(archivedError(testCase.code));
      const { result } = renderActions();

      act(() => {
        result.current.archive("w1", "my-workspace", false);
      });
      await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

      const toastInput = mocks.showToast.mock.calls[0][0];
      expect(toastInput.title).toMatch(testCase.titleMatch);
      expect(toastInput.description).toMatch(testCase.descriptionMatch);
      if (testCase.persistent) {
        expect(toastInput.isError).toBe(true);
      } else {
        expect(toastInput.duration).toBeDefined();
      }
    });
  }

  it("maps WORKSPACE_GIT_LOCKED with the {file} interpolation (T10)", async () => {
    const error = new AnyHarnessError(
      { type: "about:blank", title: "Conflict", status: 409, code: "WORKSPACE_GIT_LOCKED" },
      undefined,
      undefined,
    );
    (error.problem as { extra?: unknown }).extra = { file: "index.lock" };
    mocks.archiveWorkspace.mockRejectedValue(error);
    const { result } = renderActions();

    act(() => {
      result.current.archive("w1", "my-workspace", false);
    });
    await waitFor(() => expect(result.current.optimisticallyArchivedIds.has("w1")).toBe(false));

    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.description).toContain("index.lock");
  });
});

describe("useWorkspaceArchiveActions — unarchive success (T2) and T11", () => {
  it("raises T2 with View now and a conditional description for no_snapshot", async () => {
    mocks.unarchiveWorkspace.mockResolvedValue({
      record: {},
      notices: [{ kind: "no_snapshot" }],
    });
    const { result } = renderActions();

    await act(async () => {
      result.current.unarchive("w1", "my-workspace");
      await Promise.resolve();
    });

    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.title).toBe('Unarchived "my-workspace"');
    expect(toastInput.description).toMatch(/no prior snapshot/i);
    expect(toastInput.commit.label).toBe("View now");
    // T2 auto-dismisses like T1 — View now is an expiring convenience.
    expect(Number.isFinite(toastInput.duration)).toBe(true);
  });

  it("raises the persistent T11 mismatch toast instead of T2 when head_mismatch is present", async () => {
    mocks.unarchiveWorkspace.mockResolvedValue({
      record: {},
      notices: [{ kind: "head_mismatch" }],
    });
    const { result } = renderActions();

    await act(async () => {
      result.current.unarchive("w1", "my-workspace");
      await Promise.resolve();
    });

    expect(mocks.showToast).toHaveBeenCalledTimes(1);
    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.title).toBe('Restored "my-workspace", with a mismatch');
    expect(toastInput.isError).toBe(true);
    expect(toastInput.commit.label).toBe("View now");
  });

  it("maps WORKSPACE_UNARCHIVE_FAILED to the persistent T8 toast with Retry", async () => {
    mocks.unarchiveWorkspace.mockRejectedValue(archivedError("WORKSPACE_UNARCHIVE_FAILED"));
    const { result } = renderActions();

    await act(async () => {
      result.current.unarchive("w1", "my-workspace");
      await Promise.resolve();
    });

    const toastInput = mocks.showToast.mock.calls[0][0];
    expect(toastInput.title).toBe('Couldn\'t restore "my-workspace"');
    expect(toastInput.isError).toBe(true);
    expect(toastInput.secondary.label).toBe("Retry");
  });

  it("captures a WORKSPACE_UNARCHIVE_SCENARIO 409 into scenario state instead of a toast", async () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "WORKSPACE_UNARCHIVE_SCENARIO",
    });
    (error.problem as { extra?: unknown }).extra = {
      scenario: "branch_diverged",
      strategies: ["recreate_at_sha", "restore_detached"],
    };
    mocks.unarchiveWorkspace.mockRejectedValue(error);
    const { result } = renderActions();

    await act(async () => {
      result.current.unarchive("w1", "my-workspace");
      await Promise.resolve();
    });

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(result.current.scenario).toMatchObject({
      workspaceId: "w1",
      scenario: "branch_diverged",
      strategies: ["recreate_at_sha", "restore_detached"],
    });
  });
});
