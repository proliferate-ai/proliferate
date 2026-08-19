import { describe, expect, it } from "vitest";
import {
  TranscriptFramePipeline,
  type TranscriptFramePassOutcome,
} from "#product/hooks/chat/ui/transcript-frame-pipeline";

class FakeFrames {
  cancelled: number[] = [];
  maxPending = 0;
  private nextHandle = 0;
  private queue: Array<{ handle: number; callback: () => void }> = [];

  raf = (callback: () => void): number => {
    const handle = (this.nextHandle += 1);
    this.queue.push({ handle, callback });
    this.maxPending = Math.max(this.maxPending, this.queue.length);
    return handle;
  };

  caf = (handle: number): void => {
    this.cancelled.push(handle);
    this.queue = this.queue.filter((entry) => entry.handle !== handle);
  };

  flushFrame(): void {
    const batch = this.queue;
    this.queue = [];
    for (const entry of batch) {
      entry.callback();
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}

describe("TranscriptFramePipeline seat acknowledgment", () => {
  it("keeps quiet glue alive through corrections until a later settled pass", () => {
    const frames = new FakeFrames();
    const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
    const outcomes: TranscriptFramePassOutcome[] = [
      "corrective_position_write",
      "corrective_position_write",
      "settled",
    ];
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => outcomes[passes++] ?? "settled",
      measureContentHeight: () => 6_908,
      shouldContinueGlue: () => true,
    });

    pipeline.beginGlue();
    while (pipeline.isGluing) {
      const passesBeforeFrame = passes;
      expect(frames.pending).toBe(1);
      frames.flushFrame();
      expect(passes - passesBeforeFrame).toBe(1);
    }

    expect(passes).toBe(3);
    expect(frames.maxPending).toBe(1);
    expect(frames.cancelled).toEqual([]);
    expect(frames.pending).toBe(0);
  });

  it("coalesces multiple corrective outcomes onto one synchronous-pass verifier", () => {
    const frames = new FakeFrames();
    const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
    let height = 1;
    let outcome: TranscriptFramePassOutcome = "corrective_position_write";
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
        return outcome;
      },
      measureContentHeight: () => height,
      shouldContinueGlue: () => true,
    });

    pipeline.requestFrame();
    for (height = 2; height <= 3; height += 1) {
      pipeline.requestFrame();
      expect(frames.pending).toBe(2); // one guard reset plus one verifier
    }
    expect(passes).toBe(3);

    outcome = "settled";
    frames.flushFrame();
    expect(passes).toBe(4);
    expect(frames.maxPending).toBe(2);
    expect(frames.pending).toBe(0);
  });

  it("does not acknowledge a correction with a same-frame settled reentrant pass", () => {
    const frames = new FakeFrames();
    const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
    let height = 1;
    let outcome: TranscriptFramePassOutcome = "corrective_position_write";
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
        return outcome;
      },
      measureContentHeight: () => height,
      shouldContinueGlue: () => true,
    });

    pipeline.requestFrame();
    height = 2;
    outcome = "settled";
    pipeline.requestFrame();
    expect(passes).toBe(2);
    expect(frames.pending).toBe(2);

    frames.flushFrame();
    expect(passes).toBe(3); // a distinct-frame verifier still ran
    expect(frames.pending).toBe(0);
  });

  it("does not acknowledge a continuation correction from a same-refresh resize pass", () => {
    const frames = new FakeFrames();
    const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
    const outcomes: TranscriptFramePassOutcome[] = [
      "corrective_position_write",
      "corrective_position_write",
      "settled",
      "corrective_position_write",
      "settled",
    ];
    let height = 1;
    let passes = 0;
    pipeline.setWriter({
      runFramePass: () => outcomes[passes++] ?? "settled",
      measureContentHeight: () => height,
      shouldContinueGlue: () => true,
    });

    pipeline.requestFrame();
    // This callback represents ResizeObserver delivery later in the same
    // refresh as the first shared-continuation callback.
    frames.raf(() => {
      height += 1;
      pipeline.requestFrame();
    });
    frames.flushFrame();
    expect(passes).toBe(3); // correction, correction, same-refresh settled RO

    // The compositor silently loses the continuation's correction after that
    // settled RO pass. A later writer frame must still run and correct again.
    frames.flushFrame();
    expect(passes).toBe(4);
    frames.flushFrame();
    expect(passes).toBe(5); // later-frame settled acknowledgment
    expect(frames.pending).toBe(0);
  });

  it("beginGlue, cancel, and writer replacement clear stale acknowledgment", () => {
    const makeCorrectivePipeline = () => {
      const frames = new FakeFrames();
      const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
      let passes = 0;
      let allowed = true;
      pipeline.setWriter({
        runFramePass: () => {
          passes += 1;
          return "corrective_position_write";
        },
        measureContentHeight: () => 1,
        shouldContinueGlue: () => allowed,
      });
      return {
        frames,
        pipeline,
        get passes() { return passes; },
        disallowGlue() { allowed = false; },
      };
    };

    const restarted = makeCorrectivePipeline();
    restarted.pipeline.requestFrame();
    restarted.pipeline.beginGlue();
    restarted.disallowGlue();
    restarted.frames.flushFrame();
    expect(restarted.passes).toBe(1);
    expect(restarted.frames.pending).toBe(0);

    const cancelled = makeCorrectivePipeline();
    cancelled.pipeline.requestFrame();
    cancelled.pipeline.cancel();
    cancelled.disallowGlue();
    cancelled.pipeline.beginGlue();
    cancelled.frames.flushFrame();
    expect(cancelled.passes).toBe(1);
    expect(cancelled.frames.pending).toBe(0);

    const replaced = makeCorrectivePipeline();
    replaced.pipeline.requestFrame();
    let replacementPasses = 0;
    replaced.pipeline.setWriter({
      runFramePass: () => {
        replacementPasses += 1;
        return "settled";
      },
      measureContentHeight: () => 1,
      shouldContinueGlue: () => false,
    });
    replaced.frames.flushFrame();
    expect(replacementPasses).toBe(0);
    expect(replaced.frames.pending).toBe(0);
  });
});
