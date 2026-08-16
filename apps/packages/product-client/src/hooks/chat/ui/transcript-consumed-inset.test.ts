import { describe, expect, it } from "vitest";
import {
  initialTranscriptInsetState,
  reduceTranscriptInset,
  type TranscriptInsetState,
} from "#product/hooks/chat/ui/transcript-consumed-inset";

// Rung 7 / Q6: consumed-inset semantics as named state-machine transitions.
// submit does NOT consume, button click (consume_full) consumes, leaving the
// band resets, and a displacing (structural) shrink flags its upward clamp.
describe("reduceTranscriptInset", () => {
  const consumed = (
    structural: number,
    nonDisplacing: number,
    consumedPx: number,
  ): TranscriptInsetState => ({
    structuralInsetPx: structural,
    nonDisplacingInsetPx: nonDisplacing,
    consumedNonDisplacingInsetPx: consumedPx,
  });

  it("initial state has nothing consumed and clamps negatives", () => {
    expect(initialTranscriptInsetState({ structuralInsetPx: -5, nonDisplacingInsetPx: 200 }))
      .toEqual({ structuralInsetPx: 0, nonDisplacingInsetPx: 200, consumedNonDisplacingInsetPx: 0 });
  });

  it("consume_full consumes the whole overlay range", () => {
    const { state } = reduceTranscriptInset(consumed(120, 200, 0), { type: "consume_full" });
    expect(state.consumedNonDisplacingInsetPx).toBe(200);
  });

  it("leave_band resets the consumed range", () => {
    const { state } = reduceTranscriptInset(consumed(120, 200, 200), { type: "leave_band" });
    expect(state.consumedNonDisplacingInsetPx).toBe(0);
  });

  it("reset forgets the consumed range", () => {
    const { state } = reduceTranscriptInset(consumed(120, 200, 150), { type: "reset" });
    expect(state.consumedNonDisplacingInsetPx).toBe(0);
  });

  it("submit_repin does NOT consume the overlay (negative control on the ruling)", () => {
    // The core Q6 ruling. If a future change made submit consume, this fails.
    const before = consumed(120, 200, 60);
    const { state } = reduceTranscriptInset(before, { type: "submit_repin" });
    expect(state.consumedNonDisplacingInsetPx).toBe(60);
    expect(state).toEqual(before);
  });

  it("dock_inset_changed caps the consumed range to the shrunken overlay", () => {
    const { state } = reduceTranscriptInset(consumed(120, 200, 200), {
      type: "dock_inset_changed",
      structuralInsetPx: 120,
      nonDisplacingInsetPx: 80,
    });
    expect(state.nonDisplacingInsetPx).toBe(80);
    expect(state.consumedNonDisplacingInsetPx).toBe(80);
  });

  it("dock_inset_changed preserves a consumed share when the overlay does not shrink past it", () => {
    const { state } = reduceTranscriptInset(consumed(120, 200, 50), {
      type: "dock_inset_changed",
      structuralInsetPx: 120,
      nonDisplacingInsetPx: 300,
    });
    expect(state.consumedNonDisplacingInsetPx).toBe(50);
  });

  it("flags structuralShrinkClamp when the structural inset shrinks (composer collapse)", () => {
    const { structuralShrinkClamp } = reduceTranscriptInset(consumed(120, 0, 0), {
      type: "dock_inset_changed",
      structuralInsetPx: 40,
      nonDisplacingInsetPx: 0,
    });
    expect(structuralShrinkClamp).toBe(true);
  });

  it("NEGATIVE CONTROL: a structural GROWTH does not flag a shrink clamp", () => {
    const { structuralShrinkClamp } = reduceTranscriptInset(consumed(40, 0, 0), {
      type: "dock_inset_changed",
      structuralInsetPx: 120,
      nonDisplacingInsetPx: 0,
    });
    expect(structuralShrinkClamp).toBe(false);
  });

  it("NEGATIVE CONTROL: a pure overlay change (structural unchanged) does not flag a structural clamp", () => {
    const { structuralShrinkClamp } = reduceTranscriptInset(consumed(120, 200, 0), {
      type: "dock_inset_changed",
      structuralInsetPx: 120,
      nonDisplacingInsetPx: 40,
    });
    expect(structuralShrinkClamp).toBe(false);
  });
});
