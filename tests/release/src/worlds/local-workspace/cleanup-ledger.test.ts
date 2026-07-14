import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CLEANUP_LEDGER_FILENAME,
  loadCleanupLedger,
  openCleanupLedger,
  recoverInterruptedRuns,
  replayLedger,
  type CleanupLedgerEntry,
} from "./cleanup-ledger.js";

async function tempRunDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "cleanup-ledger-"));
}

test("openCleanupLedger writes a mode-0600 file immediately", async () => {
  const runDir = await tempRunDir();
  try {
    await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
    const stats = await stat(path.join(runDir, CLEANUP_LEDGER_FILENAME));
    assert.ok(stats.isFile());
    assert.equal(stats.mode & 0o777, 0o600);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("two-phase intent → acquired → reconciled persists across a reload", async () => {
  const runDir = await tempRunDir();
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
    await ledger.registerIntent("docker_network", "e1");
    await ledger.markAcquired("e1", "plq-net");
    const reloaded = await loadCleanupLedger(runDir);
    const [entry] = reloaded.entries();
    assert.equal(entry.phase, "acquired");
    assert.equal(entry.providerId, "plq-net");
    await reloaded.markReconciled("e1");
    assert.equal((await loadCleanupLedger(runDir)).unreconciled().length, 0);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("unreconciled() is reverse-registration order", async () => {
  const runDir = await tempRunDir();
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
    await ledger.registerIntent("run_directory", "first");
    await ledger.registerIntent("server_container", "second");
    await ledger.registerIntent("browser", "third");
    assert.deepEqual(ledger.unreconciled().map((entry) => entry.entryId), ["third", "second", "first"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("replayLedger reconciles unfinished entries idempotently and touches only handled kinds", async () => {
  const runDir = await tempRunDir();
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-1", shardId: "shard-0" });
    await ledger.registerIntent("server_container", "srv");
    await ledger.markAcquired("srv", "plq-server");
    await ledger.registerIntent("browser", "br");
    await ledger.markAcquired("br", "chromium");

    const released: string[] = [];
    const handlers = {
      server_container: async (entry: CleanupLedgerEntry) => {
        released.push(entry.providerId ?? "");
      },
    };
    const first = await replayLedger(ledger, handlers);
    assert.equal(first.reconciled, 1); // only server handled
    assert.equal(first.failed, 1); // browser has no handler
    assert.deepEqual(released, ["plq-server"]);

    // Idempotent: replaying again does not re-run the already-reconciled server.
    const second = await replayLedger(ledger, handlers);
    assert.equal(second.reconciled, 0);
    assert.deepEqual(released, ["plq-server"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("recoverInterruptedRuns finds only runs whose unreconciled entries exceed the TTL", async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "cleanup-recover-"));
  try {
    const t0 = new Date("2026-07-14T00:00:00.000Z");
    // Stale interrupted run.
    const staleDir = path.join(baseDir, "run-stale", "shard-0");
    const stale = await openCleanupLedger({ runDir: await mkdirp(staleDir), runId: "run-stale", shardId: "shard-0", now: () => t0 });
    await stale.registerIntent("server_container", "s");

    // Fresh in-flight run (recent activity).
    const freshDir = path.join(baseDir, "run-fresh", "shard-0");
    const now = new Date("2026-07-14T01:00:00.000Z");
    const fresh = await openCleanupLedger({ runDir: await mkdirp(freshDir), runId: "run-fresh", shardId: "shard-0", now: () => now });
    await fresh.registerIntent("server_container", "s");

    // Fully reconciled run — not interrupted.
    const doneDir = path.join(baseDir, "run-done", "shard-0");
    const done = await openCleanupLedger({ runDir: await mkdirp(doneDir), runId: "run-done", shardId: "shard-0", now: () => t0 });
    await done.registerIntent("server_container", "s");
    await done.markReconciled("s");

    const interrupted = await recoverInterruptedRuns({
      baseDir,
      ttlMs: 30 * 60_000,
      now: () => new Date("2026-07-14T01:00:00.000Z"),
    });
    assert.deepEqual(interrupted, [staleDir]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

async function mkdirp(dir: string): Promise<string> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  return dir;
}

test("the persisted ledger is valid JSON with the expected shape", async () => {
  const runDir = await tempRunDir();
  try {
    const ledger = await openCleanupLedger({ runDir, runId: "run-x", shardId: "shard-y" });
    await ledger.registerIntent("browser", "e1");
    const raw = JSON.parse(await readFile(path.join(runDir, CLEANUP_LEDGER_FILENAME), "utf8"));
    assert.equal(raw.ledgerId, "run-x:shard-y");
    assert.equal(raw.entries.length, 1);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
