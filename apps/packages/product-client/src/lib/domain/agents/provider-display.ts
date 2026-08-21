import { getRegistryAgentDisplayName } from "#product/lib/domain/agents/bundled-agent-registry";

/**
 * The human name for a provider/harness kind, sourced from the bundled agent
 * registry rather than a client-side literal map (D-R9). registry.json is the
 * single allow-list authority, and it already carries a displayName on every
 * row; a second hand-maintained map here could only ever be a stale subset of
 * it. It was: `grok` shipped in the catalog, never reached the map, and the
 * raw wire kind leaked into user copy as "grok is ready.".
 *
 * The fallback stays the bare kind, for a kind the runtime reports that this
 * build's catalog does not contain — the only remaining case, and one no
 * client map could have covered either.
 */
export function getProviderDisplayName(kind: string): string {
  return getRegistryAgentDisplayName(kind) ?? kind;
}

/**
 * The install/update surfaces (harness toast, home readiness card) call an
 * agent by its product name rather than its provider name — Claude Code, not
 * bare Claude — while every other kind keeps its provider display name.
 * Single-sourced here so the toast presenter and the readiness card can't
 * drift into naming the same agent two different ways.
 */
export function getAgentDisplayLabel(kind: string): string {
  return kind === "claude" ? "Claude Code" : getProviderDisplayName(kind);
}
