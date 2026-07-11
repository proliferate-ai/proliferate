/**
 * Wire adapters for the WS1 contract shapes (new, additive).
 *
 * These bridge the raw contract wire shapes to product-domain read models
 * WITHOUT rewriting existing editor/run behavior. They enforce the contract
 * invariants the run surface depends on: sessions stay a slot-keyed map at every
 * boundary, stable step keys survive lookup unchanged, and no envelope
 * credential is ever present on a public run view (feature spec §5.3/§5.4).
 */

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
