import { describe, expect, it } from "vitest";
import { resolveMoveProgressSteps } from "./move-progress";

describe("resolveMoveProgressSteps", () => {
  it("marks prepare active and the rest pending while running/started", () => {
    for (const phase of ["running", "started"] as const) {
      const steps = resolveMoveProgressSteps(phase);
      expect(steps.map((step) => step.status)).toEqual(["active", "pending", "pending", "pending"]);
    }
  });

  it("marks prepare done and transfer active at destination_ready", () => {
    const steps = resolveMoveProgressSteps("destination_ready");
    expect(steps.map((step) => step.status)).toEqual(["done", "active", "pending", "pending"]);
  });

  it("marks switch_over active once installed", () => {
    const steps = resolveMoveProgressSteps("installed");
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "active", "pending"]);
  });

  it("marks clean_up active at cutover", () => {
    const steps = resolveMoveProgressSteps("cutover");
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "done", "active"]);
  });

  it("marks every step done once completed", () => {
    const steps = resolveMoveProgressSteps("completed");
    expect(steps.map((step) => step.status)).toEqual(["done", "done", "done", "done"]);
  });

  it("keeps the step labels stable and ordered", () => {
    const steps = resolveMoveProgressSteps("running");
    expect(steps.map((step) => step.label)).toEqual([
      "Prepare",
      "Transfer sessions",
      "Switch over",
      "Clean up",
    ]);
  });
});
