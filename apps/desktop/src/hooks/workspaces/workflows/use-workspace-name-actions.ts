import { useCallback, useRef } from "react";
import { generateWorkspaceName } from "@proliferate/cloud-sdk/client/ai-magic";
import { findLogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { useLogicalWorkspaces } from "@/hooks/workspaces/derived/use-logical-workspaces";
import { useWorkspaceDisplayNameActions } from "@/hooks/workspaces/workflows/use-workspace-display-name-actions";
import { useWorkspaceSessionCache } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  workspaceDisplayNameOverride,
  workspaceHasOtherPromptedSession,
} from "@/hooks/workspaces/workflows/workspace-name-eligibility";
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth";

const requestedAutoWorkspaceNames = new Map<string, number>();
const MAX_TRACKED_AUTO_WORKSPACE_NAMES = 500;

function markAutoWorkspaceNameRequested(workspaceId: string): boolean {
  if (requestedAutoWorkspaceNames.has(workspaceId)) {
    return true;
  }

  requestedAutoWorkspaceNames.set(workspaceId, Date.now());
  while (requestedAutoWorkspaceNames.size > MAX_TRACKED_AUTO_WORKSPACE_NAMES) {
    const oldestWorkspaceId = requestedAutoWorkspaceNames.keys().next().value;
    if (!oldestWorkspaceId) {
      break;
    }
    requestedAutoWorkspaceNames.delete(oldestWorkspaceId);
  }

  return false;
}

export function useWorkspaceNameActions() {
  const { logicalWorkspaces } = useLogicalWorkspaces();
  const { getWorkspaceSessionCacheSnapshot } = useWorkspaceSessionCache();
  const { updateWorkspaceDisplayName } = useWorkspaceDisplayNameActions();
  // The auto-name callback runs outside render; read the latest normalized auth
  // status through a ref so the callback identity stays stable (matching the
  // former non-reactive the Desktop auth store read).
  const authStatus = useProductAuthStatus();
  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;

  const maybeGenerateWorkspaceName = useCallback(async (input: {
    workspaceId: string;
    clientSessionId: string;
    firstUserMessage: string;
  }) => {
    const trimmedPrompt = input.firstUserMessage.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (authStatusRef.current !== "authenticated") {
      return;
    }

    const logicalWorkspace = findLogicalWorkspace(logicalWorkspaces, input.workspaceId);
    if (!logicalWorkspace) {
      // Unknown workspace: bail rather than risk naming the wrong one.
      return;
    }
    if (workspaceDisplayNameOverride(logicalWorkspace)) {
      return;
    }
    if (
      workspaceHasOtherPromptedSession({
        workspaceId: input.workspaceId,
        clientSessionId: input.clientSessionId,
        getWorkspaceSessionCacheSnapshot,
      })
    ) {
      return;
    }
    // Dedup last, after the cheap eligibility checks, keyed by the canonical
    // logical workspace id so different id forms collapse to one request.
    if (markAutoWorkspaceNameRequested(logicalWorkspace.id)) {
      return;
    }

    try {
      const response = await generateWorkspaceName(trimmedPrompt);
      const name = response.name.trim();
      if (!name) {
        return;
      }
      // Re-check eligibility after the in-flight call: a manual rename (override)
      // or another session's first prompt may have landed meanwhile. The override
      // read uses the render closure (best-effort); the sibling check is live.
      if (workspaceDisplayNameOverride(logicalWorkspace)) {
        return;
      }
      if (
        workspaceHasOtherPromptedSession({
          workspaceId: input.workspaceId,
          clientSessionId: input.clientSessionId,
          getWorkspaceSessionCacheSnapshot,
        })
      ) {
        return;
      }
      await updateWorkspaceDisplayName({
        workspaceId: logicalWorkspace.id,
        displayName: name,
      });
    } catch {
      // Best-effort workspace naming should never block chat.
    }
  }, [getWorkspaceSessionCacheSnapshot, logicalWorkspaces, updateWorkspaceDisplayName]);

  return {
    maybeGenerateWorkspaceName,
  };
}
