/**
 * Canonical JSONL evidence sink: sink-owned envelopes, journal-recomputable
 * digests, monotonic sequence, append-after-finalize rejection, existing
 * evidence refusal, and atomic/exclusive finalize.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonlEvidenceSink } from "./jsonl-sink.js";
import { proofEventDigest } from "../contracts/proof.js";
import type { RunEvidence } from "../contracts/evidence.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "sink-"));
}

const FIXED_NOW = "2026-07-13T00:00:00.000Z";

function sink(dir: string, runId = "run-1", shardId = "shard-1-of-1"): JsonlEvidenceSink {
  return new JsonlEvidenceSink(dir, runId, shardId, {
    now: () => FIXED_NOW,
    eventIdFactory: (seq) => `evt-${seq}`,
  });
}

function fakeEvidence(): RunEvidence {
  return {
    schemaVersion: 1,
    run: {
      runId: "run-1",
      sourceSha: "deadbeef",
      candidateManifestHash: "a".repeat(64),
      retainedManifestHash: null,
      executionHost: "local",
      origin: "local:test",
      createdAt: FIXED_NOW,
    },
    shard: { runId: "run-1", shardId: "shard-1-of-1", shardIndex: 1, shardCount: 1 },
    behavior: "strict",
    qualifying: false,
    dryRun: false,
    plan: {
      selector: "explicit",
      behavior: "strict",
      worlds: [],
      cells: [],
      deferredScenarioIds: [],
      scenarioManifestHash: null,
    },
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds: [],
    finals: [],
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    evaluation: {
      behavior: "strict",
      verdict: { qualifying: false, reasons: ["x"] },
      missingCellKeys: [],
      duplicateCellKeys: [],
      nonGreenCellKeys: [],
      newlyBlockedCellKeys: [],
    },
    emittedAt: FIXED_NOW,
  };
}

test("append returns the ref of the EXACT persisted envelope; digest recomputes from the JSONL line", async () => {
  const dir = tmp();
  const s = sink(dir);
  const ref = await s.append({ event: "proof-assertion-pass", assertionId: "a1" });
  assert.equal(ref.eventId, "evt-1");
  assert.equal(ref.sequence, 1);
  const line = readFileSync(s.eventsPath, "utf8").trim();
  const persisted = JSON.parse(line);
  assert.equal(persisted.runId, "run-1");
  assert.equal(persisted.shardId, "shard-1-of-1");
  assert.equal(proofEventDigest(persisted), ref.digest, "digest recomputes from the persisted envelope");
  rmSync(dir, { recursive: true, force: true });
});

test("REGRESSION: a tampered journal line no longer matches the returned digest", async () => {
  const dir = tmp();
  const s = sink(dir);
  const ref = await s.append({ event: "proof-assertion-pass", assertionId: "a1" });
  const tampered = { ...JSON.parse(readFileSync(s.eventsPath, "utf8").trim()), assertionId: "forged" };
  assert.notEqual(proofEventDigest(tampered), ref.digest);
  rmSync(dir, { recursive: true, force: true });
});

test("sequence is monotonically increasing and preserved in order on disk", async () => {
  const dir = tmp();
  const s = sink(dir);
  const r1 = await s.append({ event: "one" });
  const r2 = await s.append({ event: "two" });
  const r3 = await s.append({ event: "three" });
  assert.deepEqual([r1.sequence, r2.sequence, r3.sequence], [1, 2, 3]);
  const sequences = readFileSync(s.eventsPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).sequence);
  assert.deepEqual(sequences, [1, 2, 3]);
  rmSync(dir, { recursive: true, force: true });
});

test("REGRESSION: append after finalize throws", async () => {
  const dir = tmp();
  const s = sink(dir);
  await s.append({ event: "one" });
  await s.finalize(fakeEvidence());
  await assert.rejects(() => s.append({ event: "late" }), /finalized; no further appends/);
  rmSync(dir, { recursive: true, force: true });
});

test("REGRESSION: an existing run/shard journal is refused, never silently adopted", async () => {
  const dir = tmp();
  const first = sink(dir);
  await first.append({ event: "one" });
  assert.throws(() => sink(dir), /journal already exists/);
  rmSync(dir, { recursive: true, force: true });
});

test("REGRESSION: an existing finalized verdict is refused at construction", async () => {
  const dir = tmp();
  const shardDir = path.join(dir, "run-1", "shard-1-of-1");
  const first = sink(dir);
  await first.finalize(fakeEvidence());
  assert.ok(existsSync(path.join(shardDir, "evidence.json")));
  rmSync(path.join(shardDir, "events.jsonl"));
  assert.throws(() => sink(dir), /already finalized/);
  rmSync(dir, { recursive: true, force: true });
});

test("finalize is atomic + exclusive: a second finalize throws and cannot replace the verdict", async () => {
  const dir = tmp();
  const s = sink(dir);
  await s.finalize(fakeEvidence());
  const original = readFileSync(s.evidencePath, "utf8");
  await assert.rejects(() => s.finalize({ ...fakeEvidence(), qualifying: true } as RunEvidence), /already finalized/);
  assert.equal(readFileSync(s.evidencePath, "utf8"), original, "verdict bytes unchanged");
  // No stray temp files left behind.
  const leftovers = readdirSync(path.dirname(s.evidencePath)).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
  rmSync(dir, { recursive: true, force: true });
});

test("REGRESSION: a pre-existing verdict written by another process is not replaced (check-then-write race)", async () => {
  const dir = tmp();
  const s = sink(dir);
  // Simulate another process winning the race after this sink's constructor.
  writeFileSync(s.evidencePath, '{"winner":"other-process"}\n');
  await assert.rejects(() => s.finalize(fakeEvidence()), /already finalized/);
  assert.match(readFileSync(s.evidencePath, "utf8"), /other-process/);
  rmSync(dir, { recursive: true, force: true });
});

test("append and finalize reject a credential-shaped key", async () => {
  const dir = tmp();
  const s = sink(dir);
  await assert.rejects(() => s.append({ event: "x", access_token: "leak" }), /credential-shaped key/);
  await assert.rejects(
    () => s.finalize({ ...fakeEvidence(), leaked: { password: "p" } } as unknown as RunEvidence),
    /credential-shaped key/,
  );
  rmSync(dir, { recursive: true, force: true });
});
