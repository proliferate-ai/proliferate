import { describe, expect, it } from "vitest";
import { recognizeLeadingSlashCommand } from "./slash-command-recognition";
import type { SessionSlashCommandViewModel } from "./session-slash-command-policy";

const COMMANDS: SessionSlashCommandViewModel[] = [
  { id: "loop", name: "loop", displayName: "/loop", description: "Run repeatedly", inputHint: "interval", group: "Commands" },
  { id: "review", name: "review", displayName: "/review", description: "Review changes", inputHint: null, group: "Commands" },
  { id: "compact", name: "compact", displayName: "/compact", description: "Compact context", inputHint: null, group: "Commands" },
];

describe("recognizeLeadingSlashCommand", () => {
  it("returns null when draft is empty", () => {
    expect(recognizeLeadingSlashCommand("", COMMANDS)).toBeNull();
  });

  it("returns null when draft does not start with /", () => {
    expect(recognizeLeadingSlashCommand("hello /loop", COMMANDS)).toBeNull();
  });

  it("recognizes a known command followed by space", () => {
    const result = recognizeLeadingSlashCommand("/loop some args", COMMANDS);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("loop");
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(5);
  });

  it("recognizes a known command at end of string", () => {
    const result = recognizeLeadingSlashCommand("/review", COMMANDS);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("review");
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(7);
  });

  it("is case-insensitive", () => {
    const result = recognizeLeadingSlashCommand("/LOOP ", COMMANDS);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("loop");
  });

  it("returns null for unknown commands", () => {
    expect(recognizeLeadingSlashCommand("/unknown ", COMMANDS)).toBeNull();
  });

  it("returns null for partial prefix without trailing whitespace that is still the full draft", () => {
    // "/loo" is only a prefix of "loop" — not an exact match, so null.
    expect(recognizeLeadingSlashCommand("/loo", COMMANDS)).toBeNull();
  });

  it("handles leading whitespace before the slash", () => {
    const result = recognizeLeadingSlashCommand("  /compact ", COMMANDS);
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe("compact");
    expect(result!.start).toBe(2);
    expect(result!.end).toBe(10);
  });

  it("returns null for bare slash", () => {
    expect(recognizeLeadingSlashCommand("/", COMMANDS)).toBeNull();
    expect(recognizeLeadingSlashCommand("/ ", COMMANDS)).toBeNull();
  });
});
