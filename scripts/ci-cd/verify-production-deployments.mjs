#!/usr/bin/env node
// Verify that every component in a candidate release manifest has a valid,
// successful production GitHub Deployment.
//
// Contract: specs/codebase/features/support-system.md -> "Release manifest" and
// specs/tbd/support-system-end-to-end-handoff.md -> "Wave 7". This is the R2
// deliverable named by the handoff runbook. For each `release.components[]`
// entry it fetches the full Deployment payload from `production/<component>`,
// requires schemaVersion=1, component/release/head agreement, recomputes each
// artifact digest from the immutable provider references, enforces the exact
// checked-in lane matrix, and rejects a prior same-release deployment with
// different digests. It is an independent validator, not a substitute for the
// deployment summary loop.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestMap } from "./create-component-deployment.mjs";
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

function createReader({ repository, token, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!repository) throw new Error("repository (owner/name) is required.");

  async function paginate(apiPath) {
    const results = [];
    const separator = apiPath.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await doFetch(
        `${GITHUB_API}/repos/${repository}${apiPath}${separator}per_page=100&page=${page}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
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

  return { paginate };
}

function firstSuccessAt(statuses) {
  const successes = statuses
    .filter((status) => status.state === "success" && typeof status.created_at === "string")
    .map((status) => status.created_at)
    .sort();
  return successes.length > 0 ? successes[0] : null;
}

// Validate a single Deployment payload against the checked-in matrix and the
// manifest component entry. Returns the list of errors (empty when valid).
export function validatePayload({ payload, component, manifestComponent, matrix }) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return [`${component}: deployment has no v1 payload.`];
  }
  if (payload.schemaVersion !== 1) {
    errors.push(`${component}: payload schemaVersion must be 1, got ${payload.schemaVersion}.`);
  }
  if (payload.component !== component) {
    errors.push(`${component}: payload component mismatch (${payload.component}).`);
  }
  if (payload.releaseId !== manifestComponent.releaseId) {
    errors.push(
      `${component}: payload releaseId ${payload.releaseId} != manifest ${manifestComponent.releaseId}.`,
    );
  }
  if (payload.headSha !== manifestComponent.headSha) {
    errors.push(
      `${component}: payload headSha ${payload.headSha} != manifest ${manifestComponent.headSha}.`,
    );
  }

  // Recompute every digest from immutable references and enforce the matrix.
  const required = requiredLanesFor(component, matrix);
  const seen = new Set();
  const recomputed = {};
  for (const artifact of payload.artifacts || []) {
    if (!required.includes(artifact.lane)) {
      errors.push(`${component}: unexpected lane ${artifact.lane} not in the checked-in matrix.`);
      continue;
    }
    if (seen.has(artifact.lane)) {
      errors.push(`${component}: duplicate lane proof ${artifact.lane}.`);
      continue;
    }
    seen.add(artifact.lane);
    try {
      const provider = providerForLane(artifact.lane, matrix);
      const canonical = canonicalizeReferences(provider, artifact.references || []);
      const digest = computeArtifactSetDigest(provider, canonical);
      recomputed[artifact.lane] = digest;
      if (digest !== artifact.artifactSetDigest) {
        errors.push(
          `${component}/${artifact.lane}: recomputed digest ${digest} != payload ${artifact.artifactSetDigest}.`,
        );
      }
    } catch (error) {
      errors.push(`${component}/${artifact.lane}: ${error.message}`);
    }
  }
  for (const lane of required) {
    if (!seen.has(lane)) {
      errors.push(`${component}: missing required lane proof ${lane}.`);
    }
  }

  // The manifest carries only lane+digest; each must match the payload's
  // recomputed digest exactly.
  const manifestDigests = {};
  for (const artifact of manifestComponent.artifacts || []) {
    manifestDigests[artifact.lane] = artifact.artifactSetDigest;
  }
  const manifestLanes = Object.keys(manifestDigests).sort();
  if (manifestLanes.join(",") !== [...required].sort().join(",")) {
    errors.push(
      `${component}: manifest lanes [${manifestLanes.join(", ")}] do not match required [${[...required].sort().join(", ")}].`,
    );
  }
  for (const lane of manifestLanes) {
    if (recomputed[lane] && recomputed[lane] !== manifestDigests[lane]) {
      errors.push(
        `${component}/${lane}: manifest digest ${manifestDigests[lane]} != recomputed ${recomputed[lane]}.`,
      );
    }
  }

  return errors;
}

export async function verifyProductionDeployments({
  manifest,
  repository,
  token,
  fetchImpl,
  matrix = loadLaneMatrix(),
}) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1) {
    throw new Error("Manifest schemaVersion must be 1.");
  }
  const reader = createReader({ repository, token, fetchImpl });
  const components = (manifest.release && manifest.release.components) || [];

  for (const manifestComponent of components) {
    const component = manifestComponent.component;
    if (!matrix.components[component]) {
      errors.push(`${component}: not a known component in the checked-in matrix.`);
      continue;
    }
    const environment = `production/${component}`;
    const deployments = await reader.paginate(
      `/deployments?environment=${encodeURIComponent(environment)}`,
    );
    const sameRelease = deployments.filter(
      (deployment) => deployment.payload && deployment.payload.releaseId === manifestComponent.releaseId,
    );
    if (sameRelease.length === 0) {
      errors.push(`${component}: no production Deployment found for ${manifestComponent.releaseId}.`);
      continue;
    }

    // Reject a prior same-release deployment with different digests.
    const distinct = new Set(sameRelease.map((d) => JSON.stringify(digestMap(d.payload))));
    if (distinct.size > 1) {
      errors.push(
        `${component}: multiple deployments for ${manifestComponent.releaseId} carry different artifact digests.`,
      );
      continue;
    }

    const deployment = sameRelease.sort((a, b) => a.id - b.id)[0];
    errors.push(
      ...validatePayload({ payload: deployment.payload, component, manifestComponent, matrix }),
    );

    const statuses = await reader.paginate(`/deployments/${deployment.id}/statuses`);
    const created = firstSuccessAt(statuses);
    if (!created) {
      errors.push(`${component}: deployment ${deployment.id} has no successful status.`);
    } else if (manifestComponent.deployedAt && manifestComponent.deployedAt !== created) {
      errors.push(
        `${component}: manifest deployedAt ${manifestComponent.deployedAt} != first-success ${created}.`,
      );
    }
    if (
      manifestComponent.deploymentId != null &&
      manifestComponent.deploymentId !== deployment.id
    ) {
      errors.push(
        `${component}: manifest deploymentId ${manifestComponent.deploymentId} != found ${deployment.id}.`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
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
  if (!args.manifest) throw new Error("--manifest is required.");
  if (!args.repository) throw new Error("--repository is required.");
  const manifest = JSON.parse(fs.readFileSync(args.manifest, "utf8"));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const matrix = loadLaneMatrix(args.matrix || DEFAULT_MATRIX_PATH);
  const { ok, errors } = await verifyProductionDeployments({
    manifest,
    repository: args.repository,
    token,
    matrix,
  });
  if (!ok) {
    for (const error of errors) {
      process.stderr.write(`::error::${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write("All production deployments verified.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
