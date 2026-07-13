export const routes = {
  home: "/",
  auth: "/auth",
  ssoLogin: "/login",
  ssoLoginForSlug: (slug: string) => `/login/${slug}`,
  workflows: "/workflows",
  workflow: (workflowId: string) => `/workflows/${workflowId}`,
  support: "/support",
  settings: "/settings",
  settingsSection: (sectionId: string) => `/settings/${sectionId}`,
  authCallback: "/auth/callback",
  connectGitHub: "/connect-github",
  desktopHandoff: "/auth/desktop/handoff",
  authError: "/auth/error",
  workspace: (workspaceId: string) => `/cloud/workspaces/${workspaceId}`,
  chat: (workspaceId: string, chatId: string) => `/cloud/workspaces/${workspaceId}/chats/${chatId}`,
} as const;

export function legacyWorkflowRedirectHref(
  workflowsPath: string,
  workflowId: string | undefined,
  search: string,
  hash: string,
): string {
  const destination = workflowId
    ? `${workflowsPath}/${encodeURIComponent(workflowId)}`
    : workflowsPath;
  return `${destination}${search}${hash}`;
}
