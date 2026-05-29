import { describe, expect, it } from "vitest";
import { parsePermissionOptionActions } from "./chat-input-helpers";

describe("chat input helpers", () => {
  it("parses typed permission option labels and option ids", () => {
    expect(parsePermissionOptionActions([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
      { optionId: "reject-always", label: "Reject always", kind: "reject_always" },
    ])).toEqual([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
      { optionId: "reject-always", label: "Reject always", kind: "reject_always" },
    ]);
  });

  it("keeps compatibility with ACP option names when parsing raw options", () => {
    expect(parsePermissionOptionActions([
      { option_id: "allow-once", name: "Allow once", kind: "allow_once" },
    ])).toEqual([
      { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
    ]);
  });
});
