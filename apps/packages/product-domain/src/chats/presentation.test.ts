import { describe, expect, it } from "vitest";
import { chatKindPresentation, claimStateLabel } from "./presentation";

describe("chat presentation", () => {
  it("returns plain metadata for chat kinds", () => {
    expect(chatKindPresentation("slack")).toEqual({
      label: "Slack",
      description: "Team request from Slack",
      iconId: "message-square",
      tone: "green",
    });
  });

  it("formats claim state labels", () => {
    expect(claimStateLabel({ kind: "not_claimable" })).toBe("Personal");
    expect(claimStateLabel({ kind: "unclaimed" })).toBe("Unclaimed");
    expect(claimStateLabel({ kind: "claimed_by_me" })).toBe("Claimed by you");
    expect(claimStateLabel({ kind: "claimed_by_other", claimantName: "Jo" })).toBe("Claimed by Jo");
  });
});
