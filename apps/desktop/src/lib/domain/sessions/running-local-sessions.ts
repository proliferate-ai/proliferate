import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import { parseTargetWorkspaceSyntheticId } from "@/lib/domain/compute/target-workspace-id";
import { isCloudWorkspaceId } from "@/lib/domain/workspaces/cloud/cloud-ids";

type SessionActivitySnapshot = NonNullable<Parameters<typeof resolveSessionViewState>[0]>;

export type RunningLocalSessionCandidate = SessionActivitySnapshot & {
  workspaceId?: string | null;
};

// A plain workspace id (neither the cloud: nor the target: synthetic form)
// runs on the local AnyHarness runtime.
export function isLocalWorkspaceId(workspaceId: string | null | undefined): boolean {
  if (!workspaceId) {
    return false;
  }
  return !isCloudWorkspaceId(workspaceId)
    && parseTargetWorkspaceSyntheticId(workspaceId) === null;
}

// Sessions an organization switch must close before the desktop worker is
// torn down: live agent loops on the LOCAL runtime. Cloud/target sessions do
// not run through the desktop worker's integration-gateway identity, so they
// are left alone.
export function collectRunningLocalSessionIds(
  sessions: Record<string, RunningLocalSessionCandidate>,
): string[] {
  const runningSessionIds: string[] = [];
  for (const [sessionId, record] of Object.entries(sessions)) {
    if (!isLocalWorkspaceId(record.workspaceId)) {
      continue;
    }
    const viewState = resolveSessionViewState(record);
    if (viewState === "working" || viewState === "needs_input") {
      runningSessionIds.push(sessionId);
    }
  }
  return runningSessionIds;
}
