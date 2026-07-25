import { describe, expect, it } from "vitest";
import {
  isSessionControlUpdatePending,
  resolveSessionControlTooltip,
} from "./session-control-tooltip";

describe("resolveSessionControlTooltip", () => {
  it("builds title, description, hint, and pending feedback as separate lines", () => {
    expect(resolveSessionControlTooltip({
      label: "Reasoning",
      value: "Medium",
      description: "Balances speed and depth.",
      hint: "Click to cycle.",
      pendingState: "submitting",
    })).toBe([
      "Reasoning: Medium",
      "Balances speed and depth.",
      "Click to cycle.",
      "Saving…",
    ].join("\n"));
  });

  it("describes queued updates without treating settled values as pending", () => {
    expect(resolveSessionControlTooltip({
      label: "Mode",
      value: "Plan",
      pendingState: "queued",
    })).toBe("Mode: Plan\nApplies after the current turn.");
    expect(isSessionControlUpdatePending("queued")).toBe(true);
    expect(isSessionControlUpdatePending("submitting")).toBe(true);
    expect(isSessionControlUpdatePending("settling")).toBe(false);
    expect(isSessionControlUpdatePending(null)).toBe(false);
  });
});
