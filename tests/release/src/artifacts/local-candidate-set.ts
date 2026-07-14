import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";

/**
 * Resolves the three exact local-world artifacts out of a validated
 * `CandidateBuildMapV1` (specs "Candidate artifacts"):
 *
 *   server/<docker-platform>        — `docker save` archive (Docker controller)
 *   anyharness/<rust-host-target>   — release executable (host process controller)
 *   desktop-renderer/browser        — `apps/desktop/dist` archive (renderer + Playwright)
 *
 * `server/*` and `anyharness/*` carry a dynamic platform/target segment, so
 * they are matched by their stable prefix; `desktop-renderer/browser` is the
 * exact stable id. Exactly one artifact must match each slot — a missing,
 * duplicate, or extra required artifact is a `BuildMapError` raised before any
 * world side effect (spec: "Missing, duplicate, wrong-SHA, wrong-source, or
 * wrong-kind required artifacts fail before world startup").
 *
 * This module does not copy bytes; materialization + re-hashing is done by the
 * world stack through `materialize-local.ts`, which yields a
 * `MaterializedArtifact` for each slot.
 */

export const SERVER_ARTIFACT_PREFIX = "server/";
export const ANYHARNESS_ARTIFACT_PREFIX = "anyharness/";
export const DESKTOP_RENDERER_ARTIFACT_ID = "desktop-renderer/browser";

/** The three build-map entries the local world consumes, one per controller. */
export interface LocalCandidateSet {
  server: CandidateBuildArtifactV1;
  anyharness: CandidateBuildArtifactV1;
  desktopRenderer: CandidateBuildArtifactV1;
}

/**
 * A build-map artifact after it has been copied into run-owned storage and
 * re-hashed. `path` is the absolute path of the run-owned copy; the identity
 * triple is the projection allowed into evidence.
 */
export interface MaterializedArtifact {
  artifact_id: string;
  version: string;
  sha256: string;
  /** Absolute path to the run-owned materialized copy. */
  path: string;
}

/**
 * Selects the three required artifacts from a validated map. Throws
 * `BuildMapError` when any slot is unmatched, ambiguous, or when the map
 * carries extra artifacts this slice does not expect.
 */
export function resolveLocalCandidateSet(map: CandidateBuildMapV1): LocalCandidateSet {
  const server = selectOne(map, "server", (id) => id.startsWith(SERVER_ARTIFACT_PREFIX));
  const anyharness = selectOne(map, "anyharness", (id) => id.startsWith(ANYHARNESS_ARTIFACT_PREFIX));
  const desktopRenderer = selectOne(map, "desktop renderer", (id) => id === DESKTOP_RENDERER_ARTIFACT_ID);

  // The three slots are disjoint by construction (the renderer id shares neither
  // prefix), so an artifact the slice does not expect is one that matched no
  // slot. Reject it before any world side effect.
  const expected = new Set([server.artifact_id, anyharness.artifact_id, desktopRenderer.artifact_id]);
  const extras = map.artifacts.filter((artifact) => !expected.has(artifact.artifact_id));
  if (extras.length > 0) {
    throw new BuildMapError(
      `Candidate build map carries unexpected artifact(s) for the local world: ` +
        `${extras.map((artifact) => artifact.artifact_id).join(", ")}.`,
    );
  }

  return { server, anyharness, desktopRenderer };
}

function selectOne(
  map: CandidateBuildMapV1,
  slot: string,
  matches: (artifactId: string) => boolean,
): CandidateBuildArtifactV1 {
  const found = map.artifacts.filter((artifact) => matches(artifact.artifact_id));
  if (found.length === 0) {
    throw new BuildMapError(`Candidate build map is missing the required ${slot} artifact.`);
  }
  if (found.length > 1) {
    throw new BuildMapError(
      `Candidate build map has ${found.length} ${slot} artifacts; exactly one is required ` +
        `(${found.map((artifact) => artifact.artifact_id).join(", ")}).`,
    );
  }
  return found[0];
}
