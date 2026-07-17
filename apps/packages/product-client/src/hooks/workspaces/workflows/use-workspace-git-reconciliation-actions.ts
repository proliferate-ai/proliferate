import { useCallback } from "react";
import {
  getAnyHarnessClient,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import {
  cloudGitSideFromStatus,
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
import { useCloudWorkspaceConnectionCache } from "#product/hooks/access/cloud/use-cloud-workspace-connection-cache";
import { useToastStore } from "#product/stores/toast/toast-store";
import type { Workspace } from "@anyharness/sdk";

/**
 * PR 6 — the client actions the reconciliation dialog drives: read the current
 * cross-target Git relation from LIVE status on BOTH sides (local runtime +
 * Cloud runtime, the latter reached through the resolved cloud connection), and
 * run push-and-continue for a clean ahead relation via the EXISTING AnyHarness
 * push capability on whichever side is ahead. All git mutation is `push` only;
 * no reset/stash/rebase/merge/force is ever invoked. Re-evaluation between
 * preflight and push wins (the pure orchestration cancels a stale action).
 *
 * Truthfulness (PR6-CLOUD-TRUTH-01): the Cloud side is read LIVE. If its runtime
 * can't be reached, its cleanliness fields stay UNKNOWN (last-reported head only)
 * and the relation resolver withholds any same_head/safe claim.
 */
export function useWorkspaceGitReconciliationActions() {
  const runtime = useAnyHarnessRuntimeContext();
  const { refreshCloudWorkspaceConnection } = useCloudWorkspaceConnectionCache();
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

  /** Read the CLOUD side LIVE through the resolved cloud connection. Falls back
   * to last-reported (unknown-clean) only when the runtime can't be reached. */
  const readCloudSide = useCallback(async (
    cloud: CloudWorkspaceSummary | null,
  ): Promise<WorkspaceGitSide> => {
    const repo = cloud?.repo ?? null;
    const managed = (cloud?.materializations ?? []).find((m) => m.targetKind === "managed_cloud")
      ?? null;
    if (!cloud || !managed) {
      // No managed Cloud copy → absent (Add-Cloud-copy), or a missing/failed row.
      return cloudGitSideLastReported(managed, repo);
    }
    try {
      const connection = await refreshCloudWorkspaceConnection(cloud.id);
      const anyharnessWorkspaceId = connection.anyharnessWorkspaceId;
      if (!connection.runtimeUrl || !anyharnessWorkspaceId) {
        return cloudGitSideLastReported(managed, repo);
      }
      const client = getAnyHarnessClient({
        runtimeUrl: connection.runtimeUrl,
        authToken: connection.accessToken ?? undefined,
      });
      const status = await client.git.getStatus(anyharnessWorkspaceId);
      return cloudGitSideFromStatus(status, repo);
    } catch {
      // Runtime not reachable this pass: last-reported head, cleanliness unknown.
      return cloudGitSideLastReported(managed, repo);
    }
  }, [refreshCloudWorkspaceConnection]);

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
        const managed = (args.cloud?.materializations ?? [])
          .find((m) => m.targetKind === "managed_cloud") ?? null;
        if (!args.cloud || !managed) {
          showToast("The Cloud copy isn't available to push right now.");
          return null;
        }
        const connection = await refreshCloudWorkspaceConnection(args.cloud.id);
        const cloudWorkspaceId = connection.anyharnessWorkspaceId;
        if (!connection.runtimeUrl || !cloudWorkspaceId) {
          showToast("The Cloud copy's runtime isn't reachable right now.");
          return null;
        }
        const client = getAnyHarnessClient({
          runtimeUrl: connection.runtimeUrl,
          authToken: connection.accessToken ?? undefined,
        });
        push = () => client.git.push(cloudWorkspaceId, {});
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
  }, [readCloudSide, readLocalSide, refreshCloudWorkspaceConnection, runtime, showToast]);

  return { readRelation, pushAndContinue };
}
