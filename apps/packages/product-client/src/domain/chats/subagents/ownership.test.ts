import { describe, expect, it } from "vitest";
import { closeRequestedLabel, isCloseRequested } from "./ownership";

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
