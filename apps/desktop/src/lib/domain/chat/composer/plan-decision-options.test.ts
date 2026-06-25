import { describe, expect, it } from "vitest";
import { buildPlanDecisionEntries, isFeedbackOption } from "./plan-decision-options";

describe("plan decision options", () => {
  it("maps only emitted options with feedback presentation into feedback entries", () => {
    const entries = buildPlanDecisionEntries([
      { optionId: "yes", label: "Yes, implement this plan", kind: "allow_once" },
      {
        optionId: "no",
        label: "No, and tell Codex what to do differently",
        kind: "reject_once",
        presentation: {
          kind: "feedback_text_input",
          placeholder: "No, and tell Codex what to do differently",
        },
      },
    ]);

    expect(entries).toEqual([
      { type: "option", action: { optionId: "yes", label: "Yes, implement this plan", kind: "allow_once" } },
      {
        type: "feedback",
        action: {
          optionId: "no",
          label: "No, and tell Codex what to do differently",
          kind: "reject_once",
          presentation: {
            kind: "feedback_text_input",
            placeholder: "No, and tell Codex what to do differently",
          },
        },
      },
    ]);
  });

  it("does not infer a feedback entry from rejection copy", () => {
    expect(isFeedbackOption({
      optionId: "no",
      label: "No, and tell Codex what to do differently",
      kind: "reject_once",
    })).toBe(false);
  });

  it("trusts the feedback presentation instead of permission kind semantics", () => {
    expect(isFeedbackOption({
      optionId: "yes",
      label: "Tell agent what to do",
      kind: "allow_once",
      presentation: {
        kind: "feedback_text_input",
        placeholder: "Tell agent what to do",
      },
    })).toBe(true);
  });
});
