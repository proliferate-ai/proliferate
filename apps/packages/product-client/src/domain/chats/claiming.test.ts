import { describe, expect, it } from "vitest";
import { canContinueInDesktop, deriveClaimState, getPrimaryChatAction, isClaimable, isTeamChat } from "./claiming";
import type { ProductChat, ProductUser } from "./model";

const currentUser: ProductUser = { id: "u1", displayName: "Pablo" };

function chat(input: Partial<ProductChat>): ProductChat {
  return {
    id: "c1",
    workspaceId: "w1",
    title: "Test",
    kind: "slack",
    status: "idle",
    ...input,
  };
}

describe("chat claiming", () => {
  it("marks team chat kinds as claimable", () => {
    expect(isTeamChat("slack")).toBe(true);
    expect(isTeamChat("shared-auto")).toBe(true);
    expect(isTeamChat("shared-chat")).toBe(true);
    expect(isClaimable("cloud")).toBe(false);
    expect(isClaimable("dispatch")).toBe(false);
  });

  it("derives unclaimed state for unclaimed team chats", () => {
    expect(deriveClaimState(chat({ claimantUserId: null }), currentUser)).toEqual({
      kind: "unclaimed",
    });
    expect(getPrimaryChatAction(chat({ claimantUserId: null }), currentUser)).toEqual({
      kind: "claim",
      label: "Claim",
    });
  });

  it("allows the claimant to continue in desktop", () => {
    const claimed = chat({ claimantUserId: currentUser.id, claimantName: currentUser.displayName });

    expect(deriveClaimState(claimed, currentUser)).toEqual({ kind: "claimed_by_me" });
    expect(canContinueInDesktop(claimed, currentUser)).toBe(true);
    expect(getPrimaryChatAction(claimed, currentUser)).toEqual({
      kind: "continue_in_desktop",
      label: "Continue in desktop",
    });
  });

  it("does not expose a primary action when someone else claimed a team chat", () => {
    const claimed = chat({ claimantUserId: "u2", claimantName: "Jo" });

    expect(deriveClaimState(claimed, currentUser)).toEqual({
      kind: "claimed_by_other",
      claimantName: "Jo",
    });
    expect(canContinueInDesktop(claimed, currentUser)).toBe(false);
    expect(getPrimaryChatAction(claimed, currentUser)).toEqual({ kind: "none", label: "" });
  });
});
