import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { resolveObservedLaunchControlScope } from "#product/lib/domain/sessions/launch-control-scope";

/**
 * Filter a merged control-value map down to the target's current observation.
 *
 * The runtime exact-validates every `controlValues` key against the raw
 * observed control ids for the harness, so anything else (legacy normalized
 * keys persisted before the raw-id cutover, controls a given harness never
 * observed, values outside the observed set) must be dropped before create.
 * The exact selected-model defaults are completed before filtering so every
 * executable default is explicit in the create intent. A missing model scope
 * falls back to the compatible harness-level observation used by older
 * targets.
 *
 * When the observation is unavailable (fetch failure upstream passes `null`,
 * or a state whose `options` is null), no key can be validated, so nothing is
 * sent. The gate is options presence, not state: the runtime validates against
 * `options` whenever present (including `refreshing` and
 * `last_good_after_failure`), so dropping valid raw keys in those states would
 * silently lose user picks the runtime would accept.
 */
export function filterControlValuesToObservation(
  controlValues: Record<string, string>,
  observation: HarnessLaunchOptionsResponse | null,
  modelId: string | null,
): Record<string, string> {
  const options = observation?.options;
  if (!options) {
    return {};
  }
  const scope = resolveObservedLaunchControlScope(options, modelId);
  const filtered: Record<string, string> = {};
  for (const control of scope.controls) {
    const requestedValue = controlValues[control.id];
    const requestedValueIsValid = requestedValue !== undefined
      && control.values.some((candidate) => candidate.value === requestedValue);
    const value = requestedValueIsValid
      ? requestedValue
      : scope.defaultControlValues[control.id];
    if (value !== undefined
      && control.values.some((candidate) => candidate.value === value)) {
      filtered[control.id] = value;
    }
  }
  return filtered;
}
