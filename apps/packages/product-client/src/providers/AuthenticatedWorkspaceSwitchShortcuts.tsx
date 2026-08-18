import { useWorkspaceSwitchShortcuts } from "#product/hooks/app/lifecycle/use-workspace-switch-shortcuts"

/**
 * Authenticated-only mount point for useWorkspaceSwitchShortcuts (login
 * runtime-budget fix). The hook already no-ops when signed out (there is no
 * sidebar target and no committed workspace to step from), so gating the
 * owner behind the same auth check that already governs its behavior is a
 * bundling-only change. It lets the owner be lazy-loaded, which keeps the
 * sidebar-shortcut-target projection and the held-key traversal cursor
 * controller/store off the /login first-load path -- they were only reached
 * pre-auth through this hook's old home in useAppShortcuts.
 *
 * This does NOT gate useWorkspaceNavigationWorkflow's workspace-selection /
 * agent-catalog / session-creation graph: that hook remains statically,
 * unconditionally reachable from /login via useAppNavigationCommandActions
 * and useAppNewWorkspaceCommandActions (see use-app-shortcuts.ts).
 */
export function AuthenticatedWorkspaceSwitchShortcuts() {
  useWorkspaceSwitchShortcuts()
  return null
}
