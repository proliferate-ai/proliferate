import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonlEvidenceSink } from "./jsonl-sink.js";
import type { RunEvidence } from "../contracts/evidence.js";

function outDir(): string {
  return mkdtempSync(path.join(tmpdir(), "evidence-"));
}

function minimalEvidence(): RunEvidence {
  const run = {
    runId: "run-1",
    sourceSha: "abc",
    candidateManifestHash: "a".repeat(64),
    retainedManifestHash: null,
    executionHost: "local" as const,
    origin: "local:x",
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  const shard = { runId: "run-1", shardId: "shard-1-of-1", shardIndex: 1, shardCount: 1 };
  return {
    schemaVersion: 1,
    run,
    shard,
    behavior: "strict",
    qualifying: false,
    dryRun: false,
    plan: { selector: "explicit", behavior: "strict", worlds: [], cells: [], deferredScenarioIds: [] },
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
    emittedAt: "2026-07-13T00:00:01.000Z",
  };
}

test("append writes JSONL events; finalize writes the immutable document once", async () => {
  const dir = outDir();
  const sink = new JsonlEvidenceSink(dir, "run-1", "shard-1-of-1");
  await sink.append({ event: "readiness", world: "tier-2", ok: true });
  await sink.append({ event: "cell-attempt", cellKey: "k", status: "green" });
  const events = readFileSync(sink.eventsPath, "utf8").trim().split("\n");
  assert.equal(events.length, 2);
  assert.match(events[0], /"event":"readiness"/);

  await sink.finalize(minimalEvidence());
  assert.ok(existsSync(sink.evidencePath));
  const doc = JSON.parse(readFileSync(sink.evidencePath, "utf8")) as RunEvidence;
  assert.equal(doc.run.runId, "run-1");

  await assert.rejects(() => sink.finalize(minimalEvidence()), /already finalized/);
  rmSync(dir, { recursive: true, force: true });
});

test("append and finalize reject a credential-shaped key", async () => {
  const dir = outDir();
  const sink = new JsonlEvidenceSink(dir, "run-1", "shard-1-of-1");
  await assert.rejects(() => sink.append({ event: "x", access_token: "leak" }), /credential-shaped key/);
  await assert.rejects(
    () => sink.finalize({ ...minimalEvidence(), leaked: { password: "p" } } as unknown as RunEvidence),
    /credential-shaped key/,
  );
  rmSync(dir, { recursive: true, force: true });
});
