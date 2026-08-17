import { useWorkspaceSwitchShortcuts } from "#product/hooks/app/lifecycle/use-workspace-switch-shortcuts"

/**
 * Authenticated-only mount point for useWorkspaceSwitchShortcuts (login
 * runtime-budget fix). The hook already no-ops when signed out (there is no
 * sidebar target and no committed workspace to step from), so gating the
 * owner behind the same auth check that already governs its behavior is a
 * bundling-only change. It lets the owner be lazy-loaded, which keeps the
 * workspace-selection / agent-catalog / session-creation graph
 * useWorkspaceNavigationWorkflow pulls in off the /login first-load path.
 */
export function AuthenticatedWorkspaceSwitchShortcuts() {
  useWorkspaceSwitchShortcuts()
  return null
}
