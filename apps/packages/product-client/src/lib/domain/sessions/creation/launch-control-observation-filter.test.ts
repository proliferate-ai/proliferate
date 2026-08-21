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
      "gpt-5.6-sol",
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
        "gpt-5.6-sol",
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
      filterControlValuesToObservation(
        { effort: "high", mode: "agent" },
        grokShaped,
        "grok-4",
      ),
    ).toEqual({});
  });

  it("sends nothing when the observation fetch failed", () => {
    expect(
      filterControlValuesToObservation({ reasoning_effort: "xhigh" }, null, null),
    ).toEqual({});
  });

  it("sends nothing when no options were ever observed", () => {
    expect(
      filterControlValuesToObservation(
        { reasoning_effort: "xhigh" },
        observation({ state: "detecting", options: null }),
        "gpt-5.6-sol",
      ),
    ).toEqual({});
    expect(
      filterControlValuesToObservation(
        { reasoning_effort: "xhigh" },
        observation({ state: "failed_without_observation", options: null }),
        "gpt-5.6-sol",
      ),
    ).toEqual({});
  });

  it("keeps valid raw keys during refreshing and last-good-after-failure", () => {
    // The runtime validates against `options` whenever present regardless of
    // state; dropping here would silently lose picks it would accept.
    for (const state of ["refreshing", "last_good_after_failure"] as const) {
      expect(
        filterControlValuesToObservation(
          { reasoning_effort: "xhigh", effort: "xhigh" },
          observation({ state }),
          "gpt-5.6-sol",
        ),
      ).toEqual({ reasoning_effort: "xhigh" });
    }
  });

  it("uses exact model controls and defaults for Fable and Opus", () => {
    const scoped = modelScopedObservation();

    expect(filterControlValuesToObservation(
      { mode: "default", effort: "high", fast: "on" },
      scoped,
      "claude-fable-5[1m]",
    )).toEqual({ mode: "default", effort: "high" });
    expect(filterControlValuesToObservation(
      { mode: "default", effort: "ultra", fast: "on" },
      scoped,
      "opus[1m]",
    )).toEqual({ mode: "default", effort: "ultra", fast: "on" });
  });

  it("falls back to harness controls when the selected model scope is unavailable", () => {
    const scoped = modelScopedObservation();
    const options = scoped.options;
    if (options) {
      (options as typeof options & { modelControls?: unknown }).modelControls = undefined;
    }

    expect(filterControlValuesToObservation(
      { fast: "on" },
      scoped,
      "claude-fable-5[1m]",
    )).toEqual({ mode: "default", effort: "high", fast: "on" });
  });
});

function modelScopedObservation(): HarnessLaunchOptionsResponse {
  const mode = control("mode", ["default", "plan"]);
  const effort = control("effort", ["high", "ultra"]);
  const fast = control("fast", ["off", "on"]);
  return observation({
    harnessKind: "claude",
    options: {
      models: [
        { id: "opus[1m]", observedName: "Opus", observedDescription: null },
        { id: "claude-fable-5[1m]", observedName: "Fable", observedDescription: null },
      ],
      controls: [mode, effort, fast],
      defaults: {
        modelId: "opus[1m]",
        controlValues: { mode: "default", effort: "high", fast: "off" },
      },
      modelControls: [
        {
          modelId: "opus[1m]",
          controls: [mode, effort, fast],
          defaultControlValues: { mode: "default", effort: "high", fast: "off" },
        },
        {
          modelId: "claude-fable-5[1m]",
          controls: [mode, effort],
          defaultControlValues: { mode: "default", effort: "high" },
        },
      ],
    },
  } as Partial<HarnessLaunchOptionsResponse>);
}

function control(id: string, values: string[]) {
  return {
    id,
    observedLabel: null,
    observedDescription: null,
    values: values.map((value) => ({
      value,
      observedLabel: null,
      observedDescription: null,
    })),
  };
}
