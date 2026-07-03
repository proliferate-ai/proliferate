/**
 * Pre-session goal-capability heuristic for the workflow editor.
 *
 * The workflow editor gates its goal-attachment section before any session
 * exists, so it cannot read the live `SessionActionCapabilities.supportsGoals`
 * advertisement the goal bar uses. The runtime catalog projection does not yet
 * surface a goals capability, so this table mirrors the verified native goal
 * matrix (Claude Code + Codex today; spec 3.6) exactly like
 * `NATIVE_GOAL_PAUSE_BY_AGENT_KIND` in `sessions/goal-mirror`.
 *
 * This is ONLY for the pre-session picker. A live workflow run still gates each
 * goal mutation on the session's `supportsGoals` advertisement — never on a
 * harness name.
 */

const GOAL_CAPABLE_AGENT_KINDS: ReadonlySet<string> = new Set(["claude", "codex"]);

export function harnessSupportsGoals(agentKind: string | null | undefined): boolean {
  if (!agentKind) {
    return false;
  }
  return GOAL_CAPABLE_AGENT_KINDS.has(agentKind);
}
