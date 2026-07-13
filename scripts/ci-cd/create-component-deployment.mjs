#!/usr/bin/env node
// Create (or idempotently reuse) the single GitHub Deployment that attests a
// component's production promotion.
//
// Contract: specs/codebase/features/support-system.md -> "Release manifest".
// After all required lanes succeed for a component, exactly one Deployment is
// created in environment `production/<component>` carrying the immutable v1
// payload: schemaVersion=1, component, releaseId, full headSha, and the sorted
// lane proofs (each lane's immutable references + digest). The Deployment ID and
// its FIRST successful status's created_at are the durable attestation
// identity/time; retries reuse that Deployment and never substitute the clock.
// A prior Deployment for the same release ID with different artifact digests is
// a hard failure.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeReferences,
  computeArtifactSetDigest,
  loadLaneMatrix,
  providerForLane,
  requiredLanesFor,
} from "./collect-lane-proof.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MATRIX_PATH = path.join(HERE, "release-lane-matrix.json");
const GITHUB_API = "https://api.github.com";
const MAX_PAGES = 50;

// Validate the supplied lane proofs against the checked-in matrix and produce
// the canonical immutable v1 Deployment payload. Rejects a missing, extra, or
// duplicate lane and recomputes every digest from its references.
export function buildDeploymentPayload({ component, releaseId, headSha, proofs, matrix }) {
  if (!component) throw new Error("component is required.");
  if (!releaseId) throw new Error("releaseId is required.");
  if (typeof headSha !== "string" || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`headSha must be a full 40-character git SHA: ${headSha}`);
  }
  const required = requiredLanesFor(component, matrix);
  const requiredSet = new Set(required);

  const seenLanes = new Set();
  const artifacts = [];
  for (const proof of proofs) {
    if (!proof || typeof proof.lane !== "string") {
      throw new Error("Each proof must carry a `lane`.");
    }
    const { lane, references } = proof;
    if (!requiredSet.has(lane)) {
      throw new Error(`Lane ${lane} is not required for component ${component}.`);
    }
    if (seenLanes.has(lane)) {
      throw new Error(`Duplicate lane proof: ${lane}`);
    }
    seenLanes.add(lane);
    const provider = providerForLane(lane, matrix);
    const canonical = canonicalizeReferences(provider, references);
    const artifactSetDigest = computeArtifactSetDigest(provider, canonical);
    if (proof.artifactSetDigest && proof.artifactSetDigest !== artifactSetDigest) {
      throw new Error(
        `Lane ${lane} artifactSetDigest mismatch: supplied ${proof.artifactSetDigest}, recomputed ${artifactSetDigest}.`,
      );
    }
    artifacts.push({ lane, provider, artifactSetDigest, references: canonical });
  }

  const missing = required.filter((lane) => !seenLanes.has(lane));
  if (missing.length > 0) {
    throw new Error(`Missing required lane proof(s) for ${component}: ${missing.join(", ")}`);
  }

  artifacts.sort((a, b) => (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0));
  return { schemaVersion: 1, component, releaseId, headSha, artifacts };
}

// Two payloads describe the same immutable artifact set when their per-lane
// digest maps are identical.
export function digestMap(payload) {
  const map = {};
  for (const artifact of payload.artifacts || []) {
    map[artifact.lane] = artifact.artifactSetDigest;
  }
  return map;
}

function sameDigests(a, b) {
  const left = digestMap(a);
  const right = digestMap(b);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
    if (left[leftKeys[i]] !== right[rightKeys[i]]) return false;
  }
  return true;
}

