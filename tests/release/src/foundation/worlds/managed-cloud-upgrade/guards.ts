/**
 * Deadline and duplicate/once guards for the managed-cloud upgrade world.
 *
 * A live upgrade scenario polls remote state (heartbeat versions, Supervisor
 * status, runtime health) under a wall-clock budget, and must never repeat an
 * external effect after a lost response. These guards make both explicit.
 *
 * Ported concept from the combined foundation worktree (deadline/duplicate
 * guards); reimplemented small and self-contained here.
 */

export class DeadlineExceededError extends Error {
  readonly what: string;
  readonly elapsedMs: number;
  constructor(what: string, elapsedMs: number) {
    super(`deadline exceeded after ${elapsedMs}ms waiting for: ${what}`);
    this.name = "DeadlineExceededError";
    this.what = what;
    this.elapsedMs = elapsedMs;
  }
}

export interface PollOptions {
  readonly what: string;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  /** Injectable for tests; defaults to real time + setTimeout. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll `probe` until it returns a non-null value or the deadline passes.
 * Throws `DeadlineExceededError` on timeout — a timeout is a real failure, never
 * silently downgraded to a pass. The probe runs at least once even if the
 * timeout is zero.
 */
export async function pollUntil<T>(
  probe: () => Promise<T | null>,
  options: PollOptions,
): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  const deadline = start + options.timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) return result;
    if (now() >= deadline) {
      throw new DeadlineExceededError(options.what, now() - start);
    }
    await sleep(options.intervalMs);
  }
}

/**
 * A single-fire guard around an effect that must happen at most once even if
 * its caller is retried after a lost response. The first call runs `effect` and
 * caches its result; later calls with the same key return the cached result
 * without re-running. Used to prove "exactly one durable request / activation"
 * semantics in the scenario harness rather than in the product.
 */
export class OnceGuard<T> {
  private readonly results = new Map<string, Promise<T>>();

  run(key: string, effect: () => Promise<T>): Promise<T> {
    const existing = this.results.get(key);
    if (existing !== undefined) return existing;
    const started = effect();
    this.results.set(key, started);
    return started;
  }

  /** How many distinct effects fired — the test asserts "exactly one". */
  get firedCount(): number {
    return this.results.size;
  }

  hasFired(key: string): boolean {
    return this.results.has(key);
  }
}
