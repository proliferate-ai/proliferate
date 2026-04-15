import { describe, expect, it } from "vitest";
import { formatImplementPlanDraft } from "./implementation-prompt";

describe("formatImplementPlanDraft", () => {
  it("references the plan document without duplicating the title", () => {
    expect(formatImplementPlanDraft("/tmp/plan.md")).toBe(
      "Carry out the approved plan document now:\n\n/tmp/plan.md",
    );
  });

  it("falls back when the document path is empty", () => {
    expect(formatImplementPlanDraft("  ")).toBe("Carry out the approved plan document now.");
  });
});
