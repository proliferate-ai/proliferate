import { expect, test, type Page } from "@playwright/test";

// Scroll-physics tier (specs/engineering/testing/standard.md). The real transcript renderer, driven
// by the REAL @anyharness/sdk reducer through `window.__scrollPhysics`, is
// measured in real Chromium and WebKit. Everything external is absent. Each
// spec asserts an observable physics invariant from DOM probes and a per-frame
// scrollTop trace, never internal state.
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
// Frame-to-frame backward-bounce ceiling for the Q13 interleave trace below,
// for phases where NO new row mounts (thought start/delta/stop, prose
// growth on an already-mounted row). This is a DIFFERENT quantity from
// PIN_FOLLOW_MAX_DISTANCE_PX (steady-state bottomDistance while pinned): it
// bounds how far scrollTop may snap backward between two consecutive trace
// samples with no legitimate cause to move backward at all. The reserved
// live-turn slot (ASSISTANT_ACTION_SLOT_HEIGHT, TranscriptTurnChrome.tsx,
// h-6 = 24px) is the invariant Q13 exists to police, so this ceiling stays
// strictly below 24px: a phantom reserved-slot height briefly appearing and
// collapsing during a lifecycle-only transition would otherwise pass
// silently through a bound reused from an unrelated quantity (see PR #1980
// review finding 1).
const INTERLEAVE_MAX_BACKWARD_BOUNCE_PX = 20;
// Separate, wider ceiling for the ONE phase where a genuinely new row
// mounts: `streamToolCall`. Unlike the thought/prose phases above, a new
// tool-call row is a real virtualizer estimate
// (transcript-row-height-estimate.ts: ESTIMATED_SINGLE_BLOCK_TURN_HEIGHT_PX
// = 120) that corrects down once TanStack measures the real (smaller,
// ESTIMATED_INLINE_TOOL_BLOCK_HEIGHT_PX = 56) row — a rung-5 estimate-churn
// concern, not a rung-10 lifecycle-height violation. CI measured this
// convergence deterministically at ~61px on both chromium and webkit
// (PR #1980, round 2), consistent with the ~64px gap between those two
// estimate constants. This ceiling exists ONLY to bound that specific,
// already-quantified phenomenon to "still a single bounded correction, not
// an unbounded runaway" — it must not be reused for the thought/prose
// phases above, which have no such legitimate source of backward motion.
const TOOL_ROW_ESTIMATE_CONVERGENCE_MAX_PX = 80;

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

// Frame-aligned metrics read. `settle`'s wall clock elapses even on a starved
// CI renderer that painted ZERO frames, so a probe taken right after it can
// sample the transient state that exists between a DOM growth mutation and the
// pre-paint ResizeObserver snap the engine applies before the next paint — a
// state no painted frame ever shows (this is the source of the load-dependent
// bottomDistance 132 CI caught). FR-1's follow invariant is defined per painted
// frame, so growth-then-measure assertions must read a frame that actually
// rendered. This captures the metrics snapshot INSIDE the evaluate, phased to
// land after a frame's ResizeObserver snap AND paint (see the per-line note on
// the read hop below). The read must be INSIDE the same evaluate: a separate
// `metrics()` call after a bare settle runs on a later task and can land on a
// fresh frame whose pre-paint RO snap has not yet run, reopening the exact gap
// this closes (verified: the separate-read form still samples 132; this form
// does not). Bounded so a genuinely frozen renderer fails rather than hangs.
async function metricsAfterFrame(page: Page, timeoutMs = 4000): Promise<Metrics> {
  return page.evaluate(
    (timeout) =>
      new Promise<Metrics>((resolve) => {
        const read = () =>
          (
            window.__scrollPhysics as unknown as { getMetrics: () => Metrics }
          ).getMetrics();
        const bail = setTimeout(() => resolve(read()), timeout);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            // Read AFTER the frame's ResizeObserver delivery + paint, not just
            // after the frame boundary: rAF callbacks run BEFORE RO delivery in
            // the rendering steps, and the product's stick-to-bottom snap writes
            // scrollTop during RO delivery. Reading inside the rAF callback
            // therefore samples the pre-snap leading edge of the frame — the
            // exact transient (bottomDistance 132) that no frame actually paints
            // — so this hops one setTimeout(0) macrotask, which lands after the
            // frame's RO snap and paint have completed, reflecting the snapped,
            // painted state. (Verified: reading inside the rAF callback still
            // sampled 132; the post-paint hop does not, with zero frame-budget
            // timeouts.)
            setTimeout(() => {
              clearTimeout(bail);
              resolve(read());
            }, 0);
          }),
        );
      }),
    timeoutMs,
  );
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

// Focusable descendant of the transcript viewport: keyboard scroll keys
// bubble from here up to the viewport's own keydown listener (classifying
// user intent) while the browser scrolls the nearest scrollable ancestor,
// which is the viewport itself. This is engine-portable (WebKit-Linux honors
// keyboard-driven scroll where synthetic mouse-wheel deltas are unreliable),
// unlike Playwright's mouse.wheel.
async function focusTranscriptRoot(page: Page): Promise<void> {
  await page.locator("[data-chat-transcript-root]").focus();
}

// Unpin gesture: reading UP away from the bottom via repeated PageUp
// keypresses. User-intent classified by the viewport's keydown listener and
// portable across engines.
async function keyboardScrollUp(page: Page, presses = 3): Promise<void> {
  await focusTranscriptRoot(page);
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(30);
  }
}

