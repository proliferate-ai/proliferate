import { describe, expect, it } from "vitest";
import {
  isIncompleteStreamingMermaidFence,
  isMermaidLanguage,
} from "./mermaid-fence";

describe("isMermaidLanguage", () => {
  it.each(["mermaid", "MERMAID", "Mermaid"])("accepts %s", (language) => {
    expect(isMermaidLanguage(language)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "typescript",
    "language-mermaid",
    "mermaid,foo",
    "mmd",
  ])("rejects %s", (language) => {
    expect(isMermaidLanguage(language)).toBe(false);
  });
});

describe("isIncompleteStreamingMermaidFence", () => {
  const mermaidBody = "flowchart LR\n  A --> B";

  it("is false when the message is not streaming", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```mermaid\n" + mermaidBody,
      code: mermaidBody,
      language: "mermaid",
      isStreaming: false,
    })).toBe(false);
  });

  it("is false for non-mermaid languages even when the fence is open", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```typescript\nconst ready = true;",
      code: "const ready = true;",
      language: "typescript",
      isStreaming: true,
    })).toBe(false);
  });

  it.each([
    ["backtick", "```mermaid\n"],
    ["tilde", "~~~mermaid\n"],
    ["uppercase", "```MERMAID\n"],
    ["padded info", "```  mermaid\n"],
    ["extra info token", "```mermaid foo\n"],
  ])("treats an unclosed %s opener as incomplete", (_name, opener) => {
    expect(isIncompleteStreamingMermaidFence({
      source: opener + mermaidBody,
      code: mermaidBody,
      language: "mermaid",
      isStreaming: true,
    })).toBe(true);
  });

  it("does not treat a comma-glued info token as mermaid", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```mermaid,foo\n" + mermaidBody,
      code: mermaidBody,
      language: "mermaid,foo",
      isStreaming: true,
    })).toBe(false);
  });

  it("requires a longer closer for a longer opener", () => {
    const source = "````mermaid\n" + mermaidBody + "\n````";
    expect(isIncompleteStreamingMermaidFence({
      source,
      code: mermaidBody,
      language: "mermaid",
      isStreaming: true,
    })).toBe(false);
    expect(isIncompleteStreamingMermaidFence({
      source: "````mermaid\n" + mermaidBody + "\n```",
      code: mermaidBody + "\n```",
      language: "mermaid",
      isStreaming: true,
    })).toBe(true);
  });

  it("is false once the trailing mermaid fence is closed", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```mermaid\n" + mermaidBody + "\n```",
      code: mermaidBody,
      language: "mermaid",
      isStreaming: true,
    })).toBe(false);
  });

  it("lets a closed mermaid fence render while later prose is still streaming", () => {
    const source = "```mermaid\n" + mermaidBody + "\n```\n\nHere is what this means";
    expect(isIncompleteStreamingMermaidFence({
      source,
      code: mermaidBody,
      language: "mermaid",
      isStreaming: true,
    })).toBe(false);
  });

  it("only flags the trailing mermaid fence when an earlier one is closed", () => {
    const first = "flowchart LR\n  A --> B";
    const second = "flowchart TB\n  C --> D";
    const source = [
      "```mermaid",
      first,
      "```",
      "",
      "```mermaid",
      second,
    ].join("\n");

    expect(isIncompleteStreamingMermaidFence({
      source,
      code: first,
      language: "mermaid",
      isStreaming: true,
    })).toBe(false);
    expect(isIncompleteStreamingMermaidFence({
      source,
      code: second,
      language: "mermaid",
      isStreaming: true,
    })).toBe(true);
  });

  it("does not flag a closed mermaid fence that shares a body with a later unclosed fence", () => {
    const body = mermaidBody;
    const source = [
      "```mermaid",
      body,
      "```",
      "",
      "```mermaid",
      body,
    ].join("\n");
    const trailingOpenerOffset = source.lastIndexOf("```mermaid");

    expect(isIncompleteStreamingMermaidFence({
      source,
      code: body,
      language: "mermaid",
      isStreaming: true,
      startLine: 1,
      startOffset: 0,
    })).toBe(false);
    expect(isIncompleteStreamingMermaidFence({
      source,
      code: body,
      language: "mermaid",
      isStreaming: true,
      startLine: 6,
      startOffset: trailingOpenerOffset,
    })).toBe(true);
  });

  it("does not trip on an incomplete non-mermaid fence", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```python\nprint(1)",
      code: "print(1)",
      language: "python",
      isStreaming: true,
    })).toBe(false);
  });

  it("does not treat inline mermaid or a prose line as a fence", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "I like the `mermaid` language.",
      code: "mermaid",
      language: null,
      isStreaming: true,
    })).toBe(false);
    expect(isIncompleteStreamingMermaidFence({
      source: "mermaid",
      code: "mermaid",
      language: null,
      isStreaming: true,
    })).toBe(false);
  });

  it("compares against the code-block body with a trailing newline stripped", () => {
    expect(isIncompleteStreamingMermaidFence({
      source: "```mermaid\n" + mermaidBody + "\n",
      code: mermaidBody,
      language: "mermaid",
      isStreaming: true,
    })).toBe(true);
  });
});
