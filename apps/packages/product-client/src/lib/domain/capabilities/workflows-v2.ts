/**
 * TEMPORARY launch gate: the entire Workflows gen-2 (schema_version 2)
 * surface — builder, invocations, run views — is disabled by default while
 * the gen-2 ladder lands. Dev builds can opt in locally via
 * `VITE_WORKFLOWS_V2` to build/verify the surface ahead of launch.
 *
 * Flip WORKFLOWS_V2_DEFAULT to true in the ladder's final rung, as its own
 * isolated commit, to make gen-2 the default experience everywhere.
 *
 * Mirrors the temporary-gate style of ./cloud-compute.ts.
 */
const WORKFLOWS_V2_DEFAULT = false; // flipped to true in the ladder's final rung, as its own isolated commit

// Mirrors lib/domain/auth/auth-mode.ts's local envFlagEnabled. The canonical
// implementation lives behind lib/infra/measurement/measurement-port.ts's
// debug-utils sink indirection (a port built for pluggable measurement
// engines); importing that here for one truthy/falsy string check would pull
// an infra-layer dependency-injection seam into a domain-layer capability
// gate, so it is replicated locally instead — same call auth-mode.ts already
// made.
function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return !["0", "false", "off", "no"].includes(normalized);
}

export interface WorkflowsV2GateInput {
  dev: boolean;
  viteWorkflowsV2?: string;
}

/**
 * Pure decision function, taking the env as an argument: `import.meta.env`
 * is awkward to stub per-test, so the gate logic itself is plain and the
 * `import.meta.env` read lives only in the thin wrapper below.
 */
export function resolveWorkflowsV2Enabled(input: WorkflowsV2GateInput): boolean {
  return WORKFLOWS_V2_DEFAULT || (input.dev && envFlagEnabled(input.viteWorkflowsV2, false));
}

export function isWorkflowsV2Enabled(): boolean {
  return resolveWorkflowsV2Enabled({
    dev: import.meta.env.DEV,
    viteWorkflowsV2: import.meta.env.VITE_WORKFLOWS_V2,
  });
}
