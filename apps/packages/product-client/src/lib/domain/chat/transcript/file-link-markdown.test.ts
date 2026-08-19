import { describe, expect, it } from "vitest";
import {
  isEligibleLocalFileDestination,
  repairTranscriptFileLinks,
  scanTranscriptMarkdownLinks,
  stabilizeStreamingFileLink,
} from "./file-link-markdown";

describe("repairTranscriptFileLinks eligible prefixes", () => {
  it.each([
    ["[a](/repo/My Notes.md)", "[a](</repo/My%20Notes.md>)"],
    ["[a](~/repo/My Notes.md)", "[a](<~/repo/My%20Notes.md>)"],
    ["[a](./My Notes.md)", "[a](<./My%20Notes.md>)"],
    ["[a](../My Notes.md)", "[a](<../My%20Notes.md>)"],
    ["[a](C:/repo/My Notes.md)", "[a](<C:/repo/My%20Notes.md>)"],
    ["[a](C:\\repo\\My Notes.md)", "[a](<C:\\repo\\My%20Notes.md>)"],
  ])("repairs %s", (source, expected) => {
    expect(repairTranscriptFileLinks(source)).toBe(expected);
  });

  it("replaces every literal space and only literal spaces", () => {
    expect(repairTranscriptFileLinks("[a](/repo/A B C.md)"))
      .toBe("[a](</repo/A%20B%20C.md>)");
  });

  it("is idempotent", () => {
    const once = repairTranscriptFileLinks("[a](/repo/My Notes.md \"Read it\")");
    expect(once).toBe("[a](</repo/My%20Notes.md> \"Read it\")");
    expect(repairTranscriptFileLinks(once)).toBe(once);
  });
});

describe("repairTranscriptFileLinks non-local destinations", () => {
  it.each([
    "[a](//cdn.example.com/My Notes.md)",
    "[a](https://example.com/My Notes.md)",
    "[a](http://example.com/My Notes.md)",
    "[a](www.example.com/My Notes.md)",
    "[a](file:///repo/My Notes.md)",
    "[a](vscode://file/My Notes.md)",
    "[a](docs/My Notes.md)",
    "[a](/repo/My Notes.md)".replace("/repo", "*repo"),
    "[a](/repo/glob *.md)",
    "[a](/repo/[set].md)",
    "[a](/repo/{a,b}.md)",
  ])("leaves %s unchanged", (source) => {
    expect(repairTranscriptFileLinks(source)).toBe(source);
  });

  it("leaves a destination without any literal space unchanged", () => {
    expect(repairTranscriptFileLinks("[a](/repo/Notes.md)")).toBe("[a](/repo/Notes.md)");
  });

  it("treats ? and # as literal path characters", () => {
    expect(repairTranscriptFileLinks("[a](/repo/What is it?.md)"))
      .toBe("[a](</repo/What%20is%20it?.md>)");
    expect(repairTranscriptFileLinks("[a](/repo/Note #3.md)"))
      .toBe("[a](</repo/Note%20#3.md>)");
  });
});

describe("repairTranscriptFileLinks titles", () => {
  it.each([
    ["[a](/repo/My Notes.md \"Read it\")", "[a](</repo/My%20Notes.md> \"Read it\")"],
    ["[a](/repo/My Notes.md 'Read it')", "[a](</repo/My%20Notes.md> 'Read it')"],
    ["[a](/repo/My Notes.md (Read it))", "[a](</repo/My%20Notes.md> (Read it))"],
    [
      "[a](/repo/My Notes.md \"Read (it\")",
      "[a](</repo/My%20Notes.md> \"Read (it\")",
    ],
  ])("moves a complete title outside the wrapper for %s", (source, expected) => {
    expect(repairTranscriptFileLinks(source)).toBe(expected);
  });

  it("keeps balanced destination parentheses as destination content", () => {
    expect(repairTranscriptFileLinks("[a](/repo/Final (copy).md)"))
      .toBe("[a](</repo/Final%20(copy).md>)");
    expect(repairTranscriptFileLinks("[a](/repo/Final (copy).md \"T\")"))
      .toBe("[a](</repo/Final%20(copy).md> \"T\")");
  });

  it("keeps escaped destination parentheses", () => {
    expect(repairTranscriptFileLinks("[a](/repo/Final \\(copy.md)"))
      .toBe("[a](</repo/Final%20\\(copy.md>)");
  });

  it("does not mistake a quoted filename fragment for a title", () => {
    expect(repairTranscriptFileLinks("[a](/repo/say \"hi\".md)"))
      .toBe("[a](</repo/say%20\"hi\".md>)");
  });
});

