import type {
  NormalizedSessionControl,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  planAdoptedSessionConfigIntentResolution,
  planCreationConfigIntentSettlement,
  type PreMaterializationConfigIntentSnapshot,
} from "#product/lib/domain/sessions/creation/config-intent-settlement";

const SNAPSHOT: PreMaterializationConfigIntentSnapshot = [{
  intentId: "effort-intent",
  generation: 1,
  controlKey: "effort",
  rawConfigId: "reasoning_effort",
  value: "high",
  order: 0,
}];

describe("config intent settlement", () => {
  it("preserves queued creation and adoption intents when live config is unavailable", () => {
    expect(planCreationConfigIntentSettlement({
      snapshot: SNAPSHOT,
      liveConfig: null,
    })).toEqual({ patches: [] });
    expect(planAdoptedSessionConfigIntentResolution({
      snapshot: SNAPSHOT,
      liveConfig: null,
    })).toEqual({ patches: [] });
  });

  it("resolves raw-keyed pending-shell input through the authoritative raw ID", () => {
    const rawKeyedSnapshot: PreMaterializationConfigIntentSnapshot = [{
      ...SNAPSHOT[0],
      controlKey: "reasoning_effort",
    }];

    expect(planCreationConfigIntentSettlement({
      snapshot: rawKeyedSnapshot,
      liveConfig: liveConfig(effortControl()),
    })).toEqual({
      patches: [{
        intentId: "effort-intent",
        generation: 1,
        rawConfigId: "reasoning_effort",
        status: "reconciled",
      }],
    });
  });

  it("still retires a value when authoritative config omits its control", () => {
    expect(planCreationConfigIntentSettlement({
      snapshot: SNAPSHOT,
      liveConfig: liveConfig(null),
    })).toEqual({
      patches: [{
        intentId: "effort-intent",
        generation: 1,
        rawConfigId: null,
        status: "stale",
      }],
    });
  });
});

function effortControl(): NormalizedSessionControl {
  return {
    key: "effort",
    rawConfigId: "reasoning_effort",
    label: "Effort",
    currentValue: "high",
    settable: true,
    values: [
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  };
}

function liveConfig(effort: NormalizedSessionControl | null): SessionLiveConfigSnapshot {
  return {
    sourceSeq: 1,
    rawConfigOptions: [],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: null,
      reasoning: null,
      effort,
      fastMode: null,
      extras: [],
    },
    updatedAt: "2026-08-16T00:00:00Z",
  };
}
