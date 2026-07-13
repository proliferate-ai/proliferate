#!/usr/bin/env node
// Collect a production lane's immutable artifact-set proof.
//
// Contract: specs/codebase/features/support-system.md -> "Release manifest".
// Each production lane returns an `artifactSetDigest`: the lowercase SHA-256 of
// its canonical, sorted, immutable provider references. Containers use OCI
// digests (`sha256:<64hex>`), Vercel/EAS/E2B use immutable provider
// deployment/build IDs, and desktop/runtime/self-hosted assets use published
// SHA-256 checksums.
//
// The digest is computed over ONLY the normalized+sorted references so that the
// release finalizer, the GitHub Deployment payload, and
// verify-production-deployments.mjs all recompute the exact same bytes from the
// same references. Lane/component identity is enforced separately by the
// checked-in matrix and never mixed into the digest.
//
// CLI:
//   node collect-lane-proof.mjs --lane hosted-server \
//     --references '["repo@sha256:<64hex>", "sha256:<64hex>"]'
//   # or feed newline/comma-separated references with --references-file / stdin.
// Prints a JSON proof object: {lane, provider, references, artifactSetDigest}.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MATRIX_PATH = path.join(HERE, "release-lane-matrix.json");

const OCI_DIGEST_RE = /^(?:[^\s@]+@)?sha256:[0-9a-f]{64}$/;
const CHECKSUM_RE = /^(?:[^\s:]+:)?[0-9a-f]{64}$/;
// Immutable provider IDs (Vercel deployment id, EAS build id, E2B build id).
// They are opaque, case-sensitive, and must never contain whitespace.
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function loadLaneMatrix(matrixPath = DEFAULT_MATRIX_PATH) {
  const raw = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported lane matrix schemaVersion: ${raw.schemaVersion}`);
  }
  if (!raw.components || !raw.lanes) {
    throw new Error("Lane matrix must define both `components` and `lanes`.");
  }
  return raw;
}

export function requiredLanesFor(component, matrix = loadLaneMatrix()) {
  const lanes = matrix.components[component];
  if (!lanes) {
    throw new Error(`Unknown component: ${component}`);
  }
  // Return a sorted copy; the matrix is the sole authority for lane membership.
  return [...lanes].sort();
}

export function providerForLane(lane, matrix = loadLaneMatrix()) {
  const laneSpec = matrix.lanes[lane];
  if (!laneSpec) {
    throw new Error(`Unknown production lane: ${lane}`);
  }
  return laneSpec.provider;
}

function normalizeReference(provider, rawReference) {
  if (typeof rawReference !== "string") {
    throw new Error(`Reference must be a string, got ${typeof rawReference}.`);
  }
  const reference = rawReference.trim();
  if (reference === "") {
    throw new Error("Reference must not be empty.");
  }
  if (/\s/.test(reference)) {
    throw new Error(`Reference must not contain whitespace: ${JSON.stringify(rawReference)}`);
  }
  switch (provider) {
    case "oci": {
      const lowered = reference.toLowerCase();
      if (!OCI_DIGEST_RE.test(lowered)) {
        throw new Error(
          `OCI reference must be a pinned sha256 digest (name@sha256:<64hex> or sha256:<64hex>): ${reference}`,
        );
      }
      return lowered;
    }
    case "checksum": {
      const lowered = reference.toLowerCase();
      if (!CHECKSUM_RE.test(lowered)) {
        throw new Error(
          `Checksum reference must be a published SHA-256 (<name>:<64hex> or <64hex>): ${reference}`,
        );
      }
      return lowered;
    }
    case "vercel":
    case "eas":
    case "e2b": {
      // Opaque immutable provider deployment/build IDs; case-sensitive.
      if (!PROVIDER_ID_RE.test(reference)) {
        throw new Error(`Invalid ${provider} provider reference: ${reference}`);
      }
      return reference;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// Normalize, reject duplicates, and sort. The sort makes the digest independent
// of caller ordering; duplicate rejection keeps a mutable/duplicated reference
// from silently collapsing into a smaller set.
export function canonicalizeReferences(provider, references) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error("At least one immutable reference is required.");
  }
  const seen = new Set();
  const normalized = [];
  for (const reference of references) {
    const token = normalizeReference(provider, reference);
    if (seen.has(token)) {
      throw new Error(`Duplicate immutable reference: ${token}`);
    }
    seen.add(token);
    normalized.push(token);
  }
  normalized.sort();
  return normalized;
}

export function computeArtifactSetDigest(provider, references) {
  const canonical = canonicalizeReferences(provider, references);
  // Hash only the canonical sorted references so any recomputation from the
  // same references is byte-identical. JSON.stringify of an array of strings is
  // deterministic (no key ordering to worry about).
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// Build a full lane proof from provider references. `provider` is resolved from
// the checked-in matrix by default so callers cannot invent a proof shape.
export function collectLaneProof({ lane, references, matrix = loadLaneMatrix(), provider }) {
  const resolvedProvider = provider ?? providerForLane(lane, matrix);
  const canonical = canonicalizeReferences(resolvedProvider, references);
  const artifactSetDigest = computeArtifactSetDigest(resolvedProvider, canonical);
  return {
    lane,
    provider: resolvedProvider,
    references: canonical,
    artifactSetDigest,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    args[name] = value;
    i += 1;
  }
  return args;
}

function readReferences(args) {
  if (args.references != null) {
    const trimmed = args.references.trim();
    if (trimmed.startsWith("[")) {
      return JSON.parse(trimmed);
    }
    return trimmed.split(/[\s,]+/).filter(Boolean);
  }
  if (args["references-file"]) {
    const contents = fs.readFileSync(args["references-file"], "utf8").trim();
    if (contents.startsWith("[")) {
      return JSON.parse(contents);
    }
    return contents.split(/[\s,]+/).filter(Boolean);
  }
  throw new Error("Provide --references (JSON array or comma/space list) or --references-file.");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.lane) {
    throw new Error("--lane is required.");
  }
  const matrix = loadLaneMatrix(args.matrix || DEFAULT_MATRIX_PATH);
  const references = readReferences(args);
  const proof = collectLaneProof({ lane: args.lane, references, matrix });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
