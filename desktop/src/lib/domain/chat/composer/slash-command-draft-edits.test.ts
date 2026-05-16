import { describe, expect, it } from "vitest";
import { findSlashCommandTrigger } from "./slash-command-draft-edits";

describe("slash command draft edits", () => {
  it("detects a leading slash command query", () => {
    expect(findSlashCommandTrigger("/rev", 4)).toEqual({
      start: 0,
      end: 4,
      query: "rev",
    });
  });

  it("allows leading whitespace before the command", () => {
    expect(findSlashCommandTrigger("\n  /compact", 11)).toEqual({
      start: 3,
      end: 11,
      query: "compact",
    });
  });

  it("replaces the whole token when the caret is inside it", () => {
    expect(findSlashCommandTrigger("/review later", 4)).toEqual({
      start: 0,
      end: 7,
      query: "rev",
    });
  });

  it("ignores inline slashes because native commands are prompt-leading", () => {
    expect(findSlashCommandTrigger("please /review", 14)).toBeNull();
  });

  it("ignores non-command paths and urls", () => {
    expect(findSlashCommandTrigger("src/app.ts", 5)).toBeNull();
    expect(findSlashCommandTrigger("https://example.com", 8)).toBeNull();
  });
});
