import { describe, expect, it } from "vitest";
import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { filterControlValuesToObservation } from "#product/lib/domain/sessions/creation/launch-control-observation-filter";

function observation(overrides: Partial<HarnessLaunchOptionsResponse> = {}): HarnessLaunchOptionsResponse {
  return {
    harnessKind: "codex",
    basisRevision: "basis-1",
    revision: 3,
    state: "observed",
    options: {
      models: [{ id: "gpt-5.6-sol", observedName: null, observedDescription: null }],
      controls: [
        {
          id: "reasoning_effort",
          observedLabel: null,
          observedDescription: null,
          values: [
            { value: "high", observedLabel: null, observedDescription: null },
            { value: "xhigh", observedLabel: null, observedDescription: null },
          ],
        },
        {
          id: "fast-mode",
          observedLabel: null,
          observedDescription: null,
          values: [
            { value: "on", observedLabel: null, observedDescription: null },
            { value: "off", observedLabel: null, observedDescription: null },
          ],
        },
      ],
      defaults: { modelId: "gpt-5.6-sol", controlValues: {} },
    },
    observedAt: "2026-08-19T00:00:00Z",
    probeAttemptedAt: "2026-08-19T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready" as HarnessLaunchOptionsResponse["readiness"],
    ...overrides,
  };
}

describe("filterControlValuesToObservation", () => {
  it("keeps raw observed control ids and drops pre-cutover normalized keys", () => {
    const filtered = filterControlValuesToObservation(
      {
        // Legacy persisted defaults written before the raw-id cutover.
        effort: "xhigh",
        fast_mode: "off",
        // Correct raw-id entries.
        reasoning_effort: "xhigh",
        "fast-mode": "off",
      },
      observation(),
    );

    expect(filtered).toEqual({ reasoning_effort: "xhigh", "fast-mode": "off" });
    // Negative control: the normalized keys the deployed bug leaked must not
    // survive filtering.
    expect(filtered).not.toHaveProperty("effort");
    expect(filtered).not.toHaveProperty("fast_mode");
  });

  it("drops values outside the observed value set", () => {
    expect(
      filterControlValuesToObservation(
        { reasoning_effort: "ultra" },
        observation(),
      ),
    ).toEqual({});
  });

  it("sends nothing for a harness that observes no controls", () => {
    const grokShaped = observation({
      harnessKind: "grok",
      options: {
        models: [{ id: "grok-4", observedName: null, observedDescription: null }],
        controls: [],
        defaults: { modelId: "grok-4", controlValues: {} },
      },
    });
    expect(
      filterControlValuesToObservation({ effort: "high", mode: "agent" }, grokShaped),
    ).toEqual({});
  });

  it("sends nothing when the observation fetch failed", () => {
    expect(
      filterControlValuesToObservation({ reasoning_effort: "xhigh" }, null),
    ).toEqual({});
  });

  it("sends nothing while the target is not currently observed", () => {
    expect(
      filterControlValuesToObservation(
        { reasoning_effort: "xhigh" },
        observation({ state: "detecting", options: null }),
      ),
    ).toEqual({});
    expect(
      filterControlValuesToObservation(
        { reasoning_effort: "xhigh" },
        observation({ state: "failed_without_observation" }),
      ),
    ).toEqual({});
  });
});
