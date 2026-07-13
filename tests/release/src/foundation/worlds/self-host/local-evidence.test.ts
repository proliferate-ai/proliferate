/**
 * Self-host durable evidence writer: canonical integrity semantics via
 * DurableEvidenceCore, including the materialized (post-toJSON) forbidden-key
 * screen that pre-scrub alone cannot provide.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalJsonlEvidenceSink } from "./local-evidence.js";

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "sh-evidence-")), "evidence.jsonl");
}

test("SELF-HOST SINK: a toJSON-revealed credential key is rejected AFTER materialization (pre-scrub is insufficient)", async () => {
  const file = tmpFile();
  const sink = new LocalJsonlEvidenceSink(file, "test-nonqualifying-run", "shard-1-of-1");
  // Pre-scrub walks the RAW object and sees only a harmless method; the
  // credential key exists only after materialization applies toJSON.
  const trojan = {
    event: "x",
    payload: { toJSON: () => ({ access_token: "leaked-by-tojson" }) },
  };
  await assert.rejects(() => sink.append(trojan), /credential-shaped key/);
  assert.equal(readFileSync(file, "utf8"), "", "nothing persisted");
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test("SELF-HOST SINK: requires explicit run/shard identity and stamps it into envelopes", async () => {
  const file = tmpFile();
  const sink = new LocalJsonlEvidenceSink(file, "sh-real-run-42", "shard-1-of-1");
  await sink.append({ event: "x" });
  const persisted = JSON.parse(readFileSync(file, "utf8").trim());
  assert.equal(persisted.runId, "sh-real-run-42");
  assert.equal(persisted.shardId, "shard-1-of-1");
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test("SELF-HOST SINK: two instances on one journal cannot both write sequence 1", async () => {
  const file = tmpFile();
  const first = new LocalJsonlEvidenceSink(file, "test-nonqualifying-run", "shard-1-of-1");
  await first.append({ event: "claim" }); // lazy core: first use claims
  const second = new LocalJsonlEvidenceSink(file, "test-nonqualifying-run", "shard-1-of-1");
  await assert.rejects(() => second.append({ event: "intruder" }), /journal already exists/);
  rmSync(path.dirname(file), { recursive: true, force: true });
});
