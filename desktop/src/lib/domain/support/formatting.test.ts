import { describe, expect, it } from "vitest";
import {
  buildSupportEmailBody,
  formatSupportContextLabel,
} from "@/lib/domain/support/formatting";

describe("formatSupportContextLabel", () => {
  it("combines workspace location and name when available", () => {
    expect(formatSupportContextLabel({
      source: "sidebar",
      intent: "general",
      workspaceName: "repo-a",
      workspaceLocation: "cloud",
    })).toBe("cloud · repo-a");
  });

  it("returns null when there is no workspace context", () => {
    expect(formatSupportContextLabel({
      source: "settings",
      intent: "general",
      pathname: "/settings",
    })).toBeNull();
  });
});

describe("buildSupportEmailBody", () => {
  it("appends support context below a clean email compose area", () => {
    expect(buildSupportEmailBody({
      source: "sidebar",
      intent: "general",
      workspaceName: "repo-a",
      workspaceLocation: "local",
      workspaceId: "workspace-1",
      pathname: "/workspace/workspace-1",
    })).toBe([
      "",
      "",
      "---",
      "Context: local · repo-a",
      "Workspace ID: workspace-1",
      "Path: /workspace/workspace-1",
      "Source: sidebar",
      "Intent: general",
    ].join("\n"));
  });
});
