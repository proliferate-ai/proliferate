import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { resolveObservedLaunchControlScope } from "#product/lib/domain/sessions/launch-control-scope";

export interface WorkflowBuilderModelOption {
  id: string;
  label: string;
  /** `null` means this older target only reported harness-level controls. */
  controls: WorkflowBuilderControlOption[] | null;
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
  defaultModelId: string | null;
  models: WorkflowBuilderModelOption[];
  controls: WorkflowBuilderControlOption[];
}

/**
 * The harness/model vocabulary a gen-2 node's optional `model` picks from.
 *
 * Sourced directly from the local runtime's target-observed launch options.
 * This mapper is presentation-only: it preserves exact executable IDs and
 * selects the exact model row when present, otherwise the response's flat
 * compatibility row.
 */
export function workflowBuilderHarnessOptions(
  responses: readonly (HarnessLaunchOptionsResponse | null | undefined)[],
): WorkflowBuilderHarnessOption[] {
  return responses
    .filter((response): response is HarnessLaunchOptionsResponse => Boolean(response?.options))
    .map((response) => {
      const options = response.options!;
      return {
        agentKind: response.harnessKind,
        label: response.harnessKind,
        defaultModelId: options.defaults.modelId,
        models: options.models.map((model) => {
          const scope = resolveObservedLaunchControlScope(options, model.id);
          return {
            id: model.id,
            label: model.observedName ?? model.id,
            controls: scope.source === "model"
              ? projectWorkflowBuilderControls(
                scope.controls,
                scope.defaultControlValues,
              )
              : null,
          };
        }),
        controls: projectWorkflowBuilderControls(
          options.controls,
          options.defaults.controlValues,
        ),
      };
    });
}

export function workflowBuilderControlOptions(
  harnesses: readonly WorkflowBuilderHarnessOption[],
  agentKind: string | null | undefined,
  modelId: string | null | undefined,
): WorkflowBuilderControlOption[] {
  const harness = harnesses.find((candidate) => candidate.agentKind === agentKind);
  if (!harness) {
    return [];
  }
  const effectiveModelId = modelId || harness.defaultModelId;
  const model = effectiveModelId
    ? harness.models.find((candidate) => candidate.id === effectiveModelId)
    : null;
  return model?.controls ?? harness.controls;
}

/** Keep still-valid picks, drop stale ones, and complete the new scope's defaults. */
export function workflowBuilderControlValues(
  controls: readonly WorkflowBuilderControlOption[],
  selected: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const selectedValue = selected[control.key];
    const value = selectedValue !== undefined
      && control.values.some((candidate) => candidate.value === selectedValue)
      ? selectedValue
      : control.defaultValue;
    if (value !== null
      && control.values.some((candidate) => candidate.value === value)) {
      values[control.key] = value;
    }
  }
  return values;
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

function projectWorkflowBuilderControls(
  controls: readonly NonNullable<
    HarnessLaunchOptionsResponse["options"]
  >["controls"][number][],
  defaultControlValues: Readonly<Record<string, string>>,
): WorkflowBuilderControlOption[] {
  return controls.map((control) => ({
    key: control.id,
    label: control.observedLabel ?? control.id,
    values: control.values.map((value) => ({
      value: value.value,
      label: value.observedLabel ?? value.value,
    })),
    defaultValue: defaultControlValues[control.id] ?? null,
  }));
}
