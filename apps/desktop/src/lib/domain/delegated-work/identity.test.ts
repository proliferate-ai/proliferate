import { describe, expect, it } from "vitest";
import {
  buildDelegatedAgentIdentity,
  delegatedWorkVisualIdentity,
  shortDelegatedWorkId,
} from "@/lib/domain/delegated-work/identity";

describe("delegatedWorkVisualIdentity", () => {
  it("generates stable friendly names and semantic color classes", () => {
    const first = delegatedWorkVisualIdentity("link-abc123");
    const second = delegatedWorkVisualIdentity("link-abc123");

    expect(second).toEqual(first);
    expect(first.generatedName).toBeTruthy();
    expect(first.colorClassName).toMatch(/^bg-delegated-agent-/u);
    expect(first.colorClassName).not.toContain("emerald");
    expect(first.colorClassName).not.toContain("lime");
  });
});

describe("buildDelegatedAgentIdentity", () => {
  it("builds the canonical generated display handle", () => {
    const identity = buildDelegatedAgentIdentity({
      id: "subagent_abc123456",
      title: "API Surface Check",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sessionLinkId: "subagent_abc123456",
    });

    expect(identity.displayName).toBe(
      `${identity.generatedName} (API Surface Check abc123)`,
    );
    expect(identity.openTarget).toEqual({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sessionLinkId: "subagent_abc123456",
    });
  });
});

describe("shortDelegatedWorkId", () => {
  it("removes common prefixes and keeps ids compact", () => {
    expect(shortDelegatedWorkId("subagent_abcdef123456")).toBe("abcdef");
    expect(shortDelegatedWorkId("client-session:xyz987654")).toBe("xyz987");
  });
});