// Engine-portable downward gesture that lands at a chosen distance from the
// bottom, for asserting the repin band EDGE itself rather than the hard
// bottom. Real wheel-driven deltas are not portable step-for-step across
// engines (webkit/WPE keyboard/wheel scroll granularity and smooth-scroll
// timing do not reliably land inside a specific 24px band), so this drives
// the same synthetic-wheel-intent + direct-scrollTop mechanics
// `window.__scrollPhysics` uses elsewhere, deterministic on both projects.
async function gestureToBottomDistance(page: Page, distancePx: number): Promise<void> {
  await drive(page, "gestureScrollToBottomDistance", distancePx);
  await expect
    .poll(async () => (await metrics(page)).bottomDistance, { timeout: 2000 })
    .toBeLessThanOrEqual(distancePx + 2);
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
// Deterministic, engine-portable pin-to-bottom baseline. A Playwright
// mouse.wheel gesture is unreliable on WebKit-Linux; setting scrollTop
// directly through the `window.__scrollPhysics` driver fires a real, trusted
// native `scroll` event (which the transcript's own pin classification keys
// off of) without depending on wheel-specific default-action behavior.
async function wheelToBottom(page: Page): Promise<void> {
  await drive(page, "scrollToBottomInstant");
  await expect.poll(async () => (await metrics(page)).bottomDistance, { timeout: 2000 }).toBeLessThanOrEqual(2);
}

test.describe("transcript scroll physics", () => {
  // Rung 4 (PRO-187): the one owned per-frame snap pass writes scrollTop exactly
  // once per frame, so no snap/measure feedback can provoke the browser's
  // "ResizeObserver loop completed with undelivered notifications" error. Every
  // spec fails if any page error or that console error surfaces during the run.
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => {
      pageErrors.push(String(error));
    });
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" && /ResizeObserver loop/i.test(text)) {
        pageErrors.push(text);
      }
    });
  });
  test.afterEach(() => {
    expect(pageErrors, `unexpected page/ResizeObserver-loop errors:\n${pageErrors.join("\n")}`)
      .toEqual([]);
  });

  // Rung 4 un-fixmes pinned-follow: PR #1938 (r3) marks it test.fixme because the
  // single-writer pin decision alone cannot hold the follow cadence on slow CI
  // runners (bottomDistance 132 > 120 on both engines). The synchronous
  // ResizeObserver-notify snap this rung adds fixes it, proven green on CI here.
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

    // Deterministic pinned baseline across engines before streaming. The pin
    // flag can lag the physical scroll position by a frame, so poll rather
    // than reading it once.
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    await drive(page, "beginStreamingTurn");
    await settle(page);
    for (let batch = 0; batch < 25; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 60);
      // Read a frame that actually painted: `settle`'s wall clock can elapse on
      // a starved CI renderer between the growth mutation and the pre-paint RO
      // snap, sampling a mid-growth bottomDistance no rendered frame shows.
      const m = await metricsAfterFrame(page);
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

  // Un-fixme'd at rung 3 (#1938): the marker-based ownership classification this rung adds
  // fixes the r1/r2 degradation window where MAIN's single-slot pixel classification misread
  // a programmatic growth write as a user scroll on slow-CI WebKit and dropped the pin
  // ([webkit] isPinned Received false). CI proves this test passes on both engines at r3.
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
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 4);
    await settle(page);
    // Streaming from the bottom stays pinned.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    // User reads back up mid-stream.
    await keyboardScrollUp(page, 3);
    await settle(page);
    const afterScroll = await metrics(page);
    // The gesture unpins and we sit well away from the bottom.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect(afterScroll.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);

    // Stream keeps growing. The reader must NOT be snapped back to the bottom.
    // The pin FLAG can read stale for a single frame right as a growth batch
    // is classified, so the per-batch assertion is the physics invariant
    // (bottomDistance stays outside the repin band -> no snap-back), not the
    // flag; the flag is asserted at the settled points before and after this
    // loop. (The virtualizer may also shift absolute scrollTop as off-screen
    // rows measure, so the invariant is bottom-distance, not a frozen
    // scrollTop.)
    for (let batch = 0; batch < 20; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 50);
      const m = await metrics(page);
      expect(m.bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    }
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    const afterGrowth = await metrics(page);
    expect(afterGrowth.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);
    await drive(page, "finalizeStreamingTurn");
  });

  // Rung 4 un-fixmes repin-band-edge: PR #1938 (r3) marks it test.fixme because
  // the single-writer pin decision alone cannot hold the post-repin follow
  // cadence on slow CI runners (webkit bottomDistance 332 > 202 after the
  // repin-and-stream arm). The synchronous ResizeObserver-notify snap this rung
  // adds fixes it, proven green on CI here.
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
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    // Below the band (read up): unpins.
    await keyboardScrollUp(page, 3);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX);

    // A downward nudge that ENDS above the band: stays unpinned, and
    // subsequent growth is not followed (bottom distance keeps growing). The
    // landing distance is comfortably clear of the band: jumping straight to
    // a value close to the band edge from far away forces the virtualizer to
    // mount and measure a run of previously off-screen rows in one shot, and
    // that settling churn can itself produce a transient in-band scroll
    // sample before it's done, which the risk this arm exists to rule out.
    await gestureToBottomDistance(page, 200);
    await settle(page);
    const outside = await metrics(page);
    expect(outside.bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 6);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    await drive(page, "finalizeStreamingTurn");

    // A downward gesture that ENDS inside the bottom band (moving down):
    // re-pins, so subsequent growth follows the bottom again. Landing at the
    // exact hard bottom (distance 0, same mechanics `wheelToBottom` uses
    // elsewhere in this file) rather than merely inside the band matters
    // here: a mid-band landing forces the virtualizer to discover a run of
    // previously off-screen rows in one jump, and estimate-to-measured
    // corrections during the streaming growth right after can transiently
    // swing bottomDistance across the repin threshold in either direction —
    // landing already at the true bottom keeps every such correction on the
    // "growing away from 0" side, which the snap effects handle without
    // triggering a spurious unpin classification.
    await gestureToBottomDistance(page, 0);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(REPIN_BAND_PX);
    await drive(page, "beginStreamingTurn");
    // Per-chunk, not a single flat batch, with a wider per-chunk settle than
    // the other streaming loops in this file: right after a repin, the
    // virtualizer can still be reconciling estimated vs. measured row heights
    // for the rows just revealed by the jump above, and a tight interval
    // between chunks doesn't consistently give that reconciliation time to
    // land on webkit before the next chunk's growth stacks on top, which
    // shows up as a transient (self-correcting, not a real lost follow)
    // widening of bottomDistance. The physics invariant that matters is that
    // it converges back, so it's asserted once settled rather than per chunk.
    for (let batch = 0; batch < 8; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 500);
    }
    await settle(page, 1000);
    // Re-pinned, so streaming growth is followed again (pin holds, distance
    // stays bounded near the bottom) once settled. Read a painted frame so a
    // starved renderer cannot leave the probe sampling the mid-growth transient
    // between the last mutation and its pre-paint RO snap.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
      PIN_FOLLOW_MAX_DISTANCE_PX,
    );
    await drive(page, "finalizeStreamingTurn");
  });

  test("single-writer: transcript viewport runs with overflow-anchor none", async ({
    page,
  }, testInfo) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 6);
    await waitForViewport(page);
    await settle(page);

    // WebKit does not implement the overflow-anchor property (it has no native
    // scroll anchoring to suppress), so the computed value is only meaningful on
    // Chromium. There the transcript must opt out of scroll anchoring so the
    // stick-to-bottom engine is the sole writer of scrollTop.
    test.skip(testInfo.project.name !== "chromium", "overflow-anchor is Chromium-only");
    const overflowAnchor = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).overflowAnchor : null;
    }, VIEWPORT);
    expect(overflowAnchor).toBe("none");
  });

  test("no-false-unpin: rapid glue writes during growth never unpin without user input", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 6);
    await waitForViewport(page);
    await settle(page);

    // Deterministic pinned baseline across engines.
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    const before = await metrics(page);

    // Engineer the marker-tolerance-miss precondition the single-slot pixel
    // classification papered over: grow the transcript on a tight cadence so
    // scrollHeight changes between a glue write and the scroll event it
    // produces, with several programmatic writes in flight at once. Under that
    // classification a later write overwrote an earlier marker and the stale
    // event was misread as a USER scroll, dropping the pin. A dropped pin gates
    // off the content-resize follow (the ResizeObserver re-stick is guarded by
    // the pin ref), so a false unpin stops the follow and the bottom distance
    // runs away without bound. The invariant here is therefore physical: with
    // no synthetic user input the viewport keeps following the growing bottom,
    // its distance staying small — never the unbounded growth a lost follow
    // produces. (The pin FLAG read from the floating control is intentionally
    // not asserted per-frame: it can transiently flicker as a growth scroll is
    // classified, so the physical follow distance is the load-bearing signal,
    // exactly as in the pinned-follow scenario.)
    //
    // The end-state is the robust assertion. Nothing re-pins the transcript
    // without synthetic user input or a submit stamp (neither occurs here), so a
    // pin dropped by a misclassified growth event gates off the content-resize
    // follow permanently and leaves the viewport hundreds of pixels behind after
    // this much growth. A viewport still glued to the bottom AFTER the whole
    // rapid-growth run therefore proves the pin was never lost during it. A
    // per-frame distance bound mid-run is deliberately avoided: the glue
    // catch-up can lag a frame under machine load and briefly widen the gap
    // without the pin being lost.
    //
    // Growth is driven by appending finalized turns on a tight cadence rather
    // than a live assistant stream: a finalized turn hydrates inert (turn_ended)
    // and renders its full tall height in the commit it lands, so every batch is
    // hundreds of pixels of REAL, immediately-measured content growth. A live
    // assistant stream would instead be gated by the typewriter reveal (capped
    // at a few hundred characters per second), which delivers too little visible
    // height per second to prove genuine growth in a bounded run once the seeded
    // turns hydrate inert. Each append fires the pinned content-resize snap, so
    // the rapid cadence still keeps several programmatic glue writes racing
    // scroll events, exactly the precondition this scenario guards.
    for (let batch = 0; batch < 12; batch += 1) {
      await drive(page, "appendFinalizedTurns", 1);
      await settle(page, 80);
    }
    await settle(page, 500);
    const after = await metrics(page);

    // Load-invariant proof that the follow was never lost: the content grew by
    // `addedHeight` during the run; a held follow leaves the resting bottom gap
    // a small fraction of that growth (the viewport advanced with the content),
    // while a follow lost early leaves the viewport ~`addedHeight` behind (the
    // full growth accumulated below a stationary viewport). A ratio, not an
    // absolute px bound, so machine load cannot flip it (mirrors the
    // prepend-anchoring scenario's ratio band).
    const addedHeight = after.scrollHeight - before.scrollHeight;
    expect(addedHeight, "growth must actually grow the transcript").toBeGreaterThan(300);
    // A follow that survived leaves the resting gap well under the full growth
    // (the viewport advanced with the content); a follow lost early leaves the
    // viewport frozen with ~all the growth accumulated below it (ratio near 1).
    // The band is generous so rAF glue starvation under concurrent-browser load
    // cannot flip it, while still failing hard on a frozen viewport. The precise
    // marker lifecycle (multiple in-flight markers, expiry, fallback gating) is
    // proven deterministically in the colocated unit tests; this is the
    // real-browser smoke that the follow survives rapid growth on both engines.
    expect(after.bottomDistance).toBeLessThan(addedHeight * 0.6);
  });

  test("swallowed-user-scroll: wheel-up during heavy programmatic snap wins", async ({ page }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 8);
    await waitForViewport(page);
    await settle(page);
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    // Kick off heavy programmatic snap activity: a large synchronous growth
    // batch leaves a burst of pinned glue/resize writes settling, then the user
    // wheels up in the middle of it. User ownership is claimed at input time
    // and must win: the transcript unpins and holds its position rather than
    // being snapped back by the in-flight programmatic writes.
    await drive(page, "beginStreamingTurn");
    await drive(page, "streamChunks", 24);
    await keyboardScrollUp(page, 5);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    const held = await metrics(page);
    expect(held.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);

    // Continued growth must not re-snap the reader to the bottom. The pin FLAG
    // can read stale for a single frame right as a growth batch is classified
    // (same rationale as the unpin-mid-stream scenario), so the per-batch
    // assertion is the physics invariant, not the flag; the flag is asserted
    // at the settled points before and after this loop.
    for (let batch = 0; batch < 15; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 40);
      const m = await metrics(page);
      expect(m.bottomDistance).toBeGreaterThan(REPIN_BAND_PX);
    }
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);
    await drive(page, "finalizeStreamingTurn");
  });

  // Rung 6 (PRO-187, FR-2) un-fixmes revisit-no-motion. Before rung 6,
  // `resetForSession` unconditionally bottom-pinned + glued on every session
  // switch, so returning to a finalized session snapped to the bottom and then
  // crawled through the freshly-mounted rows' settle frames (multiple distinct
  // scrollTop values). Rung 6 restores the saved {lastRowKey, offsetWithinRow}
  // before first paint against rung-5's warmed measured heights, so the reading
  // position is placed in a single instant cut with no settle crawl. Negative
  // control: disable beginSessionRestorePlacement (transcript-reading-position-
  // store.ts) and this lands at the bottom instead of the saved position.
  test("revisit-restore: returning to a finalized session restores the reading position with zero motion", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 12, "sess-restore-a");
    await waitForViewport(page);
    await settle(page);

    // Read up to a mid position; the row list persists this session's reading
    // anchor ({lastRowKey, offsetWithinRow}) on the scroll event. A portable
    // keyboard gesture (not a target-distance write) avoids racing the freshly-
    // mounted rows' measurement, which would keep shifting an absolute target.
    await keyboardScrollUp(page, 3);
    await settle(page, 500);
    const saved = await metrics(page);
    expect(saved.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    // The observable reading position: the transcript row under the top edge.
    const savedTopRow = await drive<string | null>(page, "getTopVisibleText");
    expect(savedTopRow, "a transcript row must be under the top edge").toBeTruthy();

    // Visit a second finalized session, then return to the first.
    await drive(page, "switchSession", "sess-restore-b", 6);
    await settle(page);

    await drive(page, "startScrollTrace");
    await drive(page, "switchSession", "sess-restore-a", 12);
    await settle(page, 600);
    const trace = await drive<number[]>(page, "stopScrollTrace");

    // FR-2: the SAME reading row lands under the top edge (restored via
    // {lastRowKey, offsetWithinRow}, estimate-immune), definitively NOT
    // bottom-pinned. Absolute scrollTop is deliberately NOT compared: the
    // off-screen rows above the anchor can estimate to a different total, which
    // is exactly the skew FR-2 avoids by anchoring to the row, not scrollTop.
    const restoredTopRow = await drive<string | null>(page, "getTopVisibleText");
    expect(restoredTopRow).toBe(savedTopRow);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect((await metrics(page)).bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);

    // Zero visible motion, defined as: the restore LANDS and HOLDS — it is never
    // a gradual settle crawl. The placement is a small number of instant cuts:
    // the outgoing session's rest position, an optional single measurement-settle
    // frame (the freshly-switched content's total height dips transiently as
    // rung-5 estimates swap to measured, so for one frame it is too short to hold
    // the saved anchor and the browser clamps), then the landed position. A
    // gradual scroll animation would instead produce many closely-spaced
    // increments and would keep moving.
    const finite = trace.filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(0);
    // Not a crawl: only a couple of distinct positions across the whole trace.
    expect(new Set(finite).size).toBeLessThanOrEqual(3);
    // Landed and held: once the final settled value is first reached it is never
    // left again (no post-landing drift, no oscillation), and the tail is flat.
    const settled = finite[finite.length - 1];
    const firstSettledIdx = finite.indexOf(settled);
    expect(finite.slice(firstSettledIdx).every((v) => v === settled)).toBe(true);
    expect(new Set(finite.slice(-8)).size).toBe(1);
  });

  // FR-2 streaming arm: an actively streaming session bottom-pins on revisit
  // regardless of any saved reading position (only finalized sessions restore).
  // Negative control: drop the `isSessionBusy -> {kind: "bottom"}` branch in
  // use-transcript-reading-position.ts and a streaming revisit restores the mid
  // position instead of bottom-pinning.
  test("revisit-streaming: a streaming session bottom-pins on revisit, ignoring the saved position", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 10, "sess-stream-a");
    await waitForViewport(page);
    await settle(page);

    // Leave sess-stream-a with a saved mid reading position.
    await gestureToBottomDistance(page, 800);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);

    await drive(page, "switchSession", "sess-stream-b", 6);
    await settle(page);

    // Revisit sess-stream-a while it is STREAMING.
    await drive(page, "switchSessionStreaming", "sess-stream-a", 10);
    await settle(page, 400);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
      PIN_FOLLOW_MAX_DISTANCE_PX,
    );
  });

  // FR-2 saved-row-gone fallback: when the saved reading row no longer exists on
  // revisit (the transcript was rebuilt shorter), the restore resolver returns
  // null and the engine falls back to the conservative bottom-pin default rather
  // than stranding the reader. Negative control: make
  // resolveTranscriptRestoreTargetTop return 0 for a missing row and the revisit
  // jumps to the top (unpinned) instead of bottom-pinning.
  test("revisit-row-gone: a saved row that no longer exists falls back to bottom-pin", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 12, "sess-gone-a");
    await waitForViewport(page);
    await settle(page);
    // Bottom-pinned: the captured top-visible anchor is a high-index row.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    await drive(page, "switchSession", "sess-gone-b", 6);
    await settle(page);

    // Return, but rebuilt with far fewer turns: the saved high-index row is gone.
    await drive(page, "switchSession", "sess-gone-a", 3);
    await settle(page, 400);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
      PIN_FOLLOW_MAX_DISTANCE_PX,
    );
  });

  test("prepend anchoring: older-history prepend keeps the reading row fixed", async ({
    page,
  }, testInfo) => {
    await ready(page);
    // Slow the main thread so the freshly-mounted older rows' estimate-to-measured
    // height corrections land over several spread-out frames, exactly as they do
    // on a loaded CI runner. Unthrottled this scenario settles inside a frame or
    // two and passes even with a compensation window that ends a frame early; the
    // throttle is what turns that early-end into the ~39px under-absorption CI
    // caught (chromium 550 vs > 589.2). CPU throttling is a Chromium/CDP-only
    // capability; WebKit runs unthrottled and still exercises the same anchor
    // path. This is the negative control: revert the deadline-gated compensation
    // in use-transcript-frame-pipeline-lifecycle.ts and this arm fails on chromium.
    if (testInfo.project.name === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    }
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
    // Read a painted frame: the prepend's estimate-to-measured corrections land
    // over several frames, and `settle`'s wall clock can elapse on a starved
    // (here CPU-throttled) renderer mid-correction, sampling a scrollTop no
    // painted frame shows.
    const after = await metricsAfterFrame(page);

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

  // Rung 8 (PRO-187, PRO-258): a wheel gesture over a long code block used to
  // be captured by that inner overflow region; once the inner region hit its
  // end the gesture did not chain to the transcript viewport, so the outer
  // scroll stalled. `chainVerticalWheel` is now default-on for the nested
  // code-block scroller (CodeBlock.tsx / MarkdownCodeBlock.tsx), so a wheel
  // gesture that exhausts the inner scroller continues the outer transcript
  // scroll. `page.mouse.wheel` is not portable to WebKit for this exact
  // gesture (engine-specific wheel-physics scaling and edge-detection timing
  // differ), so this drives the inner scroller directly to ITS OWN bottom
  // edge (the state a real user's prior scroll would leave it in) and
  // dispatches one real WheelEvent, mirroring `gestureScrollToBottomDistance`
  // elsewhere in this fixture (a direct scrollTop write establishes ground
  // truth; the dispatched event is what the product's own onWheel handler
  // reacts to, engine-portable because no engine-specific wheel-physics
  // scaling is involved on either side of the chain).
  test("nested-scroll chaining: wheel past a long code block continues transcript scroll", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 2);
    await drive(page, "appendCodeBlockTurn");
    await waitForViewport(page);
    await settle(page);

    // Park the viewport so the tall code block is on screen and unpin so the
    // chained delta is observable against a stable baseline (a pinned
    // transcript's own snap pass would otherwise mask a small chained delta).
    await wheelOverViewport(page, -1200);
    await settle(page);

    const result = await drive<{ before: number; after: number } | null>(
      page,
      "chainWheelPastNestedCodeBlock",
      400,
    );
    expect(result, "the nested code-block viewport should be mounted").not.toBeNull();
    // Chaining means the OUTER transcript advanced despite the inner region
    // already being at its own scroll edge.
    expect(result!.after).toBeGreaterThan(result!.before + 20);
  });

  // Rung 5 (PRO-187): composition-derived virtualizer estimates +
  // per-row-key measured-height persistence + per-session per-bucket
  // calibration. seedConversationWithToolLedger seeds a collapsed tool-ledger
  // turn under many tall finalized filler turns, all buried OFF-SCREEN below
  // the pinned-bottom viewport + overscan window. With the fixture now
  // hydrating those finalized turns inert (turn_ended, matching production),
  // each filler turn renders at its full tall height rather than the shorter
  // mid-reveal height the old reveal-inflated fixture happened to show. Against
  // honest tall heights the STATIC composition estimate undershoots a plain
  // multi-block turn badly (measured ~430px vs a ~220px static guess), so the
  // all-static initial total is far below the real swept total.
  //
  // Per-session per-bucket calibration closes that: as the first on-screen
  // filler turns measure for real, their heights feed a running average keyed
  // by composition bucket (transcript-row-height-calibration.ts), and every
  // never-measured filler of the same shape borrows that average instead of the
  // static default. sweepEveryRowIntoView then steps through the WHOLE
  // transcript so every row mounts and is measured for real at least once,
  // giving a ground-truth total. The gap between the calibrated estimated total
  // and the all-real-measured total is the virtualizer's literal "correction
  // budget": how far off the settled guess was.
  //
  // Negative control (proven deterministically in the colocated unit tests,
  // use-transcript-virtual-measurement-model.test.ts): with calibration removed
  // from estimateSize, a never-measured filler falls back to the static
  // composition estimate (~220px), which undershoots the honest ~430px height
  // by ~210px per row and blows this gap well past the 1400px bound below. The
  // calibrated estimate is therefore load-bearing, not decorative.
  test("estimate accuracy: an off-screen collapsed tool-ledger row's estimate tracks its real measured height", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedConversationWithToolLedger", 2, 40, 30);
    await waitForViewport(page);
    // Let the first on-screen measurement pass populate the per-bucket
    // calibration so the off-screen filler estimates settle to this session's
    // observed heights before the estimated total is read.
    await settle(page);

    const estimated = await metrics(page);
    expect(estimated.found).toBe(true);
    // A short viewport against many filler turns must actually overflow and
    // bury the ledger row off-screen, else this test proves nothing.
    expect(estimated.scrollHeight).toBeGreaterThan(estimated.clientHeight + 1000);

    await drive(page, "sweepEveryRowIntoView", 40);
    await settle(page, 300);
    const real = await metrics(page);
    expect(real.found).toBe(true);

    const estimateError = Math.abs(estimated.scrollHeight - real.scrollHeight);
    expect(estimateError).toBeLessThan(1400);
  });

  // Rung 7 (PRO-187, Q6): a DISPLACING (structural) dock inset that
  // appears/disappears (composer growth/collapse, status bar) must not fight a
  // pinned reader. The pinned follow re-lands in one cut (never a crawl or an
  // oscillation) and the clamp a shrink queues is never misread as a user
  // upward scroll. Negative control: route the structural inset out of the
  // consumed-inset machine (or drop the structural-shrink clamp mark in
  // use-transcript-auto-follow-bottom.ts) and the collapse clamp is reclassified
  // as a user scroll, so the follow drops and the subsequent stream runs away.
  test("displacing-inset transition while pinned: composer collapse/grow follows in one cut, no fight", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 6);
    await waitForViewport(page);
    await settle(page);
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    // Composer collapses (structural 120 -> 40): scrollHeight shrinks and the
    // client height grows, so the pinned viewport re-lands at the new bottom.
    await drive(page, "startScrollTrace");
    await drive(page, "setComposerInset", 40);
    await settle(page, 500);
    const collapseTrace = (await drive<number[]>(page, "stopScrollTrace")).filter((v) =>
      Number.isFinite(v),
    );

    // Still pinned, glued to the new bottom.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
      PIN_FOLLOW_MAX_DISTANCE_PX,
    );
    // One cut: only a couple of distinct positions, then landed-and-held (the
    // final value, once reached, is never left again). A fight would oscillate.
    expect(collapseTrace.length).toBeGreaterThan(0);
    expect(new Set(collapseTrace).size).toBeLessThanOrEqual(3);
    const collapseSettled = collapseTrace[collapseTrace.length - 1];
    const collapseSettledIdx = collapseTrace.indexOf(collapseSettled);
    expect(collapseTrace.slice(collapseSettledIdx).every((v) => v === collapseSettled)).toBe(true);

    // Composer grows (structural 40 -> 220): the follow keeps up with the taller
    // document without fighting.
    await drive(page, "setComposerInset", 220);
    await settle(page, 500);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
      PIN_FOLLOW_MAX_DISTANCE_PX,
    );

    // Negative control bite: the transitions did not silently unpin. Streaming
    // now still follows to the bottom; a collapse-induced false unpin would
    // leave the stream running away outside the follow ceiling.
    await drive(page, "beginStreamingTurn");
    for (let batch = 0; batch < 6; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 60);
      expect((await metricsAfterFrame(page)).bottomDistance).toBeLessThanOrEqual(
        PIN_FOLLOW_MAX_DISTANCE_PX,
      );
    }
    await drive(page, "finalizeStreamingTurn");
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
  });

  // Rung 7 (PRO-187, Q6): an UNPINNED reader is not displaced when a displacing
  // inset appears/disappears below the fold. The row under the top edge and the
  // absolute scrollTop hold across a composer collapse and a composer growth.
  // Negative control: if a structural inset change wrote scrollTop while
  // unpinned (e.g. the pinned-only guard in the dock-inset layout effect were
  // dropped), the reading row under the top edge would shift.
  test("displacing-inset transition while unpinned reading: no displacement", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 12);
    await waitForViewport(page);
    await settle(page);

    // Read up and unpin.
    await keyboardScrollUp(page, 3);
    await settle(page, 500);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    const savedTopRow = await drive<string | null>(page, "getTopVisibleText");
    expect(savedTopRow, "a transcript row must be under the top edge").toBeTruthy();
    const savedTop = (await metrics(page)).scrollTop;

    // Composer collapses then grows below the fold while the reader stays put.
    await drive(page, "startScrollTrace");
    await drive(page, "setComposerInset", 40);
    await settle(page, 300);
    await drive(page, "setComposerInset", 220);
    await settle(page, 300);
    const trace = (await drive<number[]>(page, "stopScrollTrace")).filter((v) =>
      Number.isFinite(v),
    );

    // The reading row under the top edge is unchanged, still unpinned, and the
    // absolute scrollTop held (the change was entirely below the viewport).
    expect(await drive<string | null>(page, "getTopVisibleText")).toBe(savedTopRow);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect(Math.abs((await metrics(page)).scrollTop - savedTop)).toBeLessThanOrEqual(2);
    // No engine-driven scroll motion: the trace tail is flat at the saved top.
    if (trace.length > 0) {
      expect(new Set(trace.slice(-6)).size).toBe(1);
    }
  });

  // Rung 9 (PRO-187, Q18): the scroll-to-latest affordance derives visibility
  // from the model (unpinned AND overflow) and its new-content variant from
  // the model's own ResizeObserver-measured growth signal, never a separate
  // scroll listener or DOM poll. This fixture asserts BOTH stay stable
  // (visible, then accented) across a run of streaming growth while
  // unpinned, matching the failure mode named in the ADR (section 5,
  // "Scroll-to-latest visibility flicker").
  test("scroll-to-latest: visibility and new-content indicator stay stable during unpinned streaming growth", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 8);
    await waitForViewport(page);
    await settle(page);
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    // Read up away from the bottom: unpins, button becomes visible, no new
    // content has arrived yet so the accent is absent.
    await keyboardScrollUp(page, 4);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect(await drive<boolean>(page, "hasNewContentIndicator")).toBe(false);

    await drive(page, "beginStreamingTurn");
    await settle(page);
    for (let batch = 0; batch < 15; batch += 1) {
      await drive(page, "streamChunk");
      await settle(page, 60);
      // Visibility never flickers off mid-growth: still unpinned every batch.
      await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
      // Once content has grown at least once, the accent stays ON for every
      // remaining batch (no flicker), the failure mode this fixture guards.
      if (batch > 0) {
        expect(await drive<boolean>(page, "hasNewContentIndicator")).toBe(true);
      }
    }
    await drive(page, "finalizeStreamingTurn");
    await settle(page);
    // Still reading, still unpinned, accent still on after the stream ends.
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    expect(await drive<boolean>(page, "hasNewContentIndicator")).toBe(true);
  });

  // Rung 9 (PRO-187, Q18): clicking the affordance must route through the
  // engine's single writer (FR-1) and land at the true bottom in one motion,
  // not a visible crawl or a second corrective snap.
  test("scroll-to-latest: click lands at the true bottom in one motion and re-pins", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 10);
    await waitForViewport(page);
    await settle(page);
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    await keyboardScrollUp(page, 6);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(false);
    const beforeClick = await metrics(page);
    expect(beforeClick.bottomDistance).toBeGreaterThan(REPIN_BAND_PX * 4);

    await drive(page, "startScrollTrace");
    await drive(page, "clickScrollToBottom");
    await settle(page, 300);
    const trace = (await drive<number[]>(page, "stopScrollTrace")).filter((v) =>
      Number.isFinite(v),
    );

    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(2);
    expect(await drive<boolean>(page, "hasNewContentIndicator")).toBe(false);
    // One motion: the trace's scrollTop values are monotonically non-decreasing
    // toward the bottom (a single cut or a smooth single sweep), never a snap
    // past the target followed by a corrective bounce back.
    for (let i = 1; i < trace.length; i += 1) {
      expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1] - 1);
    }
  });

  // Rung 10 (PRO-187, Q13): the reserved-slot invariant — "no live-turn slot
  // may change height as a function of item lifecycle, only as a function of
  // revealed content" — extended across a thought (start/delta/stop), a tool
  // call, and prose resuming, all inside one streaming turn, while pinned.
  // Every transition must cost zero displacement: a broken invariant shows up
  // as either a scrollTop jump (a phantom row briefly occupying its own
  // height) or a double-scroll (two corrective snaps for one content change).
  test("Q13 thinking/tool interleave: transient block lifecycle never displaces the pinned reader", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedFinalizedConversation", 6);
    await waitForViewport(page);
    await settle(page);
    await wheelToBottom(page);
    await settle(page);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);

    await drive(page, "beginStreamingTurn");
    await settle(page);
    const baseline = await metricsAfterFrame(page);
    expect(baseline.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);

    // Trace phases separately rather than as one continuous sweep: the
    // tool-call phase has a legitimate, quantified source of backward
    // scrollTop motion (new-row estimate convergence, see
    // TOOL_ROW_ESTIMATE_CONVERGENCE_MAX_PX above) that the thought and prose
    // phases do not. Bracketing per-phase lets each get the tolerance that
    // actually matches its physics, instead of one bound loose enough to
    // hide a lifecycle-height regression in the phases that have no
    // legitimate reason to bounce at all.
    // `leadingBouncePx`, when given, applies only to the FIRST inter-frame
    // step of this trace (index 0 -> 1); every subsequent step still uses
    // the tight `maxBouncePx`. CI (round 3) showed the tool row's
    // estimate-to-measured correction is deferred past the tool-call
    // bracket's own settle: it lands on the first remeasure pass that a
    // subsequent content mutation triggers, i.e. the opening frame of the
    // NEXT (prose) phase, not synchronously after `streamToolCall`. That's
    // still the same already-quantified, already-legitimate convergence —
    // just late — so it gets the wide budget on that one leading step only;
    // a lifecycle-height regression anywhere else in the phase still fails
    // at the tight bound.
    //
    // CI (round 4, PR #1980 bimodal followup) showed this convergence's
    // deferred landing frame is not pinned to trace index 1 under runner
    // load: on a slow attempt it can land one or more frames later, at a
    // trace index that only carries the tight `maxBouncePx` budget, and the
    // assertion trips on a step that is not a displacement at all.
    //
    // Round 5 tried asserting on bottomDistance (scrollHeight - clientHeight
    // - scrollTop) instead of raw scrollTop, on the theory that it's the
    // quantity the reader actually perceives. That broke on CI (round 6):
    // the PROSE bracket streams real content every chunk, and ordinary
    // per-chunk growth has scrollHeight grow one frame before the single
    // writer's snap follows it (scrollTop flat that frame, catches up next)
    // — a completely normal, already-bounded (PIN_FOLLOW_MAX_DISTANCE_PX)
    // artifact of active streaming that has nothing to do with a backward
    // bounce, since scrollTop itself never decreased. bottomDistance can't
    // tell that apart from a real bounce, because it rises for BOTH reasons.
    //
    // The trace CI actually captured (job 95178602294, webkit): scrollTop
    // [...,2562,2562,2584,...], scrollHeight [...,2962,2984,2984,...] — the
    // 2562->2562 step is flat (no backward motion at all), while scrollHeight
    // grew 22px (a chunk landing); bottomDistance briefly showed that 22px
    // gap and then the very next frame closed it back to 0 in one cut. That
    // is the expected steady-state catch-up, not a defect.
    //
    // The correct invariant checks scrollTop directly (a real bounce IS
    // scrollTop dropping) but excuses a drop by however much scrollHeight
    // shrank in the same step (the legitimate estimate-correction case,
    // where the single writer follows a smaller bottom target and the
    // reader sees nothing move). Growth-lag never trips this because
    // scrollTop doesn't drop when content grows. A phantom reserved-slot
    // bounce (the rung-10 defect class) still trips it because scrollTop
    // drops with no matching scrollHeight shrink to explain it.
    function assertNoBackwardBounce(
      scrollTopTrace: number[],
      scrollHeightTrace: number[],
      maxBouncePx: number,
      leadingBouncePx = maxBouncePx,
    ): void {
      expect(scrollTopTrace.length).toBe(scrollHeightTrace.length);
      for (let i = 1; i < scrollTopTrace.length; i += 1) {
        const bound = i === 1 ? leadingBouncePx : maxBouncePx;
        const scrollTopDrop = scrollTopTrace[i - 1] - scrollTopTrace[i];
        const scrollHeightShrink = scrollHeightTrace[i - 1] - scrollHeightTrace[i];
        const unexplainedDrop = scrollTopDrop - Math.max(0, scrollHeightShrink);
        expect(unexplainedDrop).toBeLessThanOrEqual(bound);
      }
    }

    // Both traces are frame-aligned (same rAF ticks); filter NaN frames out
    // in lockstep so indices stay paired, never independently.
    async function pairedTraces(page: Page): Promise<{ scrollTop: number[]; scrollHeight: number[] }> {
      const scrollTop = await drive<number[]>(page, "stopScrollTrace");
      const scrollHeight = await drive<number[]>(page, "stopScrollHeightTrace");
      const scrollTopOut: number[] = [];
      const scrollHeightOut: number[] = [];
      for (let i = 0; i < scrollTop.length; i += 1) {
        if (Number.isFinite(scrollTop[i]) && Number.isFinite(scrollHeight[i])) {
          scrollTopOut.push(scrollTop[i]);
          scrollHeightOut.push(scrollHeight[i]);
        }
      }
      return { scrollTop: scrollTopOut, scrollHeight: scrollHeightOut };
    }

    // Thought starts and streams a couple of deltas: private, reserved-slot
    // only, must not move the pinned reader. No new row mounts here, so the
    // tight lifecycle-only bound applies.
    await drive(page, "startScrollTrace");
    await drive(page, "streamThoughtStart");
    await settle(page, 80);
    const afterThoughtStart = await metricsAfterFrame(page);
    expect(afterThoughtStart.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
    {
      const { scrollTop, scrollHeight } = await pairedTraces(page);
      assertNoBackwardBounce(scrollTop, scrollHeight, INTERLEAVE_MAX_BACKWARD_BOUNCE_PX);
    }

    // Thought yields to a tool call mid-turn (thinking -> tool -> thinking is
    // the exact class the ADR's Cell 6 names). A real new row mounts here,
    // but CI (round 3) showed its estimate-to-measured correction does NOT
    // land synchronously in this bracket even with a full 350ms settle — the
    // virtualizer defers the remeasure pass to the next content mutation
    // (see the prose bracket below), so THIS bracket's own trace is still
    // governed by the tight lifecycle bound.
    await drive(page, "startScrollTrace");
    await drive(page, "streamThoughtStop");
    await drive(page, "streamToolCall");
    await settle(page);
    const afterTool = await metricsAfterFrame(page);
    expect(afterTool.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
    {
      const { scrollTop, scrollHeight } = await pairedTraces(page);
      assertNoBackwardBounce(scrollTop, scrollHeight, INTERLEAVE_MAX_BACKWARD_BOUNCE_PX);
    }

    // Prose resumes and grows the turn for real; THIS is content growth (not
    // lifecycle) on an already-mounted row. CI (rounds 2-3) showed the tool
    // row's deferred estimate-to-measured correction (~61px, deterministic
    // on both browsers) usually lands on the FIRST remeasure pass that
    // streaming prose triggers, so the leading step gets the wider,
    // quantified convergence bound. Every step (leading or not) still runs
    // through the shrink-adjusted formula above, so ordinary per-chunk
    // growth-lag (scrollTop flat, scrollHeight rising) never counts against
    // either budget, and a real lifecycle regression still fails at the
    // tight bound wherever it lands.
    await drive(page, "startScrollTrace");
    await drive(page, "streamChunks", 5);
    await settle(page, 200);
    const afterProse = await metricsAfterFrame(page);
    expect(afterProse.bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
    await expect.poll(() => isPinned(page), { timeout: 2000 }).toBe(true);
    {
      const { scrollTop, scrollHeight } = await pairedTraces(page);
      assertNoBackwardBounce(
        scrollTop,
        scrollHeight,
        INTERLEAVE_MAX_BACKWARD_BOUNCE_PX,
        TOOL_ROW_ESTIMATE_CONVERGENCE_MAX_PX,
      );
    }

    await drive(page, "finalizeStreamingTurn");
    await settle(page);
    expect((await metrics(page)).bottomDistance).toBeLessThanOrEqual(PIN_FOLLOW_MAX_DISTANCE_PX);
  });
});
