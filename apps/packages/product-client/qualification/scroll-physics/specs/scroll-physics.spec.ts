import { expect, test, type Page } from "@playwright/test";

// Scroll-physics tier (specs/TESTING.md). The real transcript renderer, driven
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

  // EXPECTED TO FAIL today (PRO-175), for a DIFFERENT reason than the stamp
  // leak this rung fixes. `resetForSession` still unconditionally
  // pins/snaps/glues on every session switch by design (rung 2 leaves this
  // alone), and the virtualizer's own remeasurement of freshly-mounted rows
  // still produces a handful of settle frames after the snap — plus, in this
  // fixture, a session switch resets `VirtualTranscriptRowList`'s
  // `fallbackReason` to null, which can flip the tree from
  // FullTranscriptRowList back to VirtualizedTranscriptRowList (a real
  // component remount) if a blank-viewport fallback had fired for the
  // intervening session. Either path produces multiple distinct scrollTop
  // frames regardless of the stamp fix below. Verified: with
  // `setPendingPromptStamp` reproducing the stamp-leak precondition
  // (session-primary carries a stamp across an intervening session with
  // none), the pre-fix code and the sessionKey-scoped fix in
  // use-transcript-stick-to-bottom.ts produce IDENTICAL scrollTop traces
  // (~5 distinct frames each) — the stamp leak was not this test's failure
  // mode. Zero-motion placement on revisit is restore-finalized placement,
  // named in the frozen ladder as rung 6 (bottom-on-entry replacement);
  // unfixme there.
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

  // Rung 5 (PRO-187): composition-derived virtualizer estimates +
  // per-row-key measured-height persistence. A collapsed tool-ledger row (30
  // small tool calls folded into ONE `collapsed_actions` display block, see
  // appendCollapsedToolLedgerTurn) renders as a compact disclosure — its REAL
  // height is nowhere near the old flat 360px-per-row guess used for every
  // other non-special-cased row.
  //
  // seedConversationWithToolLedger seeds the ledger turn INTO THE FIRST
  // commit, buried under enough finalized filler turns that it starts
  // virtualized OFF-SCREEN (well outside the pinned-bottom viewport +
  // overscan window). At that moment the virtualizer's TOTAL content size —
  // the scrollbar geometry the reader sees before ever touching that row —
  // is built entirely from ESTIMATES, not real measurements.
  // sweepEveryRowIntoView then steps through the WHOLE transcript so every
  // row mounts and is measured for real at least once, giving a ground-truth
  // total. The gap between the all-estimated initial total and the
  // all-real-measured total is the virtualizer's literal "correction
  // budget": how far off the guess was, and therefore how large a correction
  // the frame pipeline has to absorb as those rows come into view.
  //
  // Negative control (see PR body for the literal run): temporarily forcing
  // `estimateTurnRowHeight` in transcript-row-height-estimate.ts back to the
  // OLD flat 360px-per-row guess makes this same gap ~2.5-3x larger and
  // fails the bound below.
  test("estimate accuracy: an off-screen collapsed tool-ledger row's estimate tracks its real measured height", async ({
    page,
  }) => {
    await ready(page);
    await drive(page, "reset");
    await drive(page, "seedConversationWithToolLedger", 2, 40, 30);
    await waitForViewport(page);

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
});
