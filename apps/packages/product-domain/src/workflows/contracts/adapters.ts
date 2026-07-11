/**
 * Wire adapters for the WS1 contract shapes (new, additive).
 *
 * These bridge the raw contract wire shapes to product-domain read models
 * WITHOUT rewriting existing editor/run behavior. They enforce the contract
 * invariants the run surface depends on: sessions stay a slot-keyed map at every
 * boundary, stable step keys survive lookup unchanged, and no envelope
 * credential is ever present on a public run view (feature spec §5.3/§5.4).
 */

import type { WorkflowRequiredInvocation } from "../definition";
import type { CapabilityRef, ResolvedPlan } from "./types";

export interface ObservedStepWire {
  stepKey: string;
  attempt: number;
  status: string;
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface ObservedRunWire {
  schemaVersion: 2;
  runId: string;
  planHash: string;
  bindingHash: string;
  executionGeneration: number;
  revision: number;
  observedState: string;
  quiescenceState: string;
  globalCursor: string;
  laneCursors: Record<string, string>;
  sessions: Record<string, string>;
  steps: ObservedStepWire[];
  worktrees: Record<string, unknown>;
  cost: { usd: string; tokens: number };
  timing: { startedAt: string; updatedAt: string };
}

/** The slot -> session id map, copied so callers cannot mutate the observation. */
export function slotSessionMap(observed: ObservedRunWire): Record<string, string> {
  return { ...observed.sessions };
}

/** slotId -> editable label, for rendering the run/slot surface by identity. */
export function slotLabels(plan: ResolvedPlan): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const slot of plan.slots) {
    labels[slot.slotId] = slot.label;
  }
  return labels;
}

/** Look up a step's observed output by its stable step key (unchanged). */
export function stepOutputByKey(
  observed: ObservedRunWire,
  stepKey: string,
): Record<string, unknown> | undefined {
  return observed.steps.find((step) => step.stepKey === stepKey)?.output;
}

/** The exact capability refs a slot may activate (workflow max ∩ slot subset). */
export function slotCapabilities(plan: ResolvedPlan, slotId: string): CapabilityRef[] {
  const slot = plan.slots.find((s) => s.slotId === slotId);
  return slot ? [...slot.capabilitySubset] : [];
}

const CREDENTIAL_MARKERS = ["DUMMY_FAKE", "PROLIFERATE_WF_CREDENTIAL_CANARY"];

/**
 * A public (list/detail) run view derived from the plan + observed run. The
 * execution envelope is a separate transport contract and is never merged here;
 * this adapter fails loudly if any credential marker ever appears in the derived
 * view, guarding the redaction invariant.
 */
export interface PublicRunView {
  runId: string;
  planHash: string;
  observedState: string;
  revision: number;
  sessions: Record<string, string>;
  slotLabels: Record<string, string>;
}

export function toPublicRunView(plan: ResolvedPlan, observed: ObservedRunWire): PublicRunView {
  const view: PublicRunView = {
    runId: observed.runId,
    planHash: observed.planHash,
    observedState: observed.observedState,
    revision: observed.revision,
    sessions: slotSessionMap(observed),
    slotLabels: slotLabels(plan),
  };
  const serialized = JSON.stringify(view);
  for (const marker of CREDENTIAL_MARKERS) {
    if (serialized.includes(marker)) {
      throw new Error(`public run view leaked a credential marker: ${marker}`);
    }
  }
  return view;
}

// --- required-invocation <-> CapabilityRef (WS9a addendum, forward-compat) ----

/**
 * The reserved virtual provider namespace for owner HTTP function invocations
 * (mirrors `WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES`, definition.ts) — the
 * `{provider, tool}` wire shape's signal that a required-invocation targets a
 * `function` capability rather than an `integration_tool` one.
 */
export const REQUIRED_INVOCATION_FUNCTIONS_PROVIDER = "functions";

/**
 * Extra fields the coarse `{provider, tool}` wire shape cannot carry, needed to
 * build an exact tagged-union `CapabilityRef` (feature spec §7.1). Omit them
 * while the server compiler still speaks the coarse shape — the editor can fill
 * them in once a resolved plan/capability picker supplies the real values.
 */
export interface RequiredInvocationCapabilityDetails {
  /** `integration_tool` only. */
  providerRevision?: string;
  inputSchemaHash?: string;
  /** `function` only. */
  semanticRevision?: number;
}

/**
 * Expand the editor's current `{provider, tool}` required-invocation literal
 * into the exact tagged-union `CapabilityRef` (feature spec §7.1). `provider
 * === "functions"` maps to the `function` kind (namespace convention shared
 * with `WORKFLOW_INTEGRATION_LAUNCH_NAMESPACES`); anything else maps to
 * `integration_tool`. `details` fills the fields the coarse shape cannot carry
 * (defaulted to empty/zero placeholders when the caller does not have them
 * yet — never silently dropped, so a round-trip through `toWireRequiredInvocation`
 * is exact).
 */
export function fromWireRequiredInvocation(
  inv: WorkflowRequiredInvocation,
  details: RequiredInvocationCapabilityDetails = {},
): CapabilityRef {
  if (inv.provider === REQUIRED_INVOCATION_FUNCTIONS_PROVIDER) {
    return {
      kind: "function",
      definitionId: inv.tool,
      semanticRevision: details.semanticRevision ?? 0,
    };
  }
  return {
    kind: "integration_tool",
    providerDefinitionId: inv.provider,
    providerRevision: details.providerRevision ?? "",
    toolName: inv.tool,
    inputSchemaHash: details.inputSchemaHash ?? "",
  };
}

/**
 * Collapse an exact tagged-union `CapabilityRef` back to the editor's current
 * `{provider, tool}` required-invocation literal. `product_mcp` has no wire
 * form here — feature spec §7.1: "Product MCP is not a required-invocation
 * target in v1" — so it returns `null` rather than a lossy guess.
 */
export function toWireRequiredInvocation(ref: CapabilityRef): WorkflowRequiredInvocation | null {
  switch (ref.kind) {
    case "integration_tool":
      return { provider: ref.providerDefinitionId, tool: ref.toolName };
    case "function":
      return { provider: REQUIRED_INVOCATION_FUNCTIONS_PROVIDER, tool: ref.definitionId };
    case "product_mcp":
      return null;
  }
}
