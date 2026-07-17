import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sourceSupportsLiteLlmAttribution } from "./detect-managed-cloud-litellm-attribution.mjs";

const INPUTS = {
  repository: "proliferate-ai/proliferate",
  sourceSha: "a".repeat(40),
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT = readFileSync(
  path.join(REPO_ROOT, "tests/release/fixtures/managed-cloud-hard-cancel-contract.v1.json"),
  "utf8",
);

test("accepts only the exact explicit source compatibility receipt", async () => {
  const reads = [];
  assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
    async readContract(repository, sha) {
      reads.push([repository, sha]);
      return CONTRACT;
    },
  }), true);
  assert.deepEqual(reads, [[INPUTS.repository, INPUTS.sourceSha]]);
});

test("an older source without the explicit receipt remains unsupported", async () => {
  assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
    async readContract() { return null; },
  }), false);
});

test("comments and dead implementation-marker strings cannot opt a source in", async () => {
  const deadStrings = [
    "AGENT_GATEWAY_QUALIFICATION_RUN_ID",
    "AGENT_GATEWAY_QUALIFICATION_SHARD_ID",
    "proliferate_qualification_run_id",
    "proliferate_qualification_shard_id",
  ].join("\n// ");
  assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
    async readContract() { return deadStrings; },
  }).catch((error) => error.message), "managed-cloud hard-cancel source contract is malformed");
});

test("a partial, extended, or altered receipt remains unsupported", async () => {
  for (const contract of [
    JSON.stringify({ ...JSON.parse(CONTRACT), shard_id: "2" }),
    JSON.stringify({ ...JSON.parse(CONTRACT), extra: true }),
  ]) {
    assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
      async readContract() { return contract; },
    }), false);
  }
});

test("rejects untrusted source identities before reading GitHub", async () => {
  let called = false;
  await assert.rejects(
    () => sourceSupportsLiteLlmAttribution({ ...INPUTS, sourceSha: "../main" }, {
      async readContract() { called = true; return ""; },
    }),
    /source SHA is malformed/,
  );
  assert.equal(called, false);
});
