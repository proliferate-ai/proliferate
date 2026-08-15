import { expect, test, type Page } from "@playwright/test";

// Scroll-physics tier (specs/TESTING.md). The real transcript renderer, driven
// by the REAL @anyharness/sdk reducer through `window.__scrollPhysics`, is
// measured in real Chromium and WebKit. Everything external is absent. Each
// spec asserts an observable physics invariant from DOM probes and a per-frame
// scrollTop trace — never internal state.
//
// The 24px repin band lives at REPIN_BOTTOM_THRESHOLD_PX in
// hooks/chat/ui/transcript-row-list-model.ts.
const REPIN_BAND_PX = 24;
// While pinned and following a growing stream, the resting position sits a
// little above the true bottom (a soft bottom above the composer dock inset)
// and glue catch-up briefly widens the gap right after a batch lands. This
// bound is the "still following" ceiling: comfortably above that resting gap,
// far below the unbounded growth a lost follow would produce.
const PIN_FOLLOW_MAX_DISTANCE_PX = 120;

const VIEWPORT = "div.overflow-y-auto:has([data-transcript-virtualization-mode])";

interface Metrics {
  found: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  bottomDistance: number;
}

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__scrollPhysics !== "undefined");
}

async function drive<T = void>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ({ fn, args }) =>
      (window.__scrollPhysics as unknown as Record<string, (...a: unknown[]) => T>)[fn](...args),
    { fn, args },
  );
}

async function metrics(page: Page): Promise<Metrics> {
  return drive<Metrics>(page, "getMetrics");
}

// True pin state, read from the floating "Scroll to bottom" control.
async function isPinned(page: Page): Promise<boolean | null> {
  return drive<boolean | null>(page, "isPinned");
}

// Let React commit and the transcript's glue/measurement loops settle.
async function settle(page: Page, ms = 350): Promise<void> {
  await page.waitForTimeout(ms);
}

async function waitForViewport(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__scrollPhysics.hasViewport());
}

// Dispatch a real wheel gesture with the pointer over the transcript viewport,
// so the component's own wheel listener classifies it as user intent.
async function wheelOverViewport(page: Page, deltaY: number, steps = 6): Promise<void> {
  const box = await page.locator(VIEWPORT).boundingBox();
  if (!box) {
    throw new Error("transcript viewport not found for wheel gesture");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const per = deltaY / steps;
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(20);
  }
}

// Wheel upward until the viewport is within the older-history prefetch
// threshold (480px of the top), so the transcript actually requests older
// history. Bounded so a stuck viewport fails loudly rather than hanging.
async function wheelToTop(page: Page): Promise<void> {
  const box = await page.locator(VIEWPORT).boundingBox();
  if (!box) {
    throw new Error("transcript viewport not found for wheel-to-top");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 40; i += 1) {
    // Stop the moment older history is requested: continuing to wheel would
    // scroll past the anchor point captured at request time.
    const evidence = await drive<unknown>(page, "getLastPrependEvidence");
    if (evidence !== null) {
      return;
    }
    const m = await metrics(page);
    if (m.scrollTop <= 400) {
      return;
    }
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(30);
  }
}

// Wheel downward until the viewport ends inside the bottom repin band, moving
// down. A single large wheel delta is not portable (Chromium and WebKit scale
// wheel physics differently), so step until the bottom is reached.
async function wheelToBottom(page: Page): Promise<void> {
  const box = await page.locator(VIEWPORT).boundingBox();
  if (!box) {
    throw new Error("transcript viewport not found for wheel-to-bottom");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 60; i += 1) {
    const m = await metrics(page);
    if (m.bottomDistance <= 2) {
      return;
    }
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(30);
  }
}