describe("repairTranscriptFileLinks malformed input", () => {
  it.each([
    "[a](/repo/My Notes.md \"unclosed)",
    "[a](/repo/My Notes.md 'unclosed)",
    "[a](/repo/My\nNotes.md)",
    "[a](/repo/My Notes.md",
    "[a](/repo/My <Notes>.md)",
    "[a](/repo/My Notes.md (unbalanced)",
  ])("leaves the entire source unchanged for %s", (source) => {
    expect(repairTranscriptFileLinks(source)).toBe(source);
  });

  it("leaves an already angle-wrapped destination unchanged", () => {
    expect(repairTranscriptFileLinks("[a](</repo/My Notes.md>)"))
      .toBe("[a](</repo/My Notes.md>)");
  });
});

describe("repairTranscriptFileLinks code and image context", () => {
  it.each([
    "`[a](/repo/My Notes.md)`",
    "``[a](/repo/My `Notes.md)``",
    "```\n[a](/repo/My Notes.md)\n```",
    "````\n```\n[a](/repo/My Notes.md)\n````",
    "~~~\n[a](/repo/My Notes.md)\n~~~",
    "~~~~\n~~~\n[a](/repo/My Notes.md)\n~~~~",
    "```md\n[a](/repo/My Notes.md)\n```",
    "```\n``` info\n[a](/repo/My Notes.md)\n```",
    "text\n\n    [a](/repo/My Notes.md)\n",
    "![a](/repo/My Notes.md)",
  ])("leaves %s unchanged", (source) => {
    expect(repairTranscriptFileLinks(source)).toBe(source);
    expect(scanTranscriptMarkdownLinks(source).filter((link) => !link.isImage))
      .toHaveLength(0);
  });
});

describe("repairTranscriptFileLinks lists and escapes", () => {
  it("repairs a nested-list continuation, which is not indented code", () => {
    const source = "- item\n\n    [a](/repo/My Notes.md)\n";
    expect(repairTranscriptFileLinks(source))
      .toBe("- item\n\n    [a](</repo/My%20Notes.md>)\n");
  });

  it("repairs a plain list item", () => {
    expect(repairTranscriptFileLinks("- see [a](/repo/My Notes.md)"))
      .toBe("- see [a](</repo/My%20Notes.md>)");
  });

  it("honours the backslash run before the opener", () => {
    expect(repairTranscriptFileLinks("\\[a](/repo/My Notes.md)"))
      .toBe("\\[a](/repo/My Notes.md)");
    expect(repairTranscriptFileLinks("\\\\[a](/repo/My Notes.md)"))
      .toBe("\\\\[a](</repo/My%20Notes.md>)");
  });
});

describe("stabilizeStreamingFileLink", () => {
  it.each([
    ["[config](/Users/pablo/.codex/conf", "[config](/Users/pablo/.codex/conf)"],
    ["[config](../.codex/conf", "[config](../.codex/conf)"],
    ["[config](C:\\Users\\pablo\\conf", "[config](C:\\Users\\pablo\\conf)"],
    ["[a](/repo/My Notes", "[a](/repo/My Notes)"],
    ["[a](</repo/My Notes", "[a](</repo/My Notes>)"],
  ])("closes an unambiguous eligible tail: %s", (source, expected) => {
    expect(stabilizeStreamingFileLink(source)).toBe(expected);
  });

  it("feeds the closed tail into a normal repair pass", () => {
    expect(repairTranscriptFileLinks(stabilizeStreamingFileLink("[a](/repo/My Notes.md")))
      .toBe("[a](</repo/My%20Notes.md>)");
  });

  it.each([
    "[site](https://example.com/part",
    "[asset](//cdn.example.com/part",
    "[config](file:///Users/pablo/.codex/conf",
    "[config](<file:///Users/pablo/My%20Project/conf",
    "[config](vscode://file/conf",
    "![preview](/Users/pablo/image.png",
    "[config](/Users/pablo/.codex/config.toml)",
    "plain [unfinished label",
    "`[config](/Users/pablo/conf",
    "```\n[config](/Users/pablo/conf",
    "[a](/repo/My Notes.md \"open",
    "[a](/repo/My (Notes.md",
    "[a](/repo/glob *.md",
  ])("refuses to stabilize %s", (source) => {
    expect(stabilizeStreamingFileLink(source)).toBe(source);
  });
});

describe("isEligibleLocalFileDestination", () => {
  it("rejects control characters, tabs, and non-space whitespace", () => {
    expect(isEligibleLocalFileDestination("/repo/a\u0000b.md")).toBe(false);
    expect(isEligibleLocalFileDestination("/repo/a\tb.md")).toBe(false);
    expect(isEligibleLocalFileDestination("/repo/a\u007Fb.md")).toBe(false);
    expect(isEligibleLocalFileDestination("/repo/a\u00A0b.md")).toBe(false);
    expect(isEligibleLocalFileDestination("/repo/a b.md")).toBe(true);
  });
});
