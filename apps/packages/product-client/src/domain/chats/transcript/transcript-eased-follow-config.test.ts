/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  readTranscriptEasedFollowEnabled,
  resolveTranscriptEasedFollowEnabled,
  TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY,
} from "./transcript-eased-follow-config";

afterEach(() => {
  window.localStorage.removeItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY);
});

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

describe("readTranscriptEasedFollowEnabled", () => {
  it("reads OFF when the key is unset", () => {
    expect(readTranscriptEasedFollowEnabled()).toBe(false);
  });

  it("reads ON once the flag is explicitly set", () => {
    window.localStorage.setItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY, "on");
    expect(readTranscriptEasedFollowEnabled()).toBe(true);
  });
});
