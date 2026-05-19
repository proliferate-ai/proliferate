export const routes = {
  home: "/",
  auth: "/auth",
  workspaces: "/workspaces",
  automations: "/automations",
  plugins: "/plugins",
  support: "/support",
  settings: "/settings",
  authCallback: "/auth/callback",
  connectGitHub: "/connect-github",
  desktopHandoff: "/auth/desktop/handoff",
  authError: "/auth/error",
  chat: (workspaceId: string, chatId: string) => `/workspaces/${workspaceId}/chats/${chatId}`,
} as const;
