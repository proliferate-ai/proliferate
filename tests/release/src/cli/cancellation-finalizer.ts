import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RunIdentityV1 } from "../runner/identity.js";

type SupportedSignal = "SIGINT" | "SIGTERM";

interface RegisteredFinalizer {
  id: string;
  world: "local" | "managed-cloud" | "self-host";
  run: RunIdentityV1;
  receiptPath: string;
  runOnce: () => Promise<unknown>;
}

export interface CancellationFinalizerHandle<T> {
  run(): Promise<T>;
  unregister(): void;
}

const registered = new Map<string, RegisteredFinalizer>();
let handlingSignal = false;

/**
 * Registers the existing world cleanup stack with the process cancellation
 * bridge. Normal scenario `finally` blocks and SIGINT/SIGTERM use the same
 * memoized cleanup promise, so cleanup cannot run twice. The receipt is a
 * bounded identity/status record; detailed zero-survivor truth remains in the
 * world's existing cleanup evidence and durable ledger.
 */
export function registerCancellationFinalizer<T>(options: {
  world: RegisteredFinalizer["world"];
  run: RunIdentityV1;
  runDir: string;
  finalize: () => Promise<T>;
}): CancellationFinalizerHandle<T> {
  const id = `${options.world}:${options.run.run_id}:${options.run.shard_id}:${options.run.attempt}`;
  if (registered.has(id)) {
    throw new Error(`Cancellation finalizer is already registered for ${id}.`);
  }
  let inFlight: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    inFlight ??= options.finalize();
    return inFlight;
  };
  const receiptPath = path.join(
    path.dirname(options.runDir),
    `${path.basename(options.runDir)}-cancellation-finalization.json`,
  );
  registered.set(id, { id, world: options.world, run: options.run, receiptPath, runOnce });
  return {
    run: async () => {
      try {
        return await runOnce();
      } finally {
        registered.delete(id);
      }
    },
    unregister: () => registered.delete(id),
  };
}

export async function finalizeRegisteredForSignal(signal: SupportedSignal): Promise<void> {
  const entries = [...registered.values()].reverse();
  for (const entry of entries) {
    let status: "reconciled" | "failed" = "reconciled";
    let reason: string | null = null;
    try {
      const result = await entry.runOnce();
      if (cleanupResultFailed(result)) {
        status = "failed";
        reason = "The registered cleanup finalizer reported failures; inspect the identity-bound cleanup ledger.";
      }
    } catch {
      status = "failed";
      reason = "The registered cleanup finalizer failed; inspect the identity-bound cleanup ledger.";
    } finally {
      registered.delete(entry.id);
    }
    await writeCancellationReceipt(entry, signal, status, reason);
  }
}

function cleanupResultFailed(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "failed" in value &&
    typeof value.failed === "number" &&
    value.failed > 0
  );
}

export function installCancellationHandlers(options: {
  timeoutMs?: number;
  log?: (message: string) => void;
} = {}): void {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const log = options.log ?? ((message) => console.error(message));
  const handle = (signal: SupportedSignal): void => {
    if (handlingSignal) return;
    handlingSignal = true;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    const timer = setTimeout(() => {
      log(`release-e2e: ${signal} cleanup exceeded ${timeoutMs}ms; hard exit cannot guarantee finalization.`);
      process.exit(2);
    }, timeoutMs);
    timer.unref();
    void finalizeRegisteredForSignal(signal)
      .then(() => {
        clearTimeout(timer);
        process.exit(exitCode);
      })
      .catch(() => {
        clearTimeout(timer);
        process.exit(2);
      });
  };
  process.once("SIGINT", () => handle("SIGINT"));
  process.once("SIGTERM", () => handle("SIGTERM"));
}

async function writeCancellationReceipt(
  entry: RegisteredFinalizer,
  signal: SupportedSignal,
  status: "reconciled" | "failed",
  reason: string | null,
): Promise<void> {
  const receipt = {
    schema_version: 1,
    kind: "proliferate.qualification-cancellation-finalization",
    run: {
      run_id: entry.run.run_id,
      shard_id: entry.run.shard_id,
      attempt: entry.run.attempt,
      source_sha: entry.run.source_sha,
    },
    world: entry.world,
    signal,
    status,
    reason,
  };
  await mkdir(path.dirname(entry.receiptPath), { recursive: true });
  const temporary = `${entry.receiptPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, entry.receiptPath);
}

/** Test-only isolation for the process-global registry. */
export function clearCancellationFinalizersForTest(): void {
  registered.clear();
  handlingSignal = false;
}
