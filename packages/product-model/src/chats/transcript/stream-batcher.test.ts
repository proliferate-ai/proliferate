import { describe, expect, it, vi } from "vitest";
import { createFrameStreamBatchScheduler } from "./stream-batcher";

describe("createFrameStreamBatchScheduler", () => {
  it("flushes on an animation frame and cancels the max-delay timer", () => {
    const callback = vi.fn();
    const timeoutId = { id: "timeout" };
    let frameCallback: (() => void) | null = null;
    const scheduler = createFrameStreamBatchScheduler({
      requestAnimationFrame: vi.fn((nextCallback) => {
        frameCallback = nextCallback;
        return 42;
      }),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn(() => timeoutId),
      clearTimeout: vi.fn(),
      maxPaintWaitMs: 50,
    });

    scheduler.schedule(callback);
    frameCallback?.();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("flushes on the max-delay timer when frames do not run", () => {
    const callback = vi.fn();
    let timerCallback: (() => void) | null = null;
    const cancelAnimationFrame = vi.fn();
    const scheduler = createFrameStreamBatchScheduler({
      requestAnimationFrame: vi.fn(() => 42),
      cancelAnimationFrame,
      setTimeout: vi.fn((nextCallback) => {
        timerCallback = nextCallback;
        return "timer";
      }),
      clearTimeout: vi.fn(),
      maxPaintWaitMs: 50,
    });

    scheduler.schedule(callback);
    timerCallback?.();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it("uses a zero-delay timer when animation frames are unavailable", () => {
    const callback = vi.fn();
    let timerCallback: (() => void) | null = null;
    const setTimeout = vi.fn((nextCallback) => {
      timerCallback = nextCallback;
      return "timer";
    });
    const scheduler = createFrameStreamBatchScheduler({
      setTimeout,
      clearTimeout: vi.fn(),
      maxPaintWaitMs: 50,
    });

    scheduler.schedule(callback);
    timerCallback?.();

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancels the frame and max-delay timer", () => {
    const callback = vi.fn();
    const cancelAnimationFrame = vi.fn();
    const clearTimeout = vi.fn();
    const scheduler = createFrameStreamBatchScheduler({
      requestAnimationFrame: vi.fn(() => 42),
      cancelAnimationFrame,
      setTimeout: vi.fn(() => "timer"),
      clearTimeout,
      maxPaintWaitMs: 50,
    });

    const cancel = scheduler.schedule(callback);
    cancel();

    expect(callback).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(clearTimeout).toHaveBeenCalledWith("timer");
  });
});