function createGithubClient({ repository, token, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!repository) throw new Error("repository (owner/name) is required.");
  if (!token) throw new Error("A GitHub token is required.");

  async function request(method, apiPath, body) {
    const response = await doFetch(`${GITHUB_API}/repos/${repository}${apiPath}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub ${method} ${apiPath} failed (${response.status}): ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  // Paginate a GET that returns an array, following the RFC-5988 `Link` header.
  async function paginate(apiPath) {
    const results = [];
    let page = 1;
    const separator = apiPath.includes("?") ? "&" : "?";
    for (; page <= MAX_PAGES; page += 1) {
      const response = await doFetch(
        `${GITHUB_API}/repos/${repository}${apiPath}${separator}per_page=100&page=${page}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "x-github-api-version": "2022-11-28",
          },
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub GET ${apiPath} failed (${response.status}): ${text}`);
      }
      const batch = await response.json();
      if (!Array.isArray(batch) || batch.length === 0) {
        return results;
      }
      results.push(...batch);
      const link = response.headers.get ? response.headers.get("link") : null;
      if (!link || !link.includes('rel="next"')) {
        return results;
      }
    }
    throw new Error(`Deployment pagination exceeded ${MAX_PAGES} pages for ${apiPath}.`);
  }

  return { request, paginate };
}

// Earliest successful status's created_at, or null when none is success yet.
function firstSuccessAt(statuses) {
  const successes = statuses
    .filter((status) => status.state === "success" && typeof status.created_at === "string")
    .map((status) => status.created_at)
    .sort();
  return successes.length > 0 ? successes[0] : null;
}

export async function createOrReuseComponentDeployment({
  repository,
  component,
  releaseId,
  headSha,
  proofs,
  token,
  fetchImpl,
  matrix = loadLaneMatrix(),
}) {
  const payload = buildDeploymentPayload({ component, releaseId, headSha, proofs, matrix });
  const environment = `production/${component}`;
  const client = createGithubClient({ repository, token, fetchImpl });

  const deployments = await client.paginate(
    `/deployments?environment=${encodeURIComponent(environment)}`,
  );

  // A release ID identifies one immutable artifact set. Any existing deployment
  // for the same releaseId with different digests is a hard failure, regardless
  // of head SHA.
  const sameRelease = deployments.filter(
    (deployment) => deployment.payload && deployment.payload.releaseId === releaseId,
  );
  for (const deployment of sameRelease) {
    if (!sameDigests(deployment.payload, payload)) {
      throw new Error(
        `Release ${releaseId} already has deployment ${deployment.id} with different artifact digests; refusing to attest divergent bytes.`,
      );
    }
  }

  if (sameRelease.length > 0) {
    // Reuse the existing deployment: preserve its first-success timestamp.
    const existing = sameRelease.sort((a, b) => a.id - b.id)[0];
    const statuses = await client.paginate(`/deployments/${existing.id}/statuses`);
    let created = firstSuccessAt(statuses);
    if (!created) {
      const status = await client.request("POST", `/deployments/${existing.id}/statuses`, {
        state: "success",
        environment,
        description: `Attested ${releaseId}`,
        auto_inactive: false,
      });
      created = status.created_at;
    }
    return {
      deploymentId: existing.id,
      firstSuccessAt: created,
      reused: true,
      payload,
    };
  }

  const deployment = await client.request("POST", "/deployments", {
    ref: headSha,
    environment,
    payload,
    auto_merge: false,
    required_contexts: [],
    transient_environment: false,
    production_environment: true,
    description: `Attest ${releaseId}`,
  });
  const status = await client.request("POST", `/deployments/${deployment.id}/statuses`, {
    state: "success",
    environment,
    description: `Attested ${releaseId}`,
    auto_inactive: false,
  });
  return {
    deploymentId: deployment.id,
    firstSuccessAt: status.created_at,
    reused: false,
    payload,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const proofs = args.proofs
    ? JSON.parse(args.proofs)
    : JSON.parse(fs.readFileSync(args["proofs-file"], "utf8"));
  const result = await createOrReuseComponentDeployment({
    repository: args.repository || process.env.GITHUB_REPOSITORY,
    component: args.component,
    releaseId: args["release-id"],
    headSha: args["head-sha"],
    proofs,
    token,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
