import { describe, expect, it } from "vitest";
import {
  invitationStatusBadge,
  membershipStatusBadge,
} from "./organization-records";

describe("membershipStatusBadge", () => {
  it("maps known membership statuses to presentation badges", () => {
    expect(membershipStatusBadge("active")).toEqual({
      label: "Active",
      tone: "success",
    });
    expect(membershipStatusBadge("removed")).toEqual({
      label: "Removed",
      tone: "destructive",
    });
  });

  it("falls back to the raw membership status", () => {
    expect(membershipStatusBadge("invited")).toEqual({
      label: "invited",
      tone: "neutral",
    });
  });
});

describe("invitationStatusBadge", () => {
  it("maps known invitation statuses to presentation badges", () => {
    expect(invitationStatusBadge("pending")).toEqual({
      label: "Pending",
      tone: "warning",
    });
    expect(invitationStatusBadge("accepted")).toEqual({
      label: "Accepted",
      tone: "success",
    });
    expect(invitationStatusBadge("revoked")).toEqual({
      label: "Revoked",
      tone: "destructive",
    });
    expect(invitationStatusBadge("expired")).toEqual({
      label: "Expired",
      tone: "neutral",
    });
  });

  it("falls back to the raw invitation status", () => {
    expect(invitationStatusBadge("bounced")).toEqual({
      label: "bounced",
      tone: "neutral",
    });
  });
});
