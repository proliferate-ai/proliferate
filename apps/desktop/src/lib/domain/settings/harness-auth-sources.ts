import type {
  AgentAuthSelection,
  AgentAuthSource,
  AgentAuthSurface,
} from "@proliferate/cloud-sdk";

// The three auth methods a harness surface can use. Single-source harnesses
// hold exactly one (radio); multi-source (opencode) may combine gateway +
// api_key.
export type AuthMethod = "gateway" | "api_key" | "cli";

// Mirror of the server env-var shape (selection_rules.py ENV_VAR_NAME_RE) so the
// UI can gate the enabled switch and reject a bad name before the PUT round-trip.
const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function isValidEnvVarName(name: string): boolean {
  return ENV_VAR_NAME_RE.test(name);
}

// Harnesses that may keep more than one enabled source at once (contract §2).
// Everything else is single-source (gateway XOR one api_key row).
export function isMultiSourceHarness(harnessKind: string): boolean {
  return harnessKind === "opencode";
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
  const rows: EditableApiKeyRow[] = scope
    .filter((selection) => selection.sourceKind === "api_key")
    .map((selection) => ({
      uid: selection.id,
      envVarName: selection.envVarName ?? "",
      apiKeyId: selection.apiKeyId,
      providerHint: selection.providerHint,
      enabled: selection.enabled,
    }));
  return { gatewayEnabled, rows };
}

/**
 * The full desired-state PUT body (contract §5). Gateway is a single
 * always-enabled-when-present source; only complete api_key rows are wired.
 */
export function buildDesiredSources(
  state: HarnessAuthEditorState,
): AgentAuthSource[] {
  const sources: AgentAuthSource[] = [];
  if (state.gatewayEnabled) {
    sources.push({ sourceKind: "gateway", enabled: true });
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
  return !state.gatewayEnabled && !state.rows.some((row) => row.enabled);
}
