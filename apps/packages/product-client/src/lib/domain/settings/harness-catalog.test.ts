import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import { normalizeRuntimeLaunchModels } from "#product/lib/domain/settings/harness-catalog";

function response(harnessKind: string): HarnessLaunchOptionsResponse {
  return {
    harnessKind,
    basisRevision: "basis-1",
    revision: 3,
    state: "observed",
    options: {
      models: [
        { id: "fable", observedName: "Fable", observedDescription: "Observed upstream" },
        { id: "unknown-upstream", observedName: null, observedDescription: null },
      ],
      controls: [],
      defaults: { modelId: "fable", controlValues: {} },
    },
    observedAt: "2026-08-19T00:00:00Z",
    probeAttemptedAt: "2026-08-19T00:00:00Z",
    probeFailureCode: null,
    readiness: "ready",
  };
}

describe("normalizeRuntimeLaunchModels", () => {
  it("preserves every exact observed id and uses raw ids when names are absent", () => {
    expect(normalizeRuntimeLaunchModels("claude", response("claude"))).toEqual([
      { id: "fable", displayName: "Fable", description: "Observed upstream" },
      { id: "unknown-upstream", displayName: "unknown-upstream", description: null },
    ]);
  });

  it("does not leak another harness's target observation", () => {
    expect(normalizeRuntimeLaunchModels("codex", response("claude"))).toEqual([]);
  });
});
