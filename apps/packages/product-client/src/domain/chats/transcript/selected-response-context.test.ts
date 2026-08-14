import { describe, expect, it } from "vitest";
import {
  buildPromptWithSelectedResponseContexts,
} from "./selected-response-context";

describe("selected response context", () => {
  it("builds one explicit quoted context in every prompt representation", () => {
    const selectedText = "First line\nSecond line";
    const payload = buildPromptWithSelectedResponseContexts(
      "Explain this in more detail.",
      [{ text: selectedText }],
    );

    const expected = [
      "Explain this in more detail.",
      "",
      "Annotation 1:",
      "",
      "> First line",
      "> Second line",
    ].join("\n");
    expect(payload).toEqual({
      text: expected,
      blocks: [{ type: "text", text: expected }],
      optimisticContentParts: [{ type: "text", text: expected }],
    });
    expect(payload.text.match(/First line/gu)).toHaveLength(1);
    expect(payload.text.match(/Second line/gu)).toHaveLength(1);
  });

  it("numbers every annotation and carries its optional comment", () => {
    const payload = buildPromptWithSelectedResponseContexts("What differs?", [
      { text: "alpha" },
      { text: "beta", comment: "  compare with alpha  " },
    ]);

    const expected = [
      "What differs?",
      "",
      "Annotation 1:",
      "",
      "> alpha",
      "",
      "Annotation 2:",
      "",
      "> beta",
      "",
      "Comment: compare with alpha",
    ].join("\n");
    expect(payload.text).toBe(expected);
    expect(payload.text.match(/alpha/gu)).toHaveLength(2);
    expect(payload.text.match(/beta/gu)).toHaveLength(1);
    expect(payload.blocks).toHaveLength(1);
  });

  it("keeps the full excerpt in the prompt payload", () => {
    const selectedText = `start ${"context ".repeat(40)}finish`;
    const payload = buildPromptWithSelectedResponseContexts("", [{ text: selectedText }]);

    expect(payload.text).toContain(selectedText);
  });
});
