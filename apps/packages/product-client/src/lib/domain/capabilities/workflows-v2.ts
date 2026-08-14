/**
 * TEMPORARY launch gate: the entire Workflows gen-2 (schema_version 2)
 * surface — builder, invocations, run views — ships dark until the gen-2
 * ladder's final rung flips WORKFLOWS_V2_DEFAULT to true, as its own isolated
 * commit.
 *
 * `VITE_WORKFLOWS_V2` is the runtime kill switch for that surface, in any
 * build (there is deliberately no dev-only condition on it): an explicit "1"
 * forces gen-2 on even while the default is off, and an explicit "0" forces
 * it off even after the default flips on — which is the point, since "0" is
 * how the surface gets turned back off without cutting a release. Every other
 * value, including unset and empty, defers to WORKFLOWS_V2_DEFAULT.
 *
 * Mirrors the temporary-gate style of ./cloud-compute.ts.
 */
const WORKFLOWS_V2_DEFAULT = false; // flipped to true in the ladder's final rung, as its own isolated commit

export interface WorkflowsV2GateInput {
  /** Raw `VITE_WORKFLOWS_V2`. Only "1" and "0" override the default. */
  viteWorkflowsV2?: string;
  /** The compiled-in default. Injectable so the gate can be covered against
   * both postures without editing WORKFLOWS_V2_DEFAULT. */
  defaultEnabled?: boolean;
}

/**
 * Pure decision function, taking the env as an argument: `import.meta.env`
 * is awkward to stub per-test, so the gate logic itself is plain and the
 * `import.meta.env` read lives only in the thin wrapper below.
 */
export function resolveWorkflowsV2Enabled(input: WorkflowsV2GateInput = {}): boolean {
  const override = input.viteWorkflowsV2?.trim();
  if (override === "1") {
    return true;
  }
  if (override === "0") {
    return false;
  }

  return input.defaultEnabled ?? WORKFLOWS_V2_DEFAULT;
}

export function isWorkflowsV2Enabled(): boolean {
  return resolveWorkflowsV2Enabled({ viteWorkflowsV2: import.meta.env.VITE_WORKFLOWS_V2 });
}
