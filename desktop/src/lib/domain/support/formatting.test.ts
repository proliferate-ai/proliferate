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
  it("returns an empty body so email compose starts clean", () => {
    expect(buildSupportEmailBody({
      source: "sidebar",
      intent: "general",
      workspaceName: "repo-a",
      workspaceLocation: "local",
    })).toBe("");
  });
});
