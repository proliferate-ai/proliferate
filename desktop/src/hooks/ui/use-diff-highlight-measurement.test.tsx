// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finishMeasurementOperation,
  getDebugMeasurementDump,
  resetDebugMeasurementForTest,
  startMeasurementOperation,
} from "@/lib/infra/debug-measurement";
import { useDiffHighlight } from "@/hooks/ui/use-diff-highlight";

const SECRET_PATCH = [
  "diff --git a/secret/path.ts b/secret/path.ts",
  "index secret..secret",
  "--- a/secret/path.ts",
  "+++ b/secret/path.ts",
  "@@ -1 +1 @@",
  "-SECRET_PATCH_CONTENT",
  "+replacement",
].join("\n");

describe("useDiffHighlight measurement", () => {
  afterEach(() => {
    cleanup();
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not emit diagnostics while measurement is disabled", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "0");
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "0");
    renderHook(() => useDiffHighlight(SECRET_PATCH));

    expect(getDebugMeasurementDump().recentMetrics).toHaveLength(0);
  });

  it("emits only sanitized diff diagnostics", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_ANYHARNESS_TIMING", "1");
    const table = vi.spyOn(console, "table").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const operationId = startMeasurementOperation({
      kind: "diff_review_sample",
      surfaces: ["diff-viewer"],
      sampleKey: "diff_review",
    });
    expect(operationId).not.toBeNull();

    renderHook(() => useDiffHighlight(SECRET_PATCH, undefined, operationId));
    finishMeasurementOperation(operationId!, "completed");

    const rows = table.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const diagnosticTargets = rows
      .filter((row) => row.rowKind === "diagnostic")
      .map((row) => row.target);
    expect(diagnosticTargets).toEqual(expect.arrayContaining([
      "diff_viewer:patch_bytes",
      "diff_viewer:diff_lines",
      "diff_viewer:parse_patch",
    ]));
    const serialized = JSON.stringify(getDebugMeasurementDump());
    expect(serialized).not.toContain("secret/path.ts");
    expect(serialized).not.toContain("SECRET_PATCH_CONTENT");
  });
});
