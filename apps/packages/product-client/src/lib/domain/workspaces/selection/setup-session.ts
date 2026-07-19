const WORKSPACE_SETUP_SESSION_PREFIX = "client-session:workspace-setup:";

export const WORKSPACE_SETUP_SESSION_TITLE = "Set up chat";

export function resolveWorkspaceSetupSessionId(workspaceId: string): string {
  return `${WORKSPACE_SETUP_SESSION_PREFIX}${encodeURIComponent(workspaceId)}`;
}

export function isWorkspaceSetupSessionId(sessionId: string): boolean {
  return sessionId.startsWith(WORKSPACE_SETUP_SESSION_PREFIX);
}
