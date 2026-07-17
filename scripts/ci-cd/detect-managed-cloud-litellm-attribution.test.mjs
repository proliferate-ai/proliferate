import assert from "node:assert/strict";
import { test } from "node:test";

import { sourceSupportsLiteLlmAttribution } from "./detect-managed-cloud-litellm-attribution.mjs";

const SOURCE_SHA = "a".repeat(40);
const INPUTS = { sourceSha: SOURCE_SHA };

function attestations(sourceShas) {
  return JSON.stringify({
    kind: "managed_cloud_litellm_attribution_attestations",
    schema_version: 1,
    source_shas: sourceShas,
  });
}

test("an empty trusted attestation list leaves every source unsupported", async () => {
  assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
    async readAttestations() { return attestations([]); },
  }), false);
});

test("only an exact source SHA in the trusted attestation list opts in", async () => {
  assert.equal(await sourceSupportsLiteLlmAttribution(INPUTS, {
    async readAttestations() { return attestations([SOURCE_SHA]); },
  }), true);
  assert.equal(await sourceSupportsLiteLlmAttribution({ sourceSha: "b".repeat(40) }, {
    async readAttestations() { return attestations([SOURCE_SHA]); },
  }), false);
});

test("source-authored compatibility-contract bytes cannot opt a source in", async () => {
  const sourceContract = JSON.stringify({
    schema_version: 1,
    managed_cloud_job: "cloud-provision-1 (manual, strict)",
    run_id_format: "qlc-ci-{workflow_run_id}-{workflow_run_attempt}",
    shard_id: "1",
    litellm_metadata: {
      run_id: "proliferate_qualification_run_id",
      shard_id: "proliferate_qualification_shard_id",
    },
  });
  await assert.rejects(
    () => sourceSupportsLiteLlmAttribution(INPUTS, {
      async readAttestations() { return sourceContract; },
    }),
    /unknown or missing fields/,
  );
});

test("malformed, extended, duplicate, and non-SHA attestations fail closed", async () => {
  const invalid = [
    "not json",
    JSON.stringify({ kind: "wrong", schema_version: 1, source_shas: [] }),
    JSON.stringify({
      kind: "managed_cloud_litellm_attribution_attestations",
      schema_version: 1,
      source_shas: [],
      extra: true,
    }),
    attestations([SOURCE_SHA, SOURCE_SHA]),
    attestations(["../main"]),
  ];
  for (const source of invalid) {
    await assert.rejects(
      () => sourceSupportsLiteLlmAttribution(INPUTS, {
        async readAttestations() { return source; },
      }),
    );
  }
});

test("rejects an untrusted source identity before reading attestations", async () => {
  let called = false;
  await assert.rejects(
    () => sourceSupportsLiteLlmAttribution({ sourceSha: "../main" }, {
      async readAttestations() { called = true; return attestations([]); },
    }),
    /source SHA is malformed/,
  );
  assert.equal(called, false);
});
