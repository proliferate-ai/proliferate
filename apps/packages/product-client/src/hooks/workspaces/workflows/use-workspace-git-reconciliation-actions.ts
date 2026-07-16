import { useCallback } from "react";
import {
  getAnyHarnessClient,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import {
  cloudGitSideFromMaterialization,
  localGitSideAbsent,
  localGitSideFromStatus,
} from "#product/lib/domain/workspaces/cloud/workspace-git-sides";
import {
  deriveWorkspaceGitRelation,
  type WorkspaceGitRelation,
  type WorkspaceGitSide,
} from "#product/lib/domain/workspaces/cloud/workspace-git-relation";
import {
  runPushAndContinue,
  type PushAndContinueOutcome,
} from "#product/lib/domain/workspaces/cloud/push-and-continue-orchestration";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { useToastStore } from "#product/stores/toast/toast-store";
import type { Workspace } from "@anyharness/sdk";

/**
 * PR 6 — the client actions the reconciliation dialog drives: read the current
 * cross-target Git relation (local live status + Cloud last-known), and run a
 * push-and-continue for a clean local-ahead relation via the EXISTING AnyHarness
 * push capability. All git mutation is `push` only; no reset/stash/rebase/merge/
 * force is ever invoked. Re-evaluation between preflight and push wins (the pure
 * orchestration cancels a stale action).
 */
export function useWorkspaceGitReconciliationActions() {
  const runtime = useAnyHarnessRuntimeContext();
  const showToast = useToastStore((state) => state.show);

  const readLocalSide = useCallback(async (
    local: Pick<Workspace, "id"> | null,
    cloud: CloudWorkspaceSummary | null,
  ): Promise<WorkspaceGitSide> => {
    const repo = cloud?.repo ?? null;
    if (!local) {
      return localGitSideAbsent("missing", repo, repo?.branch ?? null);
    }
    if (!runtime.runtimeUrl) {
      return localGitSideAbsent("unreachable", repo, repo?.branch ?? null);
    }
    try {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      const status = await client.git.getStatus(local.id);
      return localGitSideFromStatus(status, repo);
    } catch {
      return localGitSideAbsent("unreachable", repo, repo?.branch ?? null);
    }
  }, [runtime]);

  const cloudSide = useCallback((cloud: CloudWorkspaceSummary | null): WorkspaceGitSide => {
    const managed = (cloud?.materializations ?? []).find((m) => m.targetKind === "managed_cloud")
      ?? null;
    return cloudGitSideFromMaterialization(managed, cloud?.repo ?? null);
  }, []);

  /** Read the current relation between the local checkout and the Cloud copy. */
  const readRelation = useCallback(async (args: {
    local: Pick<Workspace, "id"> | null;
    cloud: CloudWorkspaceSummary | null;
  }): Promise<{ relation: WorkspaceGitRelation; local: WorkspaceGitSide; cloud: WorkspaceGitSide }> => {
    const [local, cloud] = await Promise.all([
      readLocalSide(args.local, args.cloud),
      Promise.resolve(cloudSide(args.cloud)),
    ]);
    return { relation: deriveWorkspaceGitRelation({ local, cloud }), local, cloud };
  }, [cloudSide, readLocalSide]);

  /** Push from this Mac and continue, re-reading state around the push. Returns
   * the outcome so the host can re-render the (possibly changed) relation. */
  const pushLocalAndContinue = useCallback(async (args: {
    local: Pick<Workspace, "id"> | null;
    cloud: CloudWorkspaceSummary | null;
    expected: "local_ahead" | "cloud_ahead";
  }): Promise<PushAndContinueOutcome | null> => {
    if (!args.local || !runtime.runtimeUrl) {
      showToast("This Mac's copy isn't available to push right now.");
      return null;
    }
    const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
    try {
      const outcome = await runPushAndContinue(args.expected, {
        readLocalSide: () => readLocalSide(args.local, args.cloud),
        readCloudSide: () => Promise.resolve(cloudSide(args.cloud)),
        push: () => client.git.push(args.local!.id, {}),
      });
      switch (outcome.status) {
        case "continued":
          showToast("Pushed and reconciled.", "info");
          break;
        case "cancelled_stale":
          showToast("The workspace changed; re-checked before pushing. Review the new state.", "info");
          break;
        case "not_published":
          showToast("The push did not publish to the remote. Try again once the remote is reachable.");
          break;
        case "still_ahead":
          showToast("Pushed, but the copies still differ. Re-check before pushing again.", "info");
          break;
        case "blocked":
          showToast("This state needs manual resolution; nothing was changed.", "info");
          break;
      }
      return outcome;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not push from this Mac.");
      return null;
    }
  }, [cloudSide, readLocalSide, runtime, showToast]);

  return { readRelation, pushLocalAndContinue };
}
