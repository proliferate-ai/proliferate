import { describe, expect, it } from "vitest";
import {
  formatMcpActionLabel,
  formatMcpServerHint,
  parseMcpToolName,
} from "@/lib/domain/chat/mcp-tool-presentation";

describe("parseMcpToolName", () => {
  it("parses cowork artifact tool names", () => {
    expect(parseMcpToolName("mcp__cowork__create_artifact")).toEqual({
      server: "cowork",
      action: "create_artifact",
    });
  });

  it("keeps multi-underscore action names intact", () => {
    expect(parseMcpToolName("mcp__codex_apps__github_add_comment_to_issue")).toEqual({
      server: "codex_apps",
      action: "github_add_comment_to_issue",
    });
  });

  it("returns null for malformed MCP names", () => {
    expect(parseMcpToolName("create_artifact")).toBeNull();
    expect(parseMcpToolName("mcp__cowork")).toBeNull();
    expect(parseMcpToolName("mcp____create_artifact")).toBeNull();
  });
});

describe("MCP formatting helpers", () => {
  it("formats action names as sentence case", () => {
    expect(formatMcpActionLabel("github_add_comment_to_issue")).toBe(
      "Github add comment to issue",
    );
  });

  it("formats server names as title case", () => {
    expect(formatMcpServerHint("codex_apps")).toBe("Codex Apps");
  });
});
