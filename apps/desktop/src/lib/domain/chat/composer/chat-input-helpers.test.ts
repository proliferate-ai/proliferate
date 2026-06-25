import { describe, expect, it } from "vitest";
import { parsePermissionOptionActions } from "./chat-input-helpers";

describe("chat input helpers", () => {
  it("parses typed permission option labels and option ids", () => {
    expect(parsePermissionOptionActions([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
      { optionId: "reject-always", label: "Reject always", kind: "reject_always" },
    ])).toEqual([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once", presentation: null },
      { optionId: "reject-always", label: "Reject always", kind: "reject_always", presentation: null },
    ]);
  });

  it("keeps compatibility with ACP option names when parsing raw options", () => {
    expect(parsePermissionOptionActions([
      { option_id: "allow-once", name: "Allow once", kind: "allow_once" },
    ])).toEqual([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once", presentation: null },
    ]);
  });

  it("parses explicit feedback text input presentation metadata", () => {
    expect(parsePermissionOptionActions([
      {
        optionId: "plan",
        label: "No, keep planning",
        kind: "reject_once",
        presentation: {
          kind: "feedback_text_input",
          placeholder: "No, keep planning",
        },
      },
    ])).toEqual([
      {
        optionId: "plan",
        label: "No, keep planning",
        kind: "reject_once",
        presentation: {
          kind: "feedback_text_input",
          placeholder: "No, keep planning",
        },
      },
    ]);
  });

  it("drops unknown presentation metadata", () => {
    expect(parsePermissionOptionActions([
      {
        optionId: "plan",
        label: "No, keep planning",
        kind: "reject_once",
        presentation: {
          kind: "unknown",
          placeholder: "No, keep planning",
        },
      },
    ])).toEqual([
      { optionId: "plan", label: "No, keep planning", kind: "reject_once", presentation: null },
    ]);
  });
});
