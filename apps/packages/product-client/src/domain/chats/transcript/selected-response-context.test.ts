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
      "Selected response text:",
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

  it("keeps each attached response excerpt exactly once", () => {
    const payload = buildPromptWithSelectedResponseContexts("What differs?", [
      { text: "alpha" },
      { text: "beta" },
    ]);

    expect(payload.text.match(/alpha/gu)).toHaveLength(1);
    expect(payload.text.match(/beta/gu)).toHaveLength(1);
    expect(payload.blocks).toHaveLength(1);
  });

  it("keeps the full excerpt in the prompt payload", () => {
    const selectedText = `start ${"context ".repeat(40)}finish`;
    const payload = buildPromptWithSelectedResponseContexts("", [{ text: selectedText }]);

    expect(payload.text).toContain(selectedText);
  });
});
