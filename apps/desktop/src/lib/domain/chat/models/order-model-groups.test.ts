import { describe, expect, it } from "vitest";
import { orderModelGroupsActiveFirst } from "@/lib/domain/chat/models/order-model-groups";
import type { ModelSelectorGroup } from "@/lib/domain/chat/models/model-selector-types";

function group(kind: string): ModelSelectorGroup {
  return {
    kind,
    providerDisplayName: kind,
    models: [],
  };
}

describe("orderModelGroupsActiveFirst", () => {
  it("moves the active harness group to the front", () => {
    const groups = [group("claude"), group("codex"), group("opencode")];
    expect(orderModelGroupsActiveFirst(groups, "codex").map((g) => g.kind))
      .toEqual(["codex", "claude", "opencode"]);
  });

  it("preserves relative order of the remaining groups", () => {
    const groups = [group("a"), group("b"), group("c"), group("d")];
    expect(orderModelGroupsActiveFirst(groups, "c").map((g) => g.kind))
      .toEqual(["c", "a", "b", "d"]);
  });

  it("returns input order when active kind is already first", () => {
    const groups = [group("claude"), group("codex")];
    expect(orderModelGroupsActiveFirst(groups, "claude")).toBe(groups);
  });

  it("returns input order when active kind is null", () => {
    const groups = [group("claude"), group("codex")];
    expect(orderModelGroupsActiveFirst(groups, null)).toBe(groups);
  });

  it("returns input order when active kind matches no group", () => {
    const groups = [group("claude"), group("codex")];
    expect(orderModelGroupsActiveFirst(groups, "gemini")).toBe(groups);
  });

  it("does not mutate the input array", () => {
    const groups = [group("claude"), group("codex")];
    orderModelGroupsActiveFirst(groups, "codex");
    expect(groups.map((g) => g.kind)).toEqual(["claude", "codex"]);
  });
});
