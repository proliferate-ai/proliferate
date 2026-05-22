const DEFAULT_WEB_APP_BASE_URL = "https://app.proliferate.ai";

export function webWorkspaceDeepLink(
  workspaceId: string,
  baseUrl = DEFAULT_WEB_APP_BASE_URL,
): string {
  return `${baseUrl.replace(/\/+$/u, "")}/cloud/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function mobileWorkspaceDeepLink(
  workspaceId: string,
  baseUrl = DEFAULT_WEB_APP_BASE_URL,
): string {
  return `${baseUrl.replace(/\/+$/u, "")}/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function desktopWorkspaceDeepLink(workspaceId: string): string {
  return `proliferate://workspaces/${encodeURIComponent(workspaceId)}`;
}
