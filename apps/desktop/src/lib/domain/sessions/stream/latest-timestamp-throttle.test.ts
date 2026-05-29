import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createLatestTimestampThrottle,
} from "@/lib/domain/sessions/stream/latest-timestamp-throttle";

describe("createLatestTimestampThrottle", () => {
  it("writes immediately, then coalesces later writes to the latest timestamp", () => {
    let now = 0;
    const scheduledCallbacks: Array<() => void> = [];
    let scheduledDelayMs: number | null = null;
    const write = vi.fn();
    const throttle = createLatestTimestampThrottle({
      intervalMs: 1_000,
      write,
      now: () => now,
      schedule: (callback, delayMs) => {
        scheduledCallbacks.push(callback);
        scheduledDelayMs = delayMs;
        return {} as ReturnType<typeof setTimeout>;
      },
      cancel: vi.fn(),
    });

    throttle.record("workspace-1", "2026-04-04T00:00:01.000Z");

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenLastCalledWith(
      "workspace-1",
      "2026-04-04T00:00:01.000Z",
    );

    now = 100;
    throttle.record("workspace-1", "2026-04-04T00:00:02.000Z");
    throttle.record("workspace-1", "2026-04-04T00:00:03.000Z");

    expect(write).toHaveBeenCalledTimes(1);
    expect(scheduledDelayMs).toBe(900);

    now = 1_000;
    const scheduledCallback = scheduledCallbacks[0];
    expect(scheduledCallback).toBeDefined();
    scheduledCallback?.();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(
      "workspace-1",
      "2026-04-04T00:00:03.000Z",
    );
  });
});
