import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

/**
 * The candidate build map (specs/developing/testing/candidate-build-handoff.md
 * "Candidate build map"): the JSON handoff between candidate builders, the
 * qualification runner, and later world provisioners. Candidate-only and
 * local_file-only in this slice; it contains build outputs, never provider
 * credentials or running endpoints.
 */
export interface CandidateBuildMapV1 {
  schema_version: 1;
  kind: "proliferate.candidate-build";
  /** Lowercase 40-hex merged/candidate SHA; must equal RunIdentityV1.source_sha. */
  source_sha: string;
  artifacts: CandidateBuildArtifactV1[];
}

export interface CandidateBuildArtifactV1 {
  /** Stable ID. This slice uses `anyharness/<rust-host-target>`. */
  artifact_id: string;
  version: string;
  /** Lowercase 64-hex digest of the file bytes. */
  sha256: string;
  locator: {
    kind: "local_file";
    path: string;
  };
}

/** The bounded artifact identity that is allowed into aggregate evidence. */
export interface CandidateBuildEvidenceV1 {
  artifacts: Array<{
    artifact_id: string;
    version: string;
    sha256: string;
  }>;
}

/**
 * Invalid invocation / artifact-integrity input: the runner exits 2, writes
 * no aggregate report, and performs zero setup side effects. The message
 * never embeds raw map JSON.
 */
export class BuildMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildMapError";
  }
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
// Slash-separated safe segments, e.g. `anyharness/aarch64-apple-darwin`.
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_ARTIFACT_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 128;
const MAX_PATH_LENGTH = 4096;

export async function sha256OfFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Loads and fully validates a candidate build map: strict schema, source-SHA
 * equality with the resolved run identity, unique safe artifact ids, bounded
 * fields, local_file locators only, readable regular files, and exact
 * SHA-256 byte equality. Every rejection is a BuildMapError.
 */
export async function loadCandidateBuildMap(
  mapPath: string,
  expectedSourceSha: string,
): Promise<CandidateBuildMapV1> {
  let raw: string;
  try {
    raw = await readFile(mapPath, "utf8");
  } catch (error) {
    throw new BuildMapError(
      `Candidate build map is not readable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BuildMapError("Candidate build map is not valid JSON.");
  }

  const map = validateCandidateBuildMapShape(parsed);

  if (map.source_sha !== expectedSourceSha) {
    throw new BuildMapError(
      `Candidate build map source_sha does not match this run's source SHA ` +
        `(map ${map.source_sha}, run ${expectedSourceSha}).`,
    );
  }

  for (const artifact of map.artifacts) {
    let stats;
    try {
      stats = await stat(artifact.locator.path);
    } catch {
      throw new BuildMapError(`Artifact "${artifact.artifact_id}" path is not readable.`);
    }
    if (!stats.isFile()) {
      throw new BuildMapError(`Artifact "${artifact.artifact_id}" path is not a regular file.`);
    }
    let actual: string;
    try {
      actual = await sha256OfFile(artifact.locator.path);
    } catch {
      throw new BuildMapError(`Artifact "${artifact.artifact_id}" bytes could not be read.`);
    }
    if (actual !== artifact.sha256) {
      throw new BuildMapError(
        `Artifact "${artifact.artifact_id}" bytes do not match the declared SHA-256 ` +
          `(declared ${artifact.sha256}, actual ${actual}).`,
      );
    }
  }

  return map;
}

/** Strict structural validation, independent of the filesystem. */
export function validateCandidateBuildMapShape(parsed: unknown): CandidateBuildMapV1 {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BuildMapError("Candidate build map must be a JSON object.");
  }
  const map = parsed as Record<string, unknown>;
  if (map.schema_version !== 1) {
    throw new BuildMapError(`Unsupported candidate build map schema_version.`);
  }
  if (map.kind !== "proliferate.candidate-build") {
    throw new BuildMapError(`Unsupported candidate build map kind.`);
  }
  if (typeof map.source_sha !== "string" || !FULL_SHA_PATTERN.test(map.source_sha)) {
    throw new BuildMapError("source_sha must be a lowercase 40-hex commit SHA.");
  }
  if (!Array.isArray(map.artifacts) || map.artifacts.length === 0) {
    throw new BuildMapError("artifacts must be a non-empty array.");
  }
  const seenIds = new Set<string>();
  const artifacts = map.artifacts.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new BuildMapError(`artifacts[${index}] must be an object.`);
    }
    const artifact = entry as Record<string, unknown>;
    const artifactId = artifact.artifact_id;
    if (
      typeof artifactId !== "string" ||
      artifactId.length === 0 ||
      artifactId.length > MAX_ARTIFACT_ID_LENGTH ||
      !ARTIFACT_ID_PATTERN.test(artifactId)
    ) {
      throw new BuildMapError(`artifacts[${index}].artifact_id is missing or unsafe.`);
    }
    if (seenIds.has(artifactId)) {
      throw new BuildMapError(`Duplicate artifact_id "${artifactId}".`);
    }
    seenIds.add(artifactId);
    if (
      typeof artifact.version !== "string" ||
      artifact.version.trim().length === 0 ||
      artifact.version.length > MAX_VERSION_LENGTH
    ) {
      throw new BuildMapError(`artifacts[${index}].version is missing or unbounded.`);
    }
    if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
      throw new BuildMapError(`artifacts[${index}].sha256 must be a lowercase 64-hex digest.`);
    }
    const locator = artifact.locator as Record<string, unknown> | undefined;
    if (typeof locator !== "object" || locator === null) {
      throw new BuildMapError(`artifacts[${index}].locator is missing.`);
    }
    if (locator.kind !== "local_file") {
      throw new BuildMapError(`artifacts[${index}].locator.kind is unsupported (local_file only).`);
    }
    if (
      typeof locator.path !== "string" ||
      locator.path.trim().length === 0 ||
      locator.path.length > MAX_PATH_LENGTH
    ) {
      throw new BuildMapError(`artifacts[${index}].locator.path is missing or unbounded.`);
    }
    return {
      artifact_id: artifactId,
      version: artifact.version,
      sha256: artifact.sha256,
      locator: { kind: "local_file" as const, path: locator.path },
    };
  });
  return {
    schema_version: 1,
    kind: "proliferate.candidate-build",
    source_sha: map.source_sha,
    artifacts,
  };
}

/**
 * The only projection of a build map allowed into aggregate evidence:
 * artifact ID, version, and SHA-256. Never paths, raw map JSON, credentials,
 * or provider output.
 */
export function toCandidateBuildEvidence(map: CandidateBuildMapV1): CandidateBuildEvidenceV1 {
  return {
    artifacts: map.artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      sha256: artifact.sha256,
    })),
  };
}
