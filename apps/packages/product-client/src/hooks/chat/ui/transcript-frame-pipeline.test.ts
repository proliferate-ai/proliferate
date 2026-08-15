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
  it("runs the snap pass AFTER the mutation commits (ordering)", () => {
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

    // Mutation source: the height grows, THEN the source requests a frame.
    committedHeight = 420;
    events.push("mutate");
    pipeline.requestFrame();

    // Nothing has run yet: the snap is scheduled, not synchronous.
    expect(snappedToHeight).toBe(-1);

    frames.flushFrame();

    // The one snap ran after the mutation and read the committed height.
    expect(events).toEqual(["mutate", "snap"]);
    expect(snappedToHeight).toBe(420);
  });

  it("coalesces N mutation sources into exactly ONE snap per frame", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => 0,
      shouldContinueGlue: () => true,
    });

    // Five independent mutation sources all request a frame in one tick.
    for (let i = 0; i < 5; i += 1) {
      pipeline.requestFrame();
    }
    expect(frames.pending).toBe(1);

    frames.flushFrame();
    expect(passes).toBe(1);

    // A fresh request after the frame drained schedules exactly one more pass.
    pipeline.requestFrame();
    pipeline.requestFrame();
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

  it("cancel() kills a pending single-shot frame AND a glue window", () => {
    const { frames, pipeline } = makePipeline();
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
      },
      measureContentHeight: () => passes,
      shouldContinueGlue: () => true,
    });

    pipeline.requestFrame();
    pipeline.cancel();
    frames.flushFrame();
    expect(passes).toBe(0);

    pipeline.beginGlue();
    pipeline.cancel();
    frames.flushFrame();
    expect(pipeline.isGluing).toBe(false);
    expect(passes).toBe(0);
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
});
