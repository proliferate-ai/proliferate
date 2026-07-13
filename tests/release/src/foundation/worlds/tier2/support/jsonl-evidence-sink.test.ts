import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonlEvidenceSink } from "./jsonl-evidence-sink.js";
import type { RunEvidence } from "../../../contracts/evidence.js";

function tmpBasePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-tier2-evidence-"));
  return path.join(dir, "run");
}

function fakeEvidence(overrides: Partial<RunEvidence> = {}): RunEvidence {
  return {
    schemaVersion: 1,
    run: {
      runId: "run-1",
      sourceSha: "deadbeef",
      candidateManifestHash: "hash",
      retainedManifestHash: null,
      executionHost: "local",
      origin: "local:test",
      createdAt: new Date().toISOString(),
    },
    shard: { runId: "run-1", shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 },
    behavior: "diagnostic",
    qualifying: false,
    dryRun: false,
    plan: { selector: "explicit", behavior: "diagnostic", worlds: ["tier-2"], cells: [], deferredScenarioIds: [] },
    preflight: { results: [], blockedCellKeys: [], complete: true },
    worlds: [],
    finals: [],
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    evaluation: { behavior: "diagnostic", verdict: { qualifying: false, reasons: ["diagnostic evidence is always nonqualifying"] }, missingCellKeys: [], duplicateCellKeys: [], nonGreenCellKeys: [], newlyBlockedCellKeys: [] },
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("JsonlEvidenceSink: append persists one JSON line per event", async () => {
  const base = tmpBasePath();
  const sink = new JsonlEvidenceSink(base);
  await sink.append({ kind: "readiness-observation", check: "server-health", ok: true });
  await sink.append({ kind: "readiness-observation", check: "postgres-schema", ok: true });
  const lines = readFileSync(`${base}.events.jsonl`, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal((JSON.parse(lines[0]) as { check: string }).check, "server-health");
});

test("JsonlEvidenceSink: finalize writes exactly one final document and a second call throws", async () => {
  const base = tmpBasePath();
  const sink = new JsonlEvidenceSink(base);
  await sink.finalize(fakeEvidence());
  const written = JSON.parse(readFileSync(`${base}.final.json`, "utf8")) as RunEvidence;
  assert.equal(written.run.runId, "run-1");
  await assert.rejects(() => sink.finalize(fakeEvidence()), /more than once/);
});

test("JsonlEvidenceSink: append rejects a payload with a redaction-policy-matched key", async () => {
  const sink = new JsonlEvidenceSink(tmpBasePath());
  await assert.rejects(
    () => sink.append({ kind: "boom", stripeSecretKey: "sk_test_should_never_be_here" }),
    /redaction-policy-matched key/,
  );
});

test("JsonlEvidenceSink: finalize rejects a payload with a redaction-policy-matched key, nested", async () => {
  const sink = new JsonlEvidenceSink(tmpBasePath());
  await assert.rejects(
    () => sink.finalize(fakeEvidence({ worlds: [{ world: "tier-2", readiness: [], observedArtifacts: { access_token: "leaked" } }] })),
    /redaction-policy-matched key/,
  );
});
