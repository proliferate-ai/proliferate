/**
 * Pure gating decisions for the T0 optimistic model menu
 * (specs/tbd/agents-catalog-registry-migration.md §5.5, decision 9):
 * menu = catalog × known auth contexts. Models whose availability does not
 * intersect the known contexts render GATED with a human unlock condition
 * composed straight from `availability.anyOf`. The menu never shrinks —
 * gating annotates entries, it never filters them.
 */

export interface ModelAvailability {
  /** Auth context ids, any one of which makes the model launchable. */
  anyOf: string[];
}

/** Last-known active auth context ids for the target (cloud-computed or last-synced). */
export type ActiveAuthContextIds = string[];

export type ModelGateDecision =
  | { state: "enabled" }
  | { state: "gated"; unlockContexts: string[]; unlockHint: string };

/** Context id meaning "launchable without any credential". */
export const BASELINE_AUTH_CONTEXT_ID = "baseline";

const ENABLED_DECISION: ModelGateDecision = { state: "enabled" };

const UNLOCK_PHRASES_BY_CONTEXT_ID: Record<string, string> = {
  "anthropic-api": "add an Anthropic API key",
  "anthropic-oauth": "sign in with Claude",
  "anthropic-bedrock": "configure AWS Bedrock",
  "openai-api": "add an OpenAI API key",
  "openai-oauth": "sign in with ChatGPT/Codex",
  "gemini-api": "add a Gemini API key",
  "google-oauth": "sign in with Google",
  "cursor-login": "sign in to Cursor",
  [BASELINE_AUTH_CONTEXT_ID]: "available without credentials",
};

/**
 * Decide whether a model is launchable with the known active contexts.
 *
 * Enabled iff `availability.anyOf` intersects the active contexts (the
 * baseline context counts like any other when present in both). A model
 * without availability data carries no gate — it stays enabled (optimistic;
 * no unknown-state UI). Otherwise the model is gated with its unlock
 * condition taken verbatim from `anyOf`.
 */
export function decideModelGate(
  availability: ModelAvailability | null | undefined,
  activeContexts: ActiveAuthContextIds,
): ModelGateDecision {
  const unlockContexts = dedupe(availability?.anyOf ?? []);
  if (unlockContexts.length === 0) {
    return ENABLED_DECISION;
  }

  const active = new Set(activeContexts);
  if (unlockContexts.some((context) => active.has(context))) {
    return ENABLED_DECISION;
  }

  return {
    state: "gated",
    unlockContexts,
    unlockHint: unlockHintForContexts(unlockContexts),
  };
}

/**
 * Presentation map: auth context ids -> human unlock phrase, joined with
 * " or " ("sign in with Claude or add an Anthropic API key").
 */
export function unlockHintForContexts(contexts: readonly string[]): string {
  const phrases = dedupe([...contexts]).map(
    (context) => UNLOCK_PHRASES_BY_CONTEXT_ID[context] ?? fallbackUnlockPhrase(context),
  );
  return phrases.join(" or ");
}

export interface GateableModel {
  id: string;
  displayName: string;
  availability?: ModelAvailability | null;
}

export type GatedModel<T extends GateableModel> = T & {
  decision: ModelGateDecision;
};

/**
 * Annotate every model with its gate decision. Returns the full input list in
 * order — never filters (the menu never shrinks; items resolve or stay gated).
 */
export function gateModelList<T extends GateableModel>(
  models: readonly T[],
  activeContexts: ActiveAuthContextIds,
): GatedModel<T>[] {
  return models.map((model) => ({
    ...model,
    decision: decideModelGate(model.availability, activeContexts),
  }));
}

function fallbackUnlockPhrase(contextId: string): string {
  const readable = contextId.trim().replace(/[-_]+/g, " ");
  return readable ? `set up ${readable}` : "set up credentials";
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
