import type { CloudHarnessLaunchOptionsResponse } from "@proliferate/cloud-sdk";

export interface WorkflowBuilderModelOption {
  id: string;
  label: string;
}

export interface WorkflowBuilderControlOption {
  key: string;
  label: string;
  values: Array<{ value: string; label: string }>;
  defaultValue: string | null;
}

export interface WorkflowBuilderHarnessOption {
  agentKind: string;
  label: string;
  models: WorkflowBuilderModelOption[];
  controls: WorkflowBuilderControlOption[];
}

/**
 * The harness/model vocabulary a gen-2 node's optional `model` picks from.
 *
 * Sourced directly from copied target-observed launch options. This mapper is
 * presentation-only: it preserves exact executable IDs and supplies no seed,
 * filter, alias, or fallback.
 */
export function workflowBuilderHarnessOptions(
  responses: readonly (CloudHarnessLaunchOptionsResponse | null | undefined)[],
): WorkflowBuilderHarnessOption[] {
  return responses
    .filter((response): response is CloudHarnessLaunchOptionsResponse => Boolean(response?.options))
    .map((response) => ({
      agentKind: response.harnessKind,
      label: response.harnessKind,
      models: (response.options?.models ?? []).map((model) => ({
        id: model.id,
        label: model.observedName ?? model.id,
      })),
      controls: (response.options?.controls ?? []).map((control) => ({
        key: control.id,
        label: control.observedLabel ?? control.id,
        values: control.values.map((value) => ({
          value: value.value,
          label: value.observedLabel ?? value.value,
        })),
        defaultValue: response.options?.defaults.controlValues[control.id] ?? null,
      })),
    }));
}

export function workflowBuilderControlOptions(
  harnesses: readonly WorkflowBuilderHarnessOption[],
  agentKind: string | null | undefined,
): WorkflowBuilderControlOption[] {
  return harnesses.find((harness) => harness.agentKind === agentKind)?.controls ?? [];
}

/** The models a chosen harness offers; `[]` for an unknown or unset harness. */
export function workflowBuilderModelOptions(
  harnesses: readonly WorkflowBuilderHarnessOption[],
  agentKind: string | null | undefined,
): WorkflowBuilderModelOption[] {
  if (!agentKind) {
    return [];
  }
  return harnesses.find((harness) => harness.agentKind === agentKind)?.models ?? [];
}
