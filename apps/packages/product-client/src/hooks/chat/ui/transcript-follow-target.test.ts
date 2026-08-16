import { describe, expect, it } from "vitest";
import { resolveTranscriptFollowTarget } from "#product/hooks/chat/ui/transcript-follow-target";

// Rung 7 / Q6: the single named follow-target derivation. Structural inset is
// already reflected in scrollHeight (paddingEnd); the manual-only overlay holds
// the follow above the hard bottom until consumed.
describe("resolveTranscriptFollowTarget", () => {
  const base = { scrollHeight: 4000, clientHeight: 600 };

  it("with no overlay inset, follows to the raw scrollHeight (hard bottom incl. structural)", () => {
    const top = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 120, nonDisplacingInsetPx: 0 },
      consumedNonDisplacingInsetPx: 0,
    });
    expect(top).toBe(4000);
  });

  it("holds a remaining overlay inset above the hard bottom", () => {
    const top = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 120, nonDisplacingInsetPx: 200 },
      consumedNonDisplacingInsetPx: 0,
    });
    // hardBottom = 4000 - 600 = 3400; minus the 200 unconsumed overlay = 3200.
    expect(top).toBe(3200);
  });

  it("consuming the whole overlay follows to the raw scrollHeight", () => {
    const top = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 120, nonDisplacingInsetPx: 200 },
      consumedNonDisplacingInsetPx: 200,
    });
    expect(top).toBe(4000);
  });

  it("consuming part of the overlay holds above by the remaining share only", () => {
    const top = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 120, nonDisplacingInsetPx: 200 },
      consumedNonDisplacingInsetPx: 50,
    });
    // remaining manual = 200 - 50 = 150; hardBottom 3400 - 150 = 3250.
    expect(top).toBe(3250);
  });

  it("NEGATIVE CONTROL: a growing structural inset does NOT subtract from the pinned target (double-compensation guard)", () => {
    // The structural inset lives in scrollHeight already. Two targets that
    // differ ONLY by their declared structural inset (same scrollHeight) must
    // land at the same follow target — a derivation that wrongly subtracted the
    // structural inset would diverge here.
    const shortDock = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 40, nonDisplacingInsetPx: 0 },
      consumedNonDisplacingInsetPx: 0,
    });
    const tallDock = resolveTranscriptFollowTarget({
      ...base,
      dockInset: { structuralInsetPx: 400, nonDisplacingInsetPx: 0 },
      consumedNonDisplacingInsetPx: 0,
    });
    expect(tallDock).toBe(shortDock);
    expect(tallDock).toBe(4000);
  });

  it("clamps a consumed value above the inset and never returns below zero", () => {
    expect(
      resolveTranscriptFollowTarget({
        scrollHeight: 100,
        clientHeight: 600,
        dockInset: { structuralInsetPx: 0, nonDisplacingInsetPx: 5000 },
        consumedNonDisplacingInsetPx: -10,
      }),
    ).toBe(0);
  });
});
