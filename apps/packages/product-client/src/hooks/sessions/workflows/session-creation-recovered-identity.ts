import { promoteMaterializedSessionIdentity } from "#product/hooks/sessions/workflows/session-creation-local-state";
import { replaceSessionIdInShellPreferences } from "#product/hooks/sessions/workflows/session-replacement-shell-preferences";

export function adoptRecoveredSessionIdentity(input: {
  clientSessionId: string;
  materializedWorkspaceId: string;
  ownedShellWorkspaceId: string | null;
  resolvedSessionId: string;
  writeOwnedShellIntent: (
    sessionId: string,
    shellWorkspaceId?: string | null,
  ) => void;
}): string {
  const adoptedSessionId = promoteMaterializedSessionIdentity(input.clientSessionId);
  if (adoptedSessionId === input.clientSessionId) {
    return input.resolvedSessionId;
  }
  if (input.ownedShellWorkspaceId) {
    replaceSessionIdInShellPreferences({
      shellWorkspaceId: input.ownedShellWorkspaceId,
      materializedWorkspaceId: input.materializedWorkspaceId,
      replacedSessionId: input.clientSessionId,
      replacementSessionId: adoptedSessionId,
    });
  }
  input.writeOwnedShellIntent(adoptedSessionId, input.ownedShellWorkspaceId);
  return adoptedSessionId;
}
