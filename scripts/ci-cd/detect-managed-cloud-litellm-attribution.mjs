#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const CONTRACT_PATH = "tests/release/fixtures/managed-cloud-hard-cancel-contract.v1.json";
const EXPECTED_CONTRACT = {
  schema_version: 1,
  managed_cloud_job: "cloud-provision-1 (manual, strict)",
  run_id_format: "qlc-ci-{workflow_run_id}-{workflow_run_attempt}",
  shard_id: "1",
  litellm_metadata: {
    run_id: "proliferate_qualification_run_id",
    shard_id: "proliferate_qualification_shard_id",
  },
};

function safeSha(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("source SHA is malformed");
  }
  return value;
}

function safeRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GitHub repository identity is malformed");
  }
  return value;
}

async function defaultReadContract(repository, sourceSha) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const response = await fetch(
    `https://api.github.com/repos/${repository}/contents/${CONTRACT_PATH}?ref=${sourceSha}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub source-contract read failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    payload.type !== "file" || payload.encoding !== "base64" || typeof payload.content !== "string"
  ) {
    throw new Error("GitHub returned a malformed source-contract response");
  }
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

function exactContract(source) {
  if (source === null) return false;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("managed-cloud hard-cancel source contract is malformed");
  }
  return JSON.stringify(parsed) === JSON.stringify(EXPECTED_CONTRACT);
}

/**
 * Reads, but never executes, the exact source candidate's explicit
 * compatibility receipt. Comments, dead strings, and partial implementation
 * markers cannot opt a candidate into destructive provider reconciliation.
 * Older source runs without the receipt remain unsupported.
 */
export async function sourceSupportsLiteLlmAttribution(inputs, deps = {}) {
  const repository = safeRepository(inputs.repository);
  const sourceSha = safeSha(inputs.sourceSha);
  const readContract = deps.readContract ?? defaultReadContract;
  return exactContract(await readContract(repository, sourceSha));
}

function parseArgs(argv, env = process.env) {
  const sourceIndex = argv.indexOf("--source-sha");
  if (argv.length !== 2 || sourceIndex !== 0 || !argv[1]) {
    throw new Error("Usage: detect-managed-cloud-litellm-attribution --source-sha <sha>");
  }
  return { sourceSha: argv[1], repository: env.GITHUB_REPOSITORY ?? "" };
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
