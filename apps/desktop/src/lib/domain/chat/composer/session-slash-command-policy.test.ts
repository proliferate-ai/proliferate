import { describe, expect, it } from "vitest";
import {
  filterDesktopRunnableSessionSlashCommands,
  matchSessionSlashCommandQuery,
  normalizeSlashCommandName,
} from "./session-slash-command-policy";

describe("session slash command policy", () => {
  it("normalizes command names without the slash prefix", () => {
    expect(normalizeSlashCommandName("/review-branch")).toBe("review-branch");
    expect(normalizeSlashCommandName("compact")).toBe("compact");
    expect(normalizeSlashCommandName("/bad command")).toBeNull();
  });

  it("keeps safe native and custom commands while hiding native client commands", () => {
    const commands = filterDesktopRunnableSessionSlashCommands([
      { name: "/login", description: "Sign in" },
      { name: "/bprocs", description: "Open background processes" },
      { name: "/init", description: "Create project instructions" },
      { name: "/config", description: "Open config" },
      { name: "/ship", description: "Custom project prompt", input: { hint: "scope" } },
      { name: "/mcp:server:prompt", description: "MCP prompt" },
      { name: "/review", description: "Review changes" },
      { name: "/review", description: "Duplicate review" },
    ]);

    expect(commands.map((command) => command.displayName)).toEqual([
      "/init",
      "/ship",
      "/mcp:server:prompt",
      "/review",
    ]);
    expect(commands.find((command) => command.name === "ship")?.inputHint).toBe("scope");
  });

  it("matches names, descriptions, and input hints", () => {
    const [command] = filterDesktopRunnableSessionSlashCommands([
      { name: "/ship", description: "Prepare a release", input: { hint: "target branch" } },
    ]);

    expect(command).toBeDefined();
    expect(matchSessionSlashCommandQuery(command!, "shi")).toBe(true);
    expect(matchSessionSlashCommandQuery(command!, "release")).toBe(true);
    expect(matchSessionSlashCommandQuery(command!, "branch")).toBe(true);
    expect(matchSessionSlashCommandQuery(command!, "login")).toBe(false);
  });
});
