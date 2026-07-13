import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileCleanupLedger, openLedger } from "./file-ledger.js";

function ledgerPath(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  return { dir, file: path.join(dir, "cleanup.jsonl") };
}

const entry = (resourceId: string) => ({
  runId: "run-1",
  shardId: "shard-1-of-1",
  provider: "e2b",
  resourceType: "sandbox",
  resourceId,
  owningWorld: "managed-cloud",
});

test("register persists the entry to disk BEFORE returning (before resource use)", async () => {
  const { dir, file } = ledgerPath();
  const ledger = new FileCleanupLedger(file);
  const seq = await ledger.register(entry("sbx_1"));
  // The moment register resolves, the durable record already exists on disk.
  const onDisk = readFileSync(file, "utf8");
  assert.match(onDisk, /"type":"register"/);
  assert.match(onDisk, /sbx_1/);
  assert.equal(seq, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("transitions fold to the latest state and count cleaning attempts", async () => {
  const { dir, file } = ledgerPath();
  const ledger = new FileCleanupLedger(file);
  const seq = await ledger.register(entry("sbx_2"));
  await ledger.transition(seq, "cleaning");
  await ledger.transition(seq, "failed", "boom");
  await ledger.transition(seq, "cleaning");
  await ledger.transition(seq, "cleaned");
  const [folded] = await ledger.entries();
  assert.equal(folded.state, "cleaned");
  assert.equal(folded.attempts, 2, "two cleaning transitions => two attempts");
  assert.equal(folded.lastError, "boom", "last recorded error is preserved through later success");
  rmSync(dir, { recursive: true, force: true });
});

test("reopening the same file continues the sequence counter (replayable)", async () => {
  const { dir, file } = ledgerPath();
  const first = new FileCleanupLedger(file);
  await first.register(entry("a"));
  await first.register(entry("b"));
  const reopened = openLedger(file);
  const seq = await reopened.register(entry("c"));
  assert.equal(seq, 2, "sequence continues past existing entries, no collision");
  const entries = await reopened.entries();
  assert.deepEqual(entries.map((e) => e.resourceId), ["a", "b", "c"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a torn final line is ignored; earlier events remain a valid record", async () => {
  const { dir, file } = ledgerPath();
  const ledger = new FileCleanupLedger(file);
  await ledger.register(entry("whole"));
  // Simulate an interrupted write: append a partial JSON line with no newline.
  const { appendFileSync } = await import("node:fs");
  appendFileSync(file, '{"type":"regis');
  const reopened = openLedger(file);
  const entries = await reopened.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].resourceId, "whole");
  rmSync(dir, { recursive: true, force: true });
});

test("register rejects a credential-shaped key in the entry", async () => {
  const { dir, file } = ledgerPath();
  const ledger = new FileCleanupLedger(file);
  await assert.rejects(
    // @ts-expect-error deliberately smuggling a forbidden key
    () => ledger.register({ ...entry("x"), secret: "leak" }),
    /credential-shaped key/,
  );
  rmSync(dir, { recursive: true, force: true });
});
