import { describe, expect, it } from "vitest";
import { parseBackgroundCommandProcessId } from "./background-command-correlation";

describe("parseBackgroundCommandProcessId", () => {
  it("extracts the id from the literal background sentence", () => {
    expect(
      parseBackgroundCommandProcessId("Command running in background with ID: proc-abc123"),
    ).toBe("proc-abc123");
  });

  it("extracts the id when the sentence is embedded in more output", () => {
    const text = [
      "Starting watcher...",
      "Command running in background with ID: proc-xyz789",
      "",
    ].join("\n");
    expect(parseBackgroundCommandProcessId(text)).toBe("proc-xyz789");
  });

  it("strips trailing punctuation from the captured id", () => {
    expect(
      parseBackgroundCommandProcessId("Command running in background with ID: proc-abc123."),
    ).toBe("proc-abc123");
  });

  it("returns null for foreground command output (negative control)", () => {
    expect(parseBackgroundCommandProcessId("total 24\ndrwxr-xr-x  file.txt")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(parseBackgroundCommandProcessId("")).toBeNull();
  });

  it("returns null for near-miss text that doesn't match the exact sentence", () => {
    expect(
      parseBackgroundCommandProcessId("The command is running in the background, ID: proc-1"),
    ).toBeNull();
  });
});
