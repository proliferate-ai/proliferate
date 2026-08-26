import { useCallback } from "react";
import {
  getAnyHarnessClient,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import {
  cloudGitSideLastReported,
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
 * cross-target Git relation (the local side LIVE from this Mac's runtime), and
 * run push-and-continue for a clean ahead relation via the EXISTING AnyHarness
 * push capability. All git mutation is `push` only; no reset/stash/rebase/
 * merge/force is ever invoked. Re-evaluation between preflight and push wins
 * (the pure orchestration cancels a stale action).
 *
 * Truthfulness (PR6-CLOUD-TRUTH-01): the cloud sandbox gateway is deleted, so
 * the Cloud side always reads last-reported — its cleanliness fields stay
 * UNKNOWN and the relation resolver withholds any same_head/safe claim.
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
      // No local copy exists on this Mac yet (Open-on-Mac territory), unless the
      // caller is a linked-but-gone case — the planner/relation handles missing
      // separately via the health pass. Here, absent means "not created".
      return localGitSideAbsent("absent", repo, repo?.branch ?? null);
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

  /** The Cloud side always reads last-reported (unknown-clean): there is no
   * cloud runtime left to reach for a live status. */
  const readCloudSide = useCallback(async (
    cloud: CloudWorkspaceSummary | null,
  ): Promise<WorkspaceGitSide> => {
    const repo = cloud?.repo ?? null;
    const managed = (cloud?.materializations ?? []).find((m) => m.targetKind === "managed_cloud")
      ?? null;
    return cloudGitSideLastReported(managed, repo);
  }, []);

  /** Read the current relation between the local checkout and the Cloud copy,
   * both sides LIVE where reachable. */
  const readRelation = useCallback(async (args: {
    local: Pick<Workspace, "id"> | null;
    cloud: CloudWorkspaceSummary | null;
  }): Promise<{ relation: WorkspaceGitRelation; local: WorkspaceGitSide; cloud: WorkspaceGitSide }> => {
    const [local, cloud] = await Promise.all([
      readLocalSide(args.local, args.cloud),
      readCloudSide(args.cloud),
    ]);
    return { relation: deriveWorkspaceGitRelation({ local, cloud }), local, cloud };
  }, [readCloudSide, readLocalSide]);

  /** Push from the ahead side and continue, re-reading state around the push.
   * `expected` selects the direction: local pushes from this Mac's runtime;
   * cloud pushes from the Cloud workspace's own runtime (resolved connection).
   * Returns the outcome so the host can re-render the (possibly changed) state. */
  const pushAndContinue = useCallback(async (args: {
    local: Pick<Workspace, "id"> | null;
    cloud: CloudWorkspaceSummary | null;
    expected: "local_ahead" | "cloud_ahead";
  }): Promise<PushAndContinueOutcome | null> => {
    let push: () => Promise<import("@anyharness/sdk").PushResponse>;
    try {
      if (args.expected === "local_ahead") {
        if (!args.local || !runtime.runtimeUrl) {
          showToast("This Mac's copy isn't available to push right now.");
          return null;
        }
        const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
        push = () => client.git.push(args.local!.id, {});
      } else {
        // Pushing from the Cloud copy's own runtime needed the deleted cloud
        // sandbox gateway; there is no runtime left to dispatch that push.
        showToast("The Cloud copy's runtime isn't reachable right now.");
        return null;
      }

      const outcome = await runPushAndContinue(args.expected, {
        readLocalSide: () => readLocalSide(args.local, args.cloud),
        readCloudSide: () => readCloudSide(args.cloud),
        push,
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
      showToast(error instanceof Error ? error.message : "Could not push.");
      return null;
    }
  }, [readCloudSide, readLocalSide, runtime, showToast]);

  return { readRelation, pushAndContinue };
}
