import { describe, expect, it } from "vitest";
import { formatChatReadyContextLine } from "./chat-ready-context";

describe("formatChatReadyContextLine", () => {
  it("drops empty values and preserves display order", () => {
    expect(formatChatReadyContextLine({
      workspaceName: "runtime",
      branchLabel: null,
      agentDisplayName: "Codex",
      modelDisplayName: "GPT-5",
    })).toBe("runtime · Codex · GPT-5");
  });

  it("returns null when every value is empty", () => {
    expect(formatChatReadyContextLine({
      workspaceName: null,
      branchLabel: "",
      agentDisplayName: null,
      modelDisplayName: " ",
    })).toBeNull();
  });
});
