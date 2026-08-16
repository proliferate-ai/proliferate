import { describe, expect, it } from "vitest";
import {
  findHarnessTransientBlockClass,
  HARNESS_TRANSIENT_BLOCK_MATRIX,
  type HarnessKind,
} from "./harness-transient-block-matrix";
import { CLOUD_AGENT_KIND_ORDER } from "#product/domain/chats/cloud/harness-availability";

describe("HARNESS_TRANSIENT_BLOCK_MATRIX (Q13, rung 10)", () => {
  it("covers every launchable cloud harness kind exactly once", () => {
    const covered = HARNESS_TRANSIENT_BLOCK_MATRIX.map((entry) => entry.harness).sort();
    const expected = [...CLOUD_AGENT_KIND_ORDER].sort();
    expect(covered).toEqual(expected);
  });

  it("today, no harness is classified as escaping the reserved-slot invariant", () => {
    // If this ever flips true for a harness, rung 10's fixture coverage must
    // grow with it (see the written live-measurement plan in the module
    // doc comment) before the invariant claim can be trusted for that
    // harness.
    for (const entry of HARNESS_TRANSIENT_BLOCK_MATRIX) {
      expect(entry.emitsUnclassifiedVisibleItemKind).toBe(false);
      expect(entry.emitsPersistentVisibleReasoning).toBe(false);
    }
  });

  it("resolves a known harness and returns undefined for an unknown one", () => {
    expect(findHarnessTransientBlockClass("claude")?.harness).toBe("claude");
    expect(findHarnessTransientBlockClass("unknown-harness" as HarnessKind)).toBeUndefined();
  });
});
