import { describe, expect, it } from "vitest";
import {
  TranscriptFramePipeline,
  TRANSCRIPT_GLUE_MAX_MS,
  type TranscriptFrameWriter,
} from "#product/hooks/chat/ui/transcript-frame-pipeline";

/**
 * Deterministic frame/clock harness. rAF callbacks are queued, not fired, until
 * a test explicitly flushes a frame; `now` advances only when a frame is
 * flushed. This lets the ordering / one-pass-per-frame / settle-cap invariants
 * be asserted without any real animation-frame timing.
 */
class FakeFrames {
  time = 0;
  private seq = 0;
  private queue: Array<{ handle: number; cb: () => void }> = [];

  raf = (cb: () => void): number => {
    const handle = (this.seq += 1);
    this.queue.push({ handle, cb });
    return handle;
  };

  caf = (handle: number): void => {
    this.queue = this.queue.filter((entry) => entry.handle !== handle);
  };

  now = (): number => this.time;

  get pending(): number {
    return this.queue.length;
  }

  /** Fire every frame queued as of now (a snapshot), advancing the clock once. */
  flushFrame(dtMs = 16): void {
    this.time += dtMs;
    const batch = this.queue;
    this.queue = [];
    for (const entry of batch) {
      entry.cb();
    }
  }
}

function makePipeline() {
  const frames = new FakeFrames();
  const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, frames.now);
  return { frames, pipeline };
}

