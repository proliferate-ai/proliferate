import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";
import { DESKTOP_RENDERER_ARTIFACT_ID, SERVER_ARTIFACT_PREFIX } from "./local-candidate-set.js";

/**
 * Resolves the five exact managed-cloud build-map artifacts out of a validated
 * `CandidateBuildMapV1` (spec "Candidate artifacts", extends the PR 1 map per
 * the extension contract):
 *
 *   server/<docker-platform>                        — `docker save` archive, amd64
 *   anyharness/x86_64-unknown-linux-musl            — release binary, baked into the template
 *   worker/x86_64-unknown-linux-musl                — release binary, baked into the template
 *   supervisor/x86_64-unknown-linux-musl            — release binary, baked into the template
 *   credential-helper/x86_64-unknown-linux-musl     — release binary, baked into the template
 *   desktop-renderer/browser                        — Desktop dist archive (baked with the public candidate API origin)
 *
 * The `server/*` id carries a dynamic docker-platform segment (matched by its
 * stable prefix, like the local world); the four runtime binaries are pinned to
 * the exact musl Linux target, matching `.github/workflows/_deploy-e2b.yml` and
 * `Makefile cloud-runtime-build`. `desktop-renderer/browser` is the existing PR 1
 * id, reused per World-construction step 5 ("reuse the PR 1 renderer candidate
 * pattern targeted at the public candidate API origin") — the spec's
 * candidate-artifacts table omits it as carried-over-existing; this world
 * includes it as the sixth build-map slot (see the final report's disclosed
 * deviation). Exactly one artifact must match each slot — a missing, duplicate,
 * or extra required artifact is a `BuildMapError` raised before any world side
 * effect.
 *
 * The two COMPOSITE receipts named in the spec table — `e2b-template/<name>`
 * and `candidate-api/<subdomain>` — are NOT build-map entries (the map holds
 * only `local_file` build outputs). They are produced at world-construction
 * time by `worlds/managed-cloud/template.ts` and `worlds/managed-cloud/ingress.ts`
 * respectively, recorded in their own receipts, and folded into evidence
 * `artifact_ids`.
 *
 * This module does not copy bytes; materialization + re-hashing is done by the
 * world stack through `materialize-local.ts` (reused unchanged), which yields a
 * `MaterializedArtifact` per slot.
 */

export const CLOUD_LINUX_TARGET = "x86_64-unknown-linux-musl";
export const ANYHARNESS_CLOUD_ARTIFACT_ID = `anyharness/${CLOUD_LINUX_TARGET}`;
export const WORKER_CLOUD_ARTIFACT_ID = `worker/${CLOUD_LINUX_TARGET}`;
export const SUPERVISOR_CLOUD_ARTIFACT_ID = `supervisor/${CLOUD_LINUX_TARGET}`;
export const CREDENTIAL_HELPER_CLOUD_ARTIFACT_ID = `credential-helper/${CLOUD_LINUX_TARGET}`;

/** The six build-map entries the managed-cloud world consumes. */
export interface CloudCandidateSet {
  server: CandidateBuildArtifactV1;
  anyharness: CandidateBuildArtifactV1;
  worker: CandidateBuildArtifactV1;
  supervisor: CandidateBuildArtifactV1;
  credentialHelper: CandidateBuildArtifactV1;
  desktopRenderer: CandidateBuildArtifactV1;
}

/**
 * Selects the six required artifacts from a validated map. Throws
 * `BuildMapError` when any slot is unmatched, ambiguous, or when the map
 * carries extra artifacts this world does not expect.
 *
 * Mirrors `resolveLocalCandidateSet`: the `server/*` slot is matched by its
 * stable prefix (the docker-platform segment is dynamic); the four runtime
 * binaries and the renderer are matched by their exact pinned ids. Every check
 * runs before any world side effect.
 */
export function resolveCloudCandidateSet(map: CandidateBuildMapV1): CloudCandidateSet {
  const server = selectOne(map, "server", (id) => id.startsWith(SERVER_ARTIFACT_PREFIX));
  const anyharness = selectOne(map, "anyharness", (id) => id === ANYHARNESS_CLOUD_ARTIFACT_ID);
  const worker = selectOne(map, "worker", (id) => id === WORKER_CLOUD_ARTIFACT_ID);
  const supervisor = selectOne(map, "supervisor", (id) => id === SUPERVISOR_CLOUD_ARTIFACT_ID);
  const credentialHelper = selectOne(map, "credential helper", (id) => id === CREDENTIAL_HELPER_CLOUD_ARTIFACT_ID);
  const desktopRenderer = selectOne(map, "desktop renderer", (id) => id === DESKTOP_RENDERER_ARTIFACT_ID);

  // The six slots are disjoint by construction (the four musl ids and the
  // renderer id are exact and share no prefix with `server/`), so an artifact
  // this world does not expect is one that matched no slot. Reject it before any
  // world side effect.
  const expected = new Set([
    server.artifact_id,
    anyharness.artifact_id,
    worker.artifact_id,
    supervisor.artifact_id,
    credentialHelper.artifact_id,
    desktopRenderer.artifact_id,
  ]);
  const extras = map.artifacts.filter((artifact) => !expected.has(artifact.artifact_id));
  if (extras.length > 0) {
    throw new BuildMapError(
      `Candidate build map carries unexpected artifact(s) for the managed-cloud world: ` +
        `${extras.map((artifact) => artifact.artifact_id).join(", ")}.`,
    );
  }

  return { server, anyharness, worker, supervisor, credentialHelper, desktopRenderer };
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
