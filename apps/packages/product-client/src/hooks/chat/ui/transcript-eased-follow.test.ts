/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY } from "#product/domain/chats/transcript/transcript-eased-follow-config";
import {
  readTranscriptEasedFollowEnabled,
  resolveEasedFollowStep,
  TRANSCRIPT_EASED_FOLLOW_CONVERGE_PX,
  TRANSCRIPT_EASED_FOLLOW_RATE,
} from "#product/hooks/chat/ui/transcript-eased-follow";

afterEach(() => {
  window.localStorage.removeItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY);
});

describe("resolveEasedFollowStep (PRO-168, rung 12)", () => {
  it("steps toward the target by the fixed rate, not converged, while the remaining distance is large", () => {
    const step = resolveEasedFollowStep(0, 1000);
    expect(step.converged).toBe(false);
    expect(step.nextTop).toBeCloseTo(1000 * TRANSCRIPT_EASED_FOLLOW_RATE);
  });

  it("eases from the other direction identically (symmetric in delta sign)", () => {
    const step = resolveEasedFollowStep(1000, 0);
    expect(step.converged).toBe(false);
    expect(step.nextTop).toBeCloseTo(1000 - 1000 * TRANSCRIPT_EASED_FOLLOW_RATE);
  });

  it("converges by snapping directly once within the convergence epsilon", () => {
    const almostThere = 500 + (TRANSCRIPT_EASED_FOLLOW_CONVERGE_PX - 0.1);
    const step = resolveEasedFollowStep(almostThere, 500);
    expect(step.converged).toBe(true);
    expect(step.nextTop).toBe(500);
  });

  it("reports converged immediately when already exactly at the target", () => {
    const step = resolveEasedFollowStep(240, 240);
    expect(step.converged).toBe(true);
    expect(step.nextTop).toBe(240);
  });

  it("repeated application converges to the target within a bounded number of frames", () => {
    let top = 0;
    const target = 4000;
    let frames = 0;
    let converged = false;
    while (!converged && frames < 200) {
      const step = resolveEasedFollowStep(top, target);
      top = step.nextTop;
      converged = step.converged;
      frames += 1;
    }
    expect(converged).toBe(true);
    expect(top).toBe(target);
    // At a 0.25/frame rate the geometric tail converges well under 200 frames.
    expect(frames).toBeLessThan(60);
  });
});

describe("readTranscriptEasedFollowEnabled (PRO-168, rung 12, Q16)", () => {
  it("reads OFF when the key is unset", () => {
    expect(readTranscriptEasedFollowEnabled()).toBe(false);
  });

  it("reads ON once the flag is explicitly set", () => {
    window.localStorage.setItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY, "on");
    expect(readTranscriptEasedFollowEnabled()).toBe(true);
  });
});