describe("TranscriptFramePipeline", () => {
  it("runs the snap pass SYNCHRONOUSLY in the same frame the mutation committed", () => {
    const { frames, pipeline } = makePipeline();
    // The DOM height the browser has committed for this frame.
    let committedHeight = 100;
    let snappedToHeight = -1;
    const events: string[] = [];

    const writer: TranscriptFrameWriter = {
      runFramePass: () => {
        events.push("snap");
        snappedToHeight = committedHeight;
      },
      measureContentHeight: () => committedHeight,
      shouldContinueGlue: () => true,
    };
    pipeline.setWriter(writer);

    // Mutation source: the height grows, THEN the source requests a frame. The
    // content ResizeObserver fires post-layout / pre-paint, so the snap must run
    // synchronously in THIS frame — NOT deferred to the next rAF. Re-deferring
    // (scheduling runFramePass inside the guard rAF) is the pinned-follow drift
    // regression: it leaves the viewport a frame behind a growing stream and
    // fails this assertion (and the Playwright pinned-follow gate).
    committedHeight = 420;
    events.push("mutate");
    pipeline.requestFrame();

    // The snap already ran, in-line, against the committed height.
    expect(events).toEqual(["mutate", "snap"]);
    expect(snappedToHeight).toBe(420);

    // Only the per-frame guard-reset frame is scheduled; it runs no snap.
    expect(frames.pending).toBe(1);
    frames.flushFrame();
    expect(events).toEqual(["mutate", "snap"]);
  });

  it("coalesces N mutation sources into exactly ONE synchronous snap per frame", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => 0,
      shouldContinueGlue: () => true,
    });

    // Five independent mutation sources all request a frame in one tick: the
    // first snaps synchronously, the rest fold into it.
    for (let i = 0; i < 5; i += 1) {
      pipeline.requestFrame();
    }
    expect(passes).toBe(1);
    // Only the single guard-reset frame is pending, not five competing frames.
    expect(frames.pending).toBe(1);

    frames.flushFrame();
    // The guard reset runs no snap.
    expect(passes).toBe(1);

    // After the frame drained (guard cleared), a fresh request snaps once more.
    pipeline.requestFrame();
    expect(passes).toBe(2);
    pipeline.requestFrame();
    expect(passes).toBe(2); // folds into the same frame
    frames.flushFrame();
    expect(passes).toBe(2);
  });

  it("glue terminates when the content ResizeObserver goes quiet", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    // Height grows for two frames, then holds (RO quiet).
    const heights = [100, 200, 300, 300, 300];
    let frameIndex = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => heights[Math.min(frameIndex, heights.length - 1)],
      shouldContinueGlue: () => true,
    });

    pipeline.beginGlue();
    // Drive frames until the window closes or a generous ceiling.
    for (let i = 0; i < 20 && pipeline.isGluing; i += 1) {
      frameIndex = i + 1;
      frames.flushFrame();
    }

    expect(pipeline.isGluing).toBe(false);
    // Snapped on the growth frames plus the first quiet frame — a tight window,
    // nowhere near the 20-frame ceiling. Never runs unbounded.
    expect(passes).toBeGreaterThan(0);
    expect(passes).toBeLessThanOrEqual(5);
    // Terminated on quiet, well before the time cap.
    expect(frames.time).toBeLessThan(TRANSCRIPT_GLUE_MAX_MS);
  });

  it("glue terminates at the hard cap when the source never goes quiet", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    let height = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      // Never stable: height changes every frame, so quiet never fires.
      measureContentHeight: () => (height += 1),
      shouldContinueGlue: () => true,
    });

    pipeline.beginGlue();
    for (let i = 0; i < 100 && pipeline.isGluing; i += 1) {
      frames.flushFrame(16);
    }

    expect(pipeline.isGluing).toBe(false);
    // Bounded by the ~250ms hard cap, not the 100-frame ceiling.
    expect(frames.time).toBeGreaterThanOrEqual(TRANSCRIPT_GLUE_MAX_MS);
    expect(passes).toBeLessThanOrEqual(Math.ceil(TRANSCRIPT_GLUE_MAX_MS / 16) + 1);
  });

  it("glue stops the moment shouldContinueGlue goes false (user reclaims control)", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    let allowed = true;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => passes, // always changing → never quiet
      shouldContinueGlue: () => allowed,
    });

    pipeline.beginGlue();
    frames.flushFrame();
    expect(passes).toBe(1);

    allowed = false; // an intent listener unpinned with no anchor
    frames.flushFrame();
    expect(pipeline.isGluing).toBe(false);
    expect(passes).toBe(1); // no further snap once disallowed
  });

  it("cancel() clears the per-frame guard AND kills a glue window", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => passes,
      shouldContinueGlue: () => true,
    });

    // The single-shot snap is synchronous, so by the time a user-scroll pause
    // fires there is nothing queued from it to kill — but cancel must drop the
    // guard-reset frame and re-open the pipeline for the next notify.
    pipeline.requestFrame();
    expect(passes).toBe(1);
    pipeline.cancel();
    frames.flushFrame();
    expect(passes).toBe(1); // nothing was queued to run
    pipeline.requestFrame(); // guard cleared → snaps again
    expect(passes).toBe(2);

    pipeline.beginGlue();
    pipeline.cancel();
    frames.flushFrame();
    expect(pipeline.isGluing).toBe(false);
    expect(passes).toBe(2); // glue killed before it could snap
  });

  it("requestFrame is a no-op while a glue window is active (single writer)", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => 500, // immediately quiet after first frame
      shouldContinueGlue: () => true,
    });

    pipeline.beginGlue();
    // A content-resize request arriving mid-glue must not schedule a second,
    // competing frame: exactly one frame is pending (the glue tick).
    pipeline.requestFrame();
    expect(frames.pending).toBe(1);
  });

  // PRO-168 (rung 12, Q16): the eased-follow motion writer's continuation seam.
  // The instant writer never implements `hasPendingMotion`, so these prove the
  // seam is additive: absent it, existing behavior above is untouched (asserted
  // by every prior test in this file, none of which define it).
  describe("hasPendingMotion continuation (PRO-168, rung 12)", () => {
    it("requestFrame schedules ONE more frame per pass while motion is pending, then stops", () => {
      const { frames, pipeline } = makePipeline();
      let passes = 0;
      let pending = true;
      pipeline.setWriter({
        runFramePass: () => {
          passes += 1;
        },
        measureContentHeight: () => 0,
        shouldContinueGlue: () => true,
        hasPendingMotion: () => pending,
      });

      pipeline.requestFrame();
      expect(passes).toBe(1);
      // The guard-reset frame plus the motion continuation are both pending.
      expect(frames.pending).toBe(2);

      frames.flushFrame();
      // The motion continuation ran another pass and re-armed itself.
      expect(passes).toBe(2);

      pending = false;
      frames.flushFrame();
      // Converged: no further continuation is scheduled.
      expect(passes).toBe(2);
      expect(frames.pending).toBe(0);
    });

    it("a writer that never reports pending motion never gets a continuation frame", () => {
      const { frames, pipeline } = makePipeline();
      let passes = 0;
      pipeline.setWriter({
        runFramePass: () => {
          passes += 1;
        },
        measureContentHeight: () => 0,
        shouldContinueGlue: () => true,
        // hasPendingMotion omitted entirely — the default (instant) writer shape.
      });

      pipeline.requestFrame();
      expect(passes).toBe(1);
      // Only the guard-reset frame, no motion continuation.
      expect(frames.pending).toBe(1);
    });

    it("glue ending mid-motion hands off to the motion continuation instead of stranding it", () => {
      const { frames, pipeline } = makePipeline();
      let passes = 0;
      let pending = true;
      // Height goes quiet immediately so glue's own window closes after the
      // first quiet frame, well before motion has converged.
      pipeline.setWriter({
        runFramePass: () => {
          passes += 1;
        },
        measureContentHeight: () => 500,
        shouldContinueGlue: () => true,
        hasPendingMotion: () => pending,
      });

      pipeline.beginGlue();
      frames.flushFrame(); // first pass, height 500 becomes the baseline
      frames.flushFrame(); // quiet frame: glue window closes here
      expect(pipeline.isGluing).toBe(false);
      const passesAtGlueEnd = passes;

      // Glue is done, but motion is still pending: the continuation must have
      // taken over rather than leaving the writer stuck short of its target.
      expect(frames.pending).toBe(1);
      frames.flushFrame();
      expect(passes).toBe(passesAtGlueEnd + 1);

      pending = false;
      frames.flushFrame();
      expect(passes).toBe(passesAtGlueEnd + 1); // converged, no further ticks
    });

    it("beginGlue folds a pending motion continuation into the glue window (no double pass)", () => {
      const { frames, pipeline } = makePipeline();
      let passes = 0;
      pipeline.setWriter({
        runFramePass: () => {
          passes += 1;
        },
        measureContentHeight: () => 0,
        shouldContinueGlue: () => true,
        hasPendingMotion: () => true,
      });

      pipeline.requestFrame();
      expect(passes).toBe(1);
      expect(frames.pending).toBe(2); // guard-reset + motion continuation

      // A fresh glue window starts (e.g. session re-entry) before the motion
      // continuation's frame fires; it must fold in rather than stacking a
      // second pass in the same frame.
      pipeline.beginGlue();
      frames.flushFrame();
      expect(passes).toBe(2); // exactly one more pass this frame, not two
    });
  });
});
