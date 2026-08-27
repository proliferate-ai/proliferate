import type {
  AgentAuthSelection,
  AgentAuthSource,
  AgentAuthSurface,
} from "@proliferate/cloud-sdk";
import {
  isGatewayCapableHarness as registryIsGatewayCapableHarness,
  isMultiSourceHarness as registryIsMultiSourceHarness,
} from "#product/lib/domain/agents/bundled-agent-registry";

// The auth methods a harness surface can use. Single-source harnesses hold
// exactly one (radio — the radio counts KINDS, so the seat pool is one
// method however many seats it holds); multi-source (opencode) may combine
// gateway + api_key. "seat" is a Claude.ai login (Max subscription) from the
// vault — seats v1, claude only.
export type AuthMethod = "gateway" | "api_key" | "seat" | "cli";

// Seat-capable harnesses (seats v1). Mirrors the server's
// AGENT_AUTH_SEAT_CAPABLE_HARNESS_KINDS (constants/agent_gateway.py): claude
// only — codex's seat route is the phase-2 refreshing-file shape. Not a
// registry derivation yet: the registry declares no seat vocabulary, so a
// literal mirror is the honest source until it does.
const SEAT_CAPABLE_HARNESSES = new Set(["claude"]);

export function isSeatCapableHarness(harnessKind: string): boolean {
  return SEAT_CAPABLE_HARNESSES.has(harnessKind);
}

// Mirror of the server env-var shape (selection_rules.py ENV_VAR_NAME_RE) so the
// UI can gate the enabled switch and reject a bad name before the PUT round-trip.
const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function isValidEnvVarName(name: string): boolean {
  return ENV_VAR_NAME_RE.test(name);
}

// Harnesses that may keep more than one enabled source at once (contract §2).
// Everything else is single-source (gateway XOR one api_key row). Derived from
// registry.json's authCardinality (the single allow-list authority, agent-auth.md
// FR-4) via the bundled registry copy — no re-literalled cursor/opencode set.
export function isMultiSourceHarness(harnessKind: string): boolean {
  return registryIsMultiSourceHarness(harnessKind);
}

// The gateway-capable allow-list, derived from registry.json (an auth slot with
// id "gateway" present) via the bundled registry copy. A positive allow-list,
// so a future harness with no gateway recipe fails closed by default. cursor has
// no gateway recipe (agent-auth.md's per-harness recipe table — "typed refusal,
// no gateway route exists for cursor"), so it never offers the gateway method
// and never carries a gateway source (see buildDesiredSources).
export function isGatewayCapableHarness(harnessKind: string): boolean {
  return registryIsGatewayCapableHarness(harnessKind);
}

export interface EditableApiKeyRow {
  // Stable client id: persisted rows reuse the server selection id, drafts get a
  // generated one. Never sent to the server — the store keys rows by env var name.
  uid: string;
  envVarName: string;
  apiKeyId: string | null;
  providerHint: string | null;
  enabled: boolean;
}

export interface HarnessAuthEditorState {
  gatewayEnabled: boolean;
  // The seat pool selection (seats v1): one enabled `seat` row with no pinned
  // key means "use my seat pool" — the server expands it to every active seat
  // in vault order. Single-seat subset this slice: the pane offers no pinning.
  seatEnabled: boolean;
  rows: EditableApiKeyRow[];
}

// A row can be wired only once it names BOTH a key and a valid env var (the
// store rejects an api_key source missing either). Incomplete draft rows live in
// the editor and are never sent.
export function isRowComplete(row: EditableApiKeyRow): boolean {
  return row.apiKeyId !== null && isValidEnvVarName(row.envVarName);
}

/** Seed the editor from the persisted selections for one (harness, surface). */
export function deriveEditorState(
  selections: readonly AgentAuthSelection[],
  harnessKind: string,
  surface: AgentAuthSurface,
): HarnessAuthEditorState {
  const scope = selections.filter(
    (selection) =>
      selection.harnessKind === harnessKind && selection.surface === surface,
  );
  const gatewayEnabled = scope.some(
    (selection) => selection.sourceKind === "gateway" && selection.enabled,
  );
  const seatEnabled = scope.some(
    (selection) => selection.sourceKind === "seat" && selection.enabled,
  );
  const rows: EditableApiKeyRow[] = scope
    .filter((selection) => selection.sourceKind === "api_key")
    .map((selection) => ({
      uid: selection.id,
      envVarName: selection.envVarName ?? "",
      apiKeyId: selection.apiKeyId,
      providerHint: selection.providerHint,
      enabled: selection.enabled,
    }));
  return { gatewayEnabled, seatEnabled, rows };
}

/**
 * The full desired-state PUT body (contract §5). The gateway row is retained
 * disabled when native/API-key auth is selected so its `updated_at` remains a
 * monotonic surface revision marker across gateway -> native transitions.
 * Only complete api_key rows are wired.
 */
export function buildDesiredSources(
  harnessKind: string,
  state: HarnessAuthEditorState,
): AgentAuthSource[] {
  const sources: AgentAuthSource[] = isGatewayCapableHarness(harnessKind)
    ? [{
      sourceKind: "gateway",
      enabled: state.gatewayEnabled,
    }]
    : [];
  // The seat pool row rides only when ON (seats v1): unlike the gateway row
  // (the scope's durable revision marker, always sent), a disabled seat row
  // carries no revision duty, and never sending one keeps every non-seat
  // scope byte-identical to before seats existed.
  if (isSeatCapableHarness(harnessKind) && state.seatEnabled) {
    sources.push({ sourceKind: "seat", enabled: true });
  }
  for (const row of state.rows) {
    if (!isRowComplete(row)) {
      continue;
    }
    sources.push({
      sourceKind: "api_key",
      apiKeyId: row.apiKeyId,
      envVarName: row.envVarName,
      providerHint: row.providerHint,
      enabled: row.enabled,
    });
  }
  return sources;
}

/** True when nothing is wired — the implicit native (CLI-own-login) state. */
export function isNativeState(state: HarnessAuthEditorState): boolean {
  return (
    !state.gatewayEnabled
    && !state.seatEnabled
    && !state.rows.some((row) => row.enabled)
  );
}
