import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";

/**
 * Filter a merged control-value map down to the target's current observation.
 *
 * The runtime exact-validates every `controlValues` key against the raw
 * observed control ids for the harness, so anything else (legacy normalized
 * keys persisted before the raw-id cutover, controls a given harness never
 * observed, values outside the observed set) must be dropped before create.
 * Omission remains omission: dropped entries fall back to observed defaults.
 *
 * When the observation is unavailable (fetch failure upstream passes `null`)
 * or not currently observed, no key can be validated, so nothing is sent.
 */
export function filterControlValuesToObservation(
  controlValues: Record<string, string>,
  observation: HarnessLaunchOptionsResponse | null,
): Record<string, string> {
  const controls = observation?.options?.controls;
  if (
    !controls
    || (observation.state !== "observed" && observation.state !== "observed_empty")
  ) {
    return {};
  }
  const filtered: Record<string, string> = {};
  for (const control of controls) {
    const value = controlValues[control.id];
    if (value !== undefined
      && control.values.some((candidate) => candidate.value === value)) {
      filtered[control.id] = value;
    }
  }
  return filtered;
}
