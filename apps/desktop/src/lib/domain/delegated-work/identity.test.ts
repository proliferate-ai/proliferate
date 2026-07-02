import { describe, expect, it } from "vitest";
import {
  assignDistinctDelegatedColorIndices,
  buildDelegatedAgentIdentity,
  DELEGATED_AGENT_COLOR_COUNT,
  delegatedColorIndexFromSeed,
  delegatedWorkVisualIdentity,
  identiconSeedFromSalt,
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

  it("keeps the hashed color when no colorIndex is given (backward compat)", () => {
    const identity = delegatedWorkVisualIdentity("link-abc123");
    const hashedIndex = delegatedColorIndexFromSeed("link-abc123");

    expect(identity.colorToken).toBe(`delegated-agent-${hashedIndex + 1}`);
  });

  it("selects the palette entry for an in-range colorIndex", () => {
    const identity = delegatedWorkVisualIdentity("any-seed", 8);

    expect(identity.colorToken).toBe("delegated-agent-9");
    expect(identity.textColorClassName).toBe("text-delegated-agent-9");
    expect(identity.colorVar).toBe("var(--color-delegated-agent-9)");
  });

  it("falls back to the hash for out-of-range or fractional indices", () => {
    const hashed = delegatedWorkVisualIdentity("any-seed").colorToken;

    expect(delegatedWorkVisualIdentity("any-seed", DELEGATED_AGENT_COLOR_COUNT).colorToken)
      .toBe(hashed);
    expect(delegatedWorkVisualIdentity("any-seed", -1).colorToken).toBe(hashed);
    expect(delegatedWorkVisualIdentity("any-seed", 2.5).colorToken).toBe(hashed);
  });

  it("exposes sixteen distinct palette entries", () => {
    const tokens = new Set(
      Array.from({ length: DELEGATED_AGENT_COLOR_COUNT }, (_, index) =>
        delegatedWorkVisualIdentity("any-seed", index).colorToken),
    );

    expect(DELEGATED_AGENT_COLOR_COUNT).toBe(16);
    expect(tokens.size).toBe(16);
  });

  it("does not let a colorIndex change the generated name", () => {
    expect(delegatedWorkVisualIdentity("any-seed", 5).generatedName)
      .toBe(delegatedWorkVisualIdentity("any-seed").generatedName);
  });
});

describe("assignDistinctDelegatedColorIndices", () => {
  it("assigns pure position indices with no repeats up to the palette size", () => {
    const seeds = Array.from({ length: DELEGATED_AGENT_COLOR_COUNT }, (_, i) => `seed-${i}`);
    const indices = assignDistinctDelegatedColorIndices(seeds);

    expect([...indices.values()]).toEqual(seeds.map((_, i) => i));
    expect(new Set(indices.values()).size).toBe(DELEGATED_AGENT_COLOR_COUNT);
  });

  it("wraps past the palette size instead of throwing", () => {
    const seeds = Array.from({ length: DELEGATED_AGENT_COLOR_COUNT + 3 }, (_, i) => `seed-${i}`);
    const indices = assignDistinctDelegatedColorIndices(seeds);

    expect(indices.get(`seed-${DELEGATED_AGENT_COLOR_COUNT}`)).toBe(0);
    expect(indices.get("seed-2")).toBe(2);
  });

  it("is deterministic and keeps the first entry for a duplicated seed", () => {
    const indices = assignDistinctDelegatedColorIndices(["a", "b", "a", "c"]);

    expect(indices.get("a")).toBe(0);
    expect(indices).toEqual(assignDistinctDelegatedColorIndices(["a", "b", "a", "c"]));
  });
});

describe("identiconSeedFromSalt", () => {
  it("returns the natural seed for salt zero and distinct seeds otherwise", () => {
    const seedHash = 0x1234abcd;

    expect(identiconSeedFromSalt(seedHash, 0)).toBe(seedHash);
    expect(identiconSeedFromSalt(seedHash, 1)).not.toBe(seedHash);
    expect(identiconSeedFromSalt(seedHash, 2)).not.toBe(identiconSeedFromSalt(seedHash, 1));
    expect(identiconSeedFromSalt(seedHash, 1)).toBe(identiconSeedFromSalt(seedHash, 1));
  });
});

describe("buildDelegatedAgentIdentity", () => {
  it("applies a sibling-assigned colorIndex and folds shapeSalt into iconSeedHash", () => {
    const base = buildDelegatedAgentIdentity({
      id: "subagent_abc123456",
      title: "API Surface Check",
      sessionLinkId: "link-abc123",
    });
    const assigned = buildDelegatedAgentIdentity({
      id: "subagent_abc123456",
      title: "API Surface Check",
      sessionLinkId: "link-abc123",
      colorIndex: 4,
      shapeSalt: 2,
    });

    expect(assigned.colorToken).toBe("delegated-agent-5");
    expect(assigned.iconSeedHash).toBe(identiconSeedFromSalt(base.iconSeedHash, 2));
    expect(assigned.iconSeedHash).not.toBe(base.iconSeedHash);
    expect(assigned.generatedName).toBe(base.generatedName);
    expect(assigned.displayName).toBe(base.displayName);
  });

  it("derives the identicon seed from the same seed as name and color", () => {
    const identity = buildDelegatedAgentIdentity({
      id: "subagent_abc123456",
      title: "API Surface Check",
      sessionId: "session-1",
      sessionLinkId: "link-abc123",
    });

    // The seed is sessionLinkId || sessionId || id; seeding the shape from the
    // raw id instead would make it diverge from name/color across surfaces.
    expect(identity.iconSeedHash).toBe(
      delegatedWorkVisualIdentity("link-abc123").iconSeedHash,
    );
    expect(identity.iconSeedHash).not.toBe(
      delegatedWorkVisualIdentity("subagent_abc123456").iconSeedHash,
    );
  });

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
