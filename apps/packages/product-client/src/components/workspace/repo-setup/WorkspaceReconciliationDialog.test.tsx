// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceGitReconciliationPlan } from "#product/lib/domain/workspaces/cloud/workspace-git-reconciliation";

// Inline the AlertDialog kit so the body renders in jsdom without a portal.
vi.mock("@proliferate/ui/kit/AlertDialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="action">{children}</button>
  ),
  AlertDialogCancel: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="cancel">{children}</button>
  ),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@proliferate/product-ui/workspaces/WorkspaceReconciliationBody", () => ({
  WorkspaceReconciliationBody: () => <div data-testid="body" />,
}));

const readRelation = vi.fn();
const pushAndContinue = vi.fn();
vi.mock("#product/hooks/workspaces/workflows/use-workspace-git-reconciliation-actions", () => ({
  useWorkspaceGitReconciliationActions: () => ({ readRelation, pushAndContinue }),
}));
vi.mock("#product/hooks/workspaces/workflows/use-materialization-health-pass", () => ({
  useMaterializationHealthPass: () => vi.fn(async () => []),
}));
vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({ selectWorkspace: vi.fn(async () => {}) }),
}));
vi.mock("#product/components/workspace/shell/providers/WorkspaceShellActionsContext", () => ({
  useWorkspaceShellActions: () => null,
}));
vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: any) => selector({ show: vi.fn() }),
}));
vi.mock("#product/lib/domain/workspaces/cloud/reconciliation-body-view", () => ({
  buildReconciliationBodyView: () => ({ title: "t", columns: [], actionDetail: "", cancelPreserves: "" }),
}));

import { WorkspaceReconciliationDialog } from "#product/components/workspace/repo-setup/WorkspaceReconciliationDialog";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";

const localWorkspace = { id: "ws-1" } as LogicalWorkspace["localWorkspace"];
const logical = {
  id: "log-1",
  localWorkspace,
  cloudWorkspace: { id: "cloud-1", repo: { owner: "acme", name: "rocket" } },
} as unknown as LogicalWorkspace;

function pushLocalAheadPlan(): WorkspaceGitReconciliationPlan {
  return {
    relation: { kind: "local_ahead", localHead: "a".repeat(40), remoteHead: null, commits: 1 },
    title: "This Mac is ahead",
    action: {
      verb: "push-local",
      label: "Push from this Mac and continue…",
      detail: "d",
      requiresConfirmation: true,
      target: "local",
    },
    cancelPreserves: "x",
    linkable: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceReconciliationDialog — continuation resume (PR6-CONTINUATION-02)", () => {
  it("resumes the originating add_cloud_copy after a converged push", async () => {
    // Blocked Add Cloud copy entered reconciliation; the state reads local_ahead
    // (clean, unpushed), and the push converges.
    readRelation.mockResolvedValue({
      relation: pushLocalAheadPlan().relation,
      local: {},
      cloud: {},
    });
    pushAndContinue.mockResolvedValue({ status: "continued", relation: { kind: "same_head", headSha: "a" } });
    const onResumeContinuation = vi.fn();
    const onClose = vi.fn();

    render(
      <WorkspaceReconciliationDialog
        target={{
          localWorkspaceId: "ws-1",
          cloudWorkspaceId: "cloud-1",
          materializationId: null,
          continuation: {
            kind: "add_cloud_copy",
            localWorkspaceId: "ws-1",
            gitOwner: "acme",
            gitRepoName: "rocket",
          },
        }}
        logicalWorkspaces={[logical]}
        onRelink={vi.fn()}
        onRecreate={vi.fn()}
        onUnlink={vi.fn()}
        onLink={vi.fn()}
        onResumeContinuation={onResumeContinuation}
        onClose={onClose}
      />,
    );

    // Wait for the relation to load and the action button to reflect the plan.
    const button = await screen.findByTestId("action");
    expect(button.textContent).toMatch(/Push from this Mac/);
    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(onResumeContinuation).toHaveBeenCalledTimes(1));
    // Resumes the ORIGINAL action with the SAME serialized inputs — not a dead end.
    expect(onResumeContinuation).toHaveBeenCalledWith({
      kind: "add_cloud_copy",
      localWorkspaceId: "ws-1",
      gitOwner: "acme",
      gitRepoName: "rocket",
    });
    expect(pushAndContinue).toHaveBeenCalledWith(
      expect.objectContaining({ expected: "local_ahead" }),
    );
  });

  it("does NOT resume when the push did not converge (re-reads instead)", async () => {
    readRelation.mockResolvedValue({ relation: pushLocalAheadPlan().relation, local: {}, cloud: {} });
    pushAndContinue.mockResolvedValue({ status: "still_ahead", relation: pushLocalAheadPlan().relation });
    const onResumeContinuation = vi.fn();

    render(
      <WorkspaceReconciliationDialog
        target={{
          localWorkspaceId: "ws-1",
          cloudWorkspaceId: "cloud-1",
          materializationId: null,
          continuation: { kind: "add_cloud_copy", localWorkspaceId: "ws-1", gitOwner: "acme", gitRepoName: "rocket" },
        }}
        logicalWorkspaces={[logical]}
        onRelink={vi.fn()}
        onRecreate={vi.fn()}
        onUnlink={vi.fn()}
        onLink={vi.fn()}
        onResumeContinuation={onResumeContinuation}
        onClose={vi.fn()}
      />,
    );

    const button = await screen.findByTestId("action");
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(pushAndContinue).toHaveBeenCalled());
    expect(onResumeContinuation).not.toHaveBeenCalled();
  });
});
