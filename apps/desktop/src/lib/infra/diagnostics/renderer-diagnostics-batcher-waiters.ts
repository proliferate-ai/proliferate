// The two timer-backed waits in the renderer batcher: a per-record
// acknowledgement that must settle exactly once, and the flush gate that
// resolves when the queue drains or its deadline elapses.

import { RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS } from "./renderer-diagnostics-batcher-limits";

export interface BatcherTimers {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface Acknowledgement {
  settled: boolean;
  expired: boolean;
  resolve(value: boolean): void;
  timeout: ReturnType<typeof setTimeout>;
}

export function createAcknowledgement(
  timers: BatcherTimers,
  deadlineMs: number,
  resolve: (value: boolean) => void,
  onExpire: () => void,
): Acknowledgement {
  let acknowledgement: Acknowledgement;
  const timeout = timers.setTimeout(() => {
    if (acknowledgement.settled) {
      return;
    }
    acknowledgement.settled = true;
    acknowledgement.expired = true;
    resolve(false);
    onExpire();
  }, Math.max(0, Math.min(deadlineMs, RENDERER_ACKNOWLEDGEMENT_DEADLINE_MS)));
  acknowledgement = {
    settled: false,
    expired: false,
    resolve,
    timeout,
  };
  return acknowledgement;
}

export function settleAcknowledgement(
  timers: BatcherTimers,
  acknowledgement: Acknowledgement | undefined,
  value: boolean,
): void {
  if (acknowledgement === undefined || acknowledgement.settled) {
    return;
  }
  acknowledgement.settled = true;
  timers.clearTimeout(acknowledgement.timeout);
  acknowledgement.resolve(value);
}

interface IdleWaiter {
  resolve(): void;
  promise: Promise<void>;
  timeout: ReturnType<typeof setTimeout>;
  deadlineAt: number;
}

export class IdleGate {
  private waiter: IdleWaiter | null = null;

  constructor(private readonly timers: BatcherTimers) {}

  pendingCount(): number {
    return this.waiter === null ? 0 : 1;
  }

  // Concurrent flushes share one waiter; an earlier deadline shortens it rather
  // than queueing a second timer.
  wait(deadlineMs: number): Promise<void> {
    const boundedDeadline = Math.max(0, deadlineMs);
    const deadlineAt = this.timers.now() + boundedDeadline;
    const existing = this.waiter;
    if (existing !== null) {
      if (deadlineAt < existing.deadlineAt) {
        this.timers.clearTimeout(existing.timeout);
        existing.deadlineAt = deadlineAt;
        existing.timeout = this.timers.setTimeout(
          () => this.resolveWaiter(existing),
          boundedDeadline,
        );
      }
      return existing.promise;
    }
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const waiter: IdleWaiter = {
      resolve: resolvePromise,
      promise,
      deadlineAt,
      timeout: this.timers.setTimeout(() => this.resolveWaiter(waiter), boundedDeadline),
    };
    this.waiter = waiter;
    return promise;
  }

  resolveNow(): void {
    this.resolveWaiter(this.waiter);
  }

  private resolveWaiter(waiter: IdleWaiter | null): void {
    if (waiter === null || this.waiter !== waiter) {
      return;
    }
    this.waiter = null;
    this.timers.clearTimeout(waiter.timeout);
    waiter.resolve();
  }
}
