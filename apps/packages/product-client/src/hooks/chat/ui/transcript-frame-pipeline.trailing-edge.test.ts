import { describe, expect, it } from "vitest";
import { TranscriptFramePipeline } from "#product/hooks/chat/ui/transcript-frame-pipeline";

class FakeFrames {
  cancelled: number[] = [];
  private nextHandle = 0;
  private queue: Array<{ handle: number; callback: () => void }> = [];

  raf = (callback: () => void): number => {
    const handle = (this.nextHandle += 1);
    this.queue.push({ handle, callback });
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

  get pendingHandles(): number[] {
    return this.queue.map(({ handle }) => handle);
  }
}

describe("TranscriptFramePipeline trailing-edge ensure", () => {
  it("runs one trailing pass when erosion is delivered during the quiet-ending pass", () => {
    const frames = new FakeFrames();
    const pipeline = new TranscriptFramePipeline(frames.raf, frames.caf, () => 0);
    const settledSeat = 1_831;
    let scrollTop = 0;
    let passes = 0;

    pipeline.setWriter({
      runFramePass: () => {
        passes += 1;
        scrollTop = settledSeat;
        if (passes <= 2) {
          // Model WebKit eroding the just-written seat and delivering the native
          // position event reentrantly while this glue pass is still active.
          scrollTop = 0;
          pipeline.ensureGlue();
          if (passes === 2) {
            pipeline.ensureGlue();
            pipeline.ensureGlue();
          }
        }
      },
      measureContentHeight: () => 6_908,
      shouldContinueGlue: () => true,
    });

    pipeline.beginGlue();
    const [leadingHandle] = frames.pendingHandles;

    frames.flushFrame();
    expect(scrollTop).toBe(0);
    expect(passes).toBe(1);
    expect(frames.cancelled).not.toContain(leadingHandle);

    frames.flushFrame();
    expect(scrollTop).toBe(0);
    expect(passes).toBe(2);
    expect(frames.cancelled).toEqual([]);

    // Erosion has stopped. The request delivered during the quiet-ending pass
    // is still owed one coalesced writer pass, which must persist the full seat.
    frames.flushFrame();
    expect(scrollTop).toBe(settledSeat);
    expect(passes).toBe(3);
    expect(frames.pending).toBe(0);
  });
});
