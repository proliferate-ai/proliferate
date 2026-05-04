import { describe, expect, it } from "vitest";
import { SUPPORT_MESSAGE_MAX_LENGTH } from "@/lib/domain/support/constants";
import {
  buildSupportEmailBody,
  clampSupportMessage,
  formatSupportContextLabel,
  normalizeSupportMessageForSend,
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

describe("clampSupportMessage", () => {
  it("keeps a message at the support limit intact", () => {
    const message = "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH);

    expect(clampSupportMessage(message)).toHaveLength(SUPPORT_MESSAGE_MAX_LENGTH);
  });

  it("clamps messages beyond the support limit", () => {
    const message = "a".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1);

    expect(clampSupportMessage(message)).toHaveLength(SUPPORT_MESSAGE_MAX_LENGTH);
  });
});

describe("normalizeSupportMessageForSend", () => {
  it("trims and clamps the payload sent to support", () => {
    const message = `  ${"a".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 5)}  `;

    expect(normalizeSupportMessageForSend(message)).toHaveLength(SUPPORT_MESSAGE_MAX_LENGTH);
  });
});
