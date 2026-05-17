export const routes = {
  home: "/",
  automations: "/automations",
  plugins: "/plugins",
  support: "/support",
  settings: "/settings",
  authCallback: "/auth/callback",
  desktopHandoff: "/auth/desktop/handoff",
  authError: "/auth/error",
  chat: (workspaceId: string, chatId: string) => `/workspaces/${workspaceId}/chats/${chatId}`,
} as const;
