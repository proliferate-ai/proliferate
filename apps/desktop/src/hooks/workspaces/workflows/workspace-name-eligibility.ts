import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import type { WorkspaceSessionCacheSnapshot } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  getMaterializedSessionId,
  getWorkspaceSessionRecords,
} from "@/stores/sessions/session-records";

/**
 * The user-set display-name override, ignoring the computed branch/repo
 * fallback. We must not read {@link LogicalWorkspace.displayName} (the rendered
 * label) here — it is never empty, so it would make every workspace look named.
 */
export function workspaceDisplayNameOverride(workspace: LogicalWorkspace): string | null {
  return (
    workspace.localWorkspace?.displayName?.trim()
    || workspace.cloudWorkspace?.displayName?.trim()
    || workspace.mobilityWorkspace?.displayName?.trim()
    || null
  );
}

/**
 * Whether any session other than the triggering one has ever been prompted in
 * this workspace. Mirrors the eligibility check the now-removed workspace_naming
 * MCP used: only the first prompted session in a fresh workspace earns an AI name.
 * Reads live store/query state (not a render closure) so it stays accurate
 * across the await around name generation.
 */
export function workspaceHasOtherPromptedSession(input: {
  workspaceId: string;
  clientSessionId: string;
  getWorkspaceSessionCacheSnapshot: (workspaceId: string) => WorkspaceSessionCacheSnapshot;
}): boolean {
  const triggeringMaterializedId = getMaterializedSessionId(input.clientSessionId);

  // In-memory directory records (covers sessions created this app run, including
  // the triggering one whose hasAttemptedPrompt was just set at dispatch).
  const records = getWorkspaceSessionRecords(input.workspaceId);
  for (const [sessionId, record] of Object.entries(records)) {
    if (sessionId === input.clientSessionId) {
      continue;
    }
    if (triggeringMaterializedId && record.materializedSessionId === triggeringMaterializedId) {
      continue;
    }
    if (record.lastPromptAt || record.hasAttemptedPrompt) {
      return true;
    }
  }

  // Historical sessions from the runtime sessions-list cache (covers sessions
  // from before this app run that were never hydrated into the directory).
  const cachedSessions = input.getWorkspaceSessionCacheSnapshot(input.workspaceId).sessions ?? [];
  for (const session of cachedSessions) {
    if (triggeringMaterializedId && session.id === triggeringMaterializedId) {
      continue;
    }
    if (session.lastPromptAt) {
      return true;
    }
  }

  return false;
}
