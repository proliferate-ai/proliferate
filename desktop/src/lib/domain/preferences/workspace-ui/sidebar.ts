export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 280;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 220;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 420;

export function clampWorkspaceSidebarWidth(width: number): number {
  return Math.min(WORKSPACE_SIDEBAR_MAX_WIDTH, Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, width));
}