test.describe("transcript scroll physics", () => {
  test("pinned-follow: bottom distance stays ~0 across streaming growth", async ({ page }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 6);
    await waitForViewport(page);
    await settle(page);

    const seeded = await metrics(page);
    expect(seeded.found).toBe(true);
    // A short viewport against tall turns must actually overflow, else the test
    // proves nothing.
    expect(seeded.scrollHeight).toBeGreaterThan(seeded.clientHeight + 100);
    expect(seeded.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);

    // Deterministic pinned baseline across engines before streaming.
    await wheelToBottom(page);
    await settle(page);
    expect(await isPinned(page)).toBe(true);

    await drive(page, "beginStreamingTurn");
    await settle(page);
    for (let batch = 0; batch < 25; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 60);
      const m = await metrics(page);
      // Pinned follow: the viewport stays glued near the growing bottom, the
      // distance stays bounded and never runs away. (The pin FLAG can flicker
      // for a frame on WebKit as a growth scroll is classified, so the physical
      // bottom-distance is the invariant here, not the flag; the flag is
      // asserted at the settled baseline above and after finalize below.)
      expect(m.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
    }
    await drive(page, "finalizeStreamingTurn");
    await settle(page);
    // Once the stream settles, the viewport remains glued to the bottom.
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
  });

  test("unpin mid-stream: reading holds unpinned, no snap-back to bottom", async ({ page }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 8);
    await waitForViewport(page);
    await settle(page);
    // Establish a deterministic pinned baseline: a downward gesture into the
    // bottom band pins reliably across engines (a single large seed batch can
    // leave WebKit physically at the bottom but with the pin flag momentarily
    // dropped).
    await wheelToBottom(page);
    await settle(page);
    expect(await isPinned(page)).toBe(true);

    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 4);
    await settle(page);
    // Streaming from the bottom stays pinned.
    expect(await isPinned(page)).toBe(true);

    // User reads back up mid-stream.
    await wheelOverViewport(page, -600);
    await settle(page);
    const afterScroll = await metrics(page);
    // The gesture unpins and we sit well away from the bottom.
    expect(await isPinned(page)).toBe(false);
    expect(afterScroll.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);

    // Stream keeps growing. The reader must NOT be snapped back to the bottom:
    // pin state stays unpinned and the bottom is never re-glued to ~0. (The
    // virtualizer may shift absolute scrollTop as off-screen rows measure, so
    // the invariant is pin state + bottom-distance, not a frozen scrollTop.)
    for (let batch = 0; batch < 20; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 50);
      expect(await isPinned(page)).toBe(false);
    }
    const afterGrowth = await metrics(page);
    expect(afterGrowth.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);
    await drive(page, "finalizeStreamingTurn");
  });

  test("repin band edge: returning into the bottom band re-pins; staying above does not", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 8);
    await waitForViewport(page);
    await settle(page);
    // Deterministic pinned baseline across engines.
    await wheelToBottom(page);
    await settle(page);
    expect(await isPinned(page)).toBe(true);

    // Below the band (read up): unpins.
    await wheelOverViewport(page, -500);
    await settle(page);
    expect(await isPinned(page)).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX);

    // A small downward nudge that ENDS above the band: stays unpinned, and
    // subsequent growth is not followed (bottom distance keeps growing).
    await wheelOverViewport(page, 60);
    await settle(page);
    const outside = await metrics(page);
    expect(outside.bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    expect(await isPinned(page)).toBe(false);
    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 6);
    await settle(page);
    expect(await isPinned(page)).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    await drive(page, "finalizeStreamingTurn");

    // A downward gesture that ENDS inside the bottom band (moving down):
    // re-pins, so subsequent growth follows the bottom again.
    await wheelToBottom(page);
    await settle(page);
    expect(await isPinned(page)).toBe(true);
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(REPIN_BAND_PX);
    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 8);
    await settle(page);
    // Re-pinned, so streaming growth is followed again (pin holds, distance
    // stays bounded near the bottom).
    expect(await isPinned(page)).toBe(true);
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
    await drive(page, "finalizeStreamingTurn");
  });

  // EXPECTED TO FAIL today (PRO-175). resetForSession always re-pins and snaps
  // to bottom on every session switch, then runs a glue loop across the newly
  // mounted rows — a revisit to a finalized session produces scrollTop motion
  // frames instead of restoring its prior position with zero visible motion.
  // Rung 2 introduces restore-finalized placement; unfixme there.
  test.fixme(
    "revisit-no-motion: switching back to a finalized session places with zero motion frames",
    async ({ page }) => {
      await ready(page);
      await drive(page, "reset");
      await drive(page, "seedFinalizedConversation", 8);
      await waitForViewport(page);
      await settle(page);

      // Visit a second finalized session, then return to the first.
      await drive(page, "switchSession", "session-secondary", 6);
      await settle(page);

      await drive(page, "startScrollTrace");
      await drive(page, "switchSession", "session-primary", 8);
      await settle(page, 600);
      const trace = await drive<number[]>(page, "stopScrollTrace");

      // Zero visible motion after placement: every recorded frame equal.
      const distinct = new Set(trace.filter((v) => Number.isFinite(v)));
      expect(distinct.size).toBeLessThanOrEqual(1);
    },
  );

  test("prepend anchoring: older-history prepend keeps the reading row fixed", async ({ page }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 12);
    // Exactly one prepend's worth of reservoir, so the anchor event is single
    // and unambiguous (the driver also records evidence for the first prepend
    // only).
    await drive(page, "setHasOlderHistory", true, 3);
    await waitForViewport(page);
    await settle(page);

    // Read up toward the top to cross the older-history prefetch threshold,
    // which fires onLoadOlderHistory -> a prepend of older turns above.
    await wheelToTop(page);
    await settle(page, 500);

    const evidence = await drive<{ preScrollTop: number; preScrollHeight: number } | null>(
      page,
      "getLastPrependEvidence",
    );
    expect(evidence, "a prepend should have been triggered by scrolling to the top").not.toBeNull();
    const after = await metrics(page);

    // Anchor invariant: scrollTop absorbs essentially all of the height added
    // above, so the reading row stays put. The anchoring signature is
    // scrollTopDelta ~= addedAbove; a BROKEN anchor would leave scrollTop near
    // its pre-value (delta ~0) and jump the reader to the newly prepended top.
    // The ratio band (not exact px) tolerates virtualizer row-height
    // re-measurement of the freshly mounted older rows while still failing hard
    // on a lost anchor. The transcript must also stay unpinned and NOT jump to
    // the top.
    const addedAbove = after.scrollHeight - evidence!.preScrollHeight;
    expect(addedAbove).toBeGreaterThan(100);
    expect(await isPinned(page)).toBe(false);
    expect(after.scrollTop).toBeGreaterThan(150);
    // The band is generous enough to absorb Blink/WebKit measurement
    // differences while still failing hard on a lost anchor (delta ~0).
    const scrollTopDelta = after.scrollTop - evidence!.preScrollTop;
    expect(scrollTopDelta).toBeGreaterThan(addedAbove * 0.6);
    expect(scrollTopDelta).toBeLessThan(addedAbove * 1.4);
  });

  // EXPECTED TO FAIL today (PRO-258). A wheel gesture over a long code block /
  // command output is captured by that inner overflow region; once the inner
  // region hits its end the gesture does NOT chain to the transcript viewport,
  // so the outer scroll stalls. Rung 8 restores nested-scroll chaining;
  // unfixme there.
  test.fixme(
    "nested-scroll chaining: wheel past a long code block continues transcript scroll",
    async ({ page }) => {
      await ready(page);
      await drive(page, "reset");
      await drive(page, "seedFinalizedConversation", 2);
      await drive(page, "appendCodeBlockTurn");
      await waitForViewport(page);
      await settle(page);

      // Park the viewport so the tall code block is under the pointer.
      await wheelOverViewport(page, -1200);
      await settle(page);
      const before = await metrics(page);

      // Point at the inner code block region and wheel down hard: this should
      // exhaust the inner scroller and then chain to the transcript.
      const code = page.locator("pre, code").last();
      const box = await code.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 12; i += 1) {
          await page.mouse.wheel(0, 400);
          await page.waitForTimeout(20);
        }
      }
      await settle(page);
      const after = await metrics(page);
      // Chaining means the OUTER transcript advanced despite the inner region.
      expect(after.scrollTop).toBeGreaterThan(before.scrollTop + 20);
    },
  );
});
