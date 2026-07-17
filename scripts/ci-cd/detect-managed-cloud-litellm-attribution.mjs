#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ATTESTATIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tests/release/fixtures/managed-cloud-litellm-attribution-attestations.v1.json",
);
const EXPECTED_KEYS = ["kind", "schema_version", "source_shas"];
const EXPECTED_KIND = "managed_cloud_litellm_attribution_attestations";

function safeSha(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("source SHA is malformed");
  }
  return value;
}

async function defaultReadAttestations() {
  return readFile(ATTESTATIONS_PATH, "utf8");
}

function parseAttestations(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("managed-cloud LiteLLM attribution attestations are malformed JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("managed-cloud LiteLLM attribution attestations must be an object");
  }
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error("managed-cloud LiteLLM attribution attestations have unknown or missing fields");
  }
  if (parsed.kind !== EXPECTED_KIND || parsed.schema_version !== 1 || !Array.isArray(parsed.source_shas)) {
    throw new Error("managed-cloud LiteLLM attribution attestations have an unsupported schema");
  }
  const sourceShas = parsed.source_shas.map(safeSha);
  if (new Set(sourceShas).size !== sourceShas.length) {
    throw new Error("managed-cloud LiteLLM attribution attestations contain duplicate source SHAs");
  }
  return sourceShas;
}

/**
 * Uses only the attestation list shipped by the trusted cleanup revision.
 * Source-candidate bytes are deliberately not read: an unreviewed branch
 * cannot opt itself into destructive LiteLLM reconciliation.
 */
export async function sourceSupportsLiteLlmAttribution(inputs, deps = {}) {
  const sourceSha = safeSha(inputs.sourceSha);
  const readAttestations = deps.readAttestations ?? defaultReadAttestations;
  return parseAttestations(await readAttestations()).includes(sourceSha);
}

function parseArgs(argv) {
  const sourceIndex = argv.indexOf("--source-sha");
  if (argv.length !== 2 || sourceIndex !== 0 || !argv[1]) {
    throw new Error("Usage: detect-managed-cloud-litellm-attribution --source-sha <sha>");
  }
  return { sourceSha: argv[1] };
}

async function main() {
  const supported = await sourceSupportsLiteLlmAttribution(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${supported}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.slice(0, 400) : "source attribution check failed");
    process.exitCode = 2;
  });
}
