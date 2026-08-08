import { describe, expect, it } from "vitest";
import {
  childOwnershipState,
  closeRequestedLabel,
  isCloseRequested,
  isSubordinateChild,
} from "./ownership";

describe("isCloseRequested", () => {
  it("reads a named closer as a close that has not landed yet", () => {
    expect(isCloseRequested({ closedBySessionId: "owner-1" })).toBe(true);
  });

  it("treats a blank or absent closer as no close request", () => {
    expect(isCloseRequested({ closedBySessionId: "   " })).toBe(false);
    expect(isCloseRequested({ closedBySessionId: null })).toBe(false);
    expect(isCloseRequested({})).toBe(false);
    expect(isCloseRequested(null)).toBe(false);
  });
});

describe("closeRequestedLabel", () => {
  it("names the reason when the closer gave one", () => {
    expect(closeRequestedLabel({
      closedBySessionId: "owner-1",
      closeReason: "superseded",
    })).toBe("Closing · superseded");
  });

  it("falls back to the bare state when no reason was given", () => {
    expect(closeRequestedLabel({ closedBySessionId: "owner-1" })).toBe("Closing");
  });

  it("says nothing about an agent nobody asked to close", () => {
    expect(closeRequestedLabel({ closeReason: "superseded" })).toBeNull();
  });
});

describe("childOwnershipState", () => {
  it("reads a promotion stamp as promoted even though the relation stays subagent", () => {
    expect(childOwnershipState({ promotedAt: "2026-08-08T01:00:00Z" })).toBe("promoted");
  });

  it("treats an unstamped child as subordinate", () => {
    expect(childOwnershipState({ promotedAt: null })).toBe("subagent");
    expect(childOwnershipState({})).toBe("subagent");
  });
});

describe("isSubordinateChild", () => {
  it("excludes a promoted child, which renders as a top-level agent", () => {
    expect(isSubordinateChild({ promotedAt: "2026-08-08T01:00:00Z" })).toBe(false);
    expect(isSubordinateChild({})).toBe(true);
  });
});
