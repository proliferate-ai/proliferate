import { describe, expect, it } from "vitest";
import { resolveTranscriptEasedFollowEnabled } from "./transcript-eased-follow-config";

describe("resolveTranscriptEasedFollowEnabled (PRO-168, rung 12, Q16)", () => {
  it("defaults OFF for null (key never set)", () => {
    expect(resolveTranscriptEasedFollowEnabled(null)).toBe(false);
  });

  it("defaults OFF for any value other than the explicit opt-in", () => {
    expect(resolveTranscriptEasedFollowEnabled("")).toBe(false);
    expect(resolveTranscriptEasedFollowEnabled("off")).toBe(false);
    expect(resolveTranscriptEasedFollowEnabled("1")).toBe(false);
    expect(resolveTranscriptEasedFollowEnabled("true")).toBe(false);
  });

  it("turns on only for the exact opt-in string", () => {
    expect(resolveTranscriptEasedFollowEnabled("on")).toBe(true);
  });
});
