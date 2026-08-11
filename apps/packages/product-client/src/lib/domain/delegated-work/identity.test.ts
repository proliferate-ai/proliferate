import { describe, expect, it } from "vitest";
import {
  buildDelegatedAgentIdentity,
  delegatedWorkVisualIdentity,
  shortDelegatedWorkId,
} from "#product/lib/domain/delegated-work/identity";

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
  it("shows only the real title with neutral identity until a durable session exists", () => {
    const first = buildDelegatedAgentIdentity({
      id: "tool-call-first",
      title: "Inspect API",
      sessionLinkId: "link-first",
    });
    const second = buildDelegatedAgentIdentity({
      id: "tool-call-second",
      title: "Inspect API",
      sessionLinkId: "link-second",
    });

    const visibleFields = (identity: typeof first) => ({
      generatedName: identity.generatedName,
      initial: identity.initial,
      title: identity.title,
      shortId: identity.shortId,
      displayName: identity.displayName,
      colorToken: identity.colorToken,
      colorClassName: identity.colorClassName,
      textColorClassName: identity.textColorClassName,
      borderColorClassName: identity.borderColorClassName,
      colorVar: identity.colorVar,
      glyphSeedHash: identity.glyphSeedHash,
      openTarget: identity.openTarget,
    });

    expect(visibleFields(first)).toEqual({
      generatedName: "Inspect API",
      initial: "I",
      title: "Inspect API",
      shortId: "",
      displayName: "Inspect API",
      colorToken: "neutral",
      colorClassName: "bg-muted",
      textColorClassName: "text-muted-foreground",
      borderColorClassName: "border-border",
      colorVar: "var(--color-muted-foreground)",
      glyphSeedHash: 0,
      openTarget: null,
    });
    expect(visibleFields(second)).toEqual(visibleFields(first));

    const durable = buildDelegatedAgentIdentity({
      id: first.id,
      title: first.title,
      sessionId: "session-durable",
      sessionLinkId: "link-third",
    });
    expect(durable.title).toBe(first.title);
    expect(durable.sessionId).toBe("session-durable");
    expect(durable.displayName).toContain("Inspect API");
    expect(durable.colorToken).toMatch(/^delegated-agent-/u);
    expect(durable.glyphSeedHash).toBe(
      delegatedWorkVisualIdentity("session-durable").glyphSeedHash,
    );
    expect(durable.openTarget?.sessionId).toBe("session-durable");
  });

  it("derives every visual field only from the durable session ID", () => {
    const first = buildDelegatedAgentIdentity({
      id: "subagent_first",
      title: "API Surface Check",
      sessionId: "session-1",
      sessionLinkId: "link-first",
    });
    const second = buildDelegatedAgentIdentity({
      id: "subagent_second",
      title: "API Surface Check",
      sessionId: "session-1",
      sessionLinkId: "link-second",
    });

    const visualFields = (identity: typeof first) => ({
      generatedName: identity.generatedName,
      colorToken: identity.colorToken,
      colorVar: identity.colorVar,
      glyphSeedHash: identity.glyphSeedHash,
      shortId: identity.shortId,
    });
    expect(visualFields(second)).toEqual(visualFields(first));
    expect(first.glyphSeedHash).toBe(
      delegatedWorkVisualIdentity("session-1").glyphSeedHash,
    );
    expect(first.glyphSeedHash).not.toBe(
      delegatedWorkVisualIdentity("link-first").glyphSeedHash,
    );
  });

  it("builds the canonical generated display handle", () => {
    const identity = buildDelegatedAgentIdentity({
      id: "subagent_abc123456",
      title: "API Surface Check",
      workspaceId: "workspace-1",
      sessionId: "session-abcdef987654",
      sessionLinkId: "subagent_abc123456",
    });

    expect(identity.displayName).toBe(
      `${identity.generatedName} (API Surface Check abcdef)`,
    );
    expect(identity.openTarget).toEqual({
      workspaceId: "workspace-1",
      sessionId: "session-abcdef987654",
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
