import { describe, expect, it } from "vitest";
import {
  buildSupportEmailBody,
  formatSupportContextLabel,
} from "@/lib/domain/support/formatting";

describe("formatSupportContextLabel", () => {
  it("prefers workspace location and name when available", () => {
    expect(formatSupportContextLabel({
      source: "sidebar",
      intent: "general",
      workspaceName: "repo-a",
      workspaceLocation: "cloud",
    })).toBe("cloud · repo-a");
  });

  it("falls back to pathname when no workspace is selected", () => {
    expect(formatSupportContextLabel({
      source: "settings",
      intent: "general",
      pathname: "/settings",
    })).toBe("/settings");
  });
});

describe("buildSupportEmailBody", () => {
  it("includes the normalized context label and intent", () => {
    expect(buildSupportEmailBody({
      source: "sidebar",
      intent: "general",
      workspaceName: "repo-a",
      workspaceLocation: "local",
    })).toContain("Context: local · repo-a");
  });
});
