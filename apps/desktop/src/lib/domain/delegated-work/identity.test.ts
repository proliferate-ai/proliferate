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

  it("derives color independently of the generated name", () => {
    // If color and name shared one index (the old bug), every occurrence of a
    // given name would always carry the same color. With independent derivations,
    // at least one name must appear with more than one color across many seeds.
    const colorsByName = new Map<string, Set<string>>();
    for (let index = 0; index < 300; index += 1) {
      const identity = delegatedWorkVisualIdentity(`agent-seed-${index}`);
      const colors = colorsByName.get(identity.generatedName) ?? new Set<string>();
      colors.add(identity.colorToken);
      colorsByName.set(identity.generatedName, colors);
    }

    const someNameHasMultipleColors = [...colorsByName.values()].some(
      (colors) => colors.size > 1,
    );
    expect(someNameHasMultipleColors).toBe(true);
  });

  it("draws from an expanded name pool, not the original eight", () => {
    const names = new Set<string>();
    for (let index = 0; index < 300; index += 1) {
      names.add(delegatedWorkVisualIdentity(`pool-seed-${index}`).generatedName);
    }
    expect(names.size).toBeGreaterThan(8);
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
