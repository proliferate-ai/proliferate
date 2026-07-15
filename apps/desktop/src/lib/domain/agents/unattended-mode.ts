import { getBundledDesktopAgentLaunchCatalog } from "./bundled-agent-catalog";

/**
 * The catalog's curated "run unattended" mode for the family
 * (`session.unattendedModeId` in `catalogs/agents/catalog.json`): what
 * product-owned surfaces (cowork, plan handoff, reviews, workflows) send when
 * they own the access policy and need the harness to stop asking.
 *
 * `undefined` means the family declares none (grok has no mode control at
 * all; cursor/opencode are unvetted) — callers must omit the mode entirely
 * rather than guess.
 *
 * Reads the BUNDLED catalog on purpose: the value is a per-family constant
 * and these call sites are pure/synchronous; the runtime re-derives the same
 * field from its ACTIVE catalog on every execution path that matters
 * (session create, workflow resolution), so one-release drift here only
 * affects a UI default, never what actually launches.
 */
export function resolveUnattendedModeId(
  agentKind: string | null | undefined,
): string | undefined {
  const trimmedAgentKind = agentKind?.trim();
  if (!trimmedAgentKind) {
    return undefined;
  }

  return getBundledDesktopAgentLaunchCatalog()
    .agents
    .find((agent) => agent.kind === trimmedAgentKind)
    ?.unattendedModeId ?? undefined;
}
