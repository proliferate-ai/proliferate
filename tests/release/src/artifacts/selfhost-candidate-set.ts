import { BuildMapError, type CandidateBuildArtifactV1, type CandidateBuildMapV1 } from "./build-map.js";

/**
 * Resolves the exact self-host-world artifacts out of a validated
 * `CandidateBuildMapV1` (frozen spec "Candidate artifacts"). All locators stay
 * `local_file` (decision 3 — no schema change); the bytes are transported to the
 * EC2 box over SSH/SCP and the running image digest is asserted on the box as a
 * receipt.
 *
 *   server/linux/<arch>          — `docker save` archive of the candidate image
 *   selfhost-bundle/<platform>   — proliferate-deploy.tar.gz (+ its SHA256SUMS)
 *   selfhost-runtime/<platform>  — optional release-shaped box runtime archive
 *   anyharness/<host-target>     — release AnyHarness (reused PR 1 build)
 *   desktop-renderer/browser     — apps/desktop dist archive (reused PR 1 build)
 *
 * The renderer is a reused PR 1 artifact the self-host builder also emits — the
 * world needs it for the isolated Desktop renderer (World-construction step 6),
 * even though the frozen candidate table lists only the three self-host-specific
 * rows (disclosed clarification; see BRIEF §"Builder workstream"). Exactly one
 * artifact must match each slot; a missing/duplicate/extra required artifact is
 * a `BuildMapError` raised before any world side effect.
 *
 * This module does not copy bytes; materialization + re-hashing is done by the
 * world stack (`materialize-local.ts`), yielding a `MaterializedArtifact` per
 * slot.
 */

export const SERVER_IMAGE_ARTIFACT_PREFIX = "server/";
export const SELFHOST_BUNDLE_ARTIFACT_PREFIX = "selfhost-bundle/";
export const SELFHOST_RUNTIME_ARTIFACT_PREFIX = "selfhost-runtime/";
export const ANYHARNESS_ARTIFACT_PREFIX = "anyharness/";
export const DESKTOP_RENDERER_ARTIFACT_ID = "desktop-renderer/browser";

/** The four build-map entries the self-host world consumes. */
export interface SelfHostCandidateSet {
  serverImage: CandidateBuildArtifactV1;
  bundle: CandidateBuildArtifactV1;
  runtimeBundle?: CandidateBuildArtifactV1;
  anyharness: CandidateBuildArtifactV1;
  desktopRenderer: CandidateBuildArtifactV1;
}

/**
 * Selects the four required artifacts from a validated map. Throws
 * `BuildMapError` when any slot is unmatched, ambiguous, or when the map carries
 * an artifact this world does not expect. `server/linux/*` is matched by the
 * `selfhost-bundle/` and `server/` prefixes being disjoint, so slot selection is
 * unambiguous.
 */
export function resolveSelfHostCandidateSet(map: CandidateBuildMapV1): SelfHostCandidateSet {
  const serverImage = selectOne(map, "server image", (id) => id.startsWith(SERVER_IMAGE_ARTIFACT_PREFIX));
  const bundle = selectOne(map, "self-host bundle", (id) => id.startsWith(SELFHOST_BUNDLE_ARTIFACT_PREFIX));
  const runtimeBundle = selectOptionalOne(map, "self-host runtime bundle", (id) =>
    id.startsWith(SELFHOST_RUNTIME_ARTIFACT_PREFIX),
  );
  const anyharness = selectOne(map, "anyharness", (id) => id.startsWith(ANYHARNESS_ARTIFACT_PREFIX));
  const desktopRenderer = selectOne(map, "desktop renderer", (id) => id === DESKTOP_RENDERER_ARTIFACT_ID);

  // The slots are disjoint by construction (`server/`, `selfhost-bundle/`,
  // `selfhost-runtime/`, and `anyharness/` are distinct prefixes; the renderer id shares none of
  // them), so an artifact this world does not expect is one that matched no
  // slot. Reject it before any world side effect.
  const expected = new Set([
    serverImage.artifact_id,
    bundle.artifact_id,
    ...(runtimeBundle ? [runtimeBundle.artifact_id] : []),
    anyharness.artifact_id,
    desktopRenderer.artifact_id,
  ]);
  const extras = map.artifacts.filter((artifact) => !expected.has(artifact.artifact_id));
  if (extras.length > 0) {
    throw new BuildMapError(
      `Candidate build map carries unexpected artifact(s) for the self-host world: ` +
        `${extras.map((artifact) => artifact.artifact_id).join(", ")}.`,
    );
  }

  return { serverImage, bundle, runtimeBundle, anyharness, desktopRenderer };
}

function selectOptionalOne(
  map: CandidateBuildMapV1,
  slot: string,
  matches: (artifactId: string) => boolean,
): CandidateBuildArtifactV1 | undefined {
  const found = map.artifacts.filter((artifact) => matches(artifact.artifact_id));
  if (found.length > 1) {
    throw new BuildMapError(
      `Candidate build map has ${found.length} ${slot} artifacts; at most one is allowed ` +
        `(${found.map((artifact) => artifact.artifact_id).join(", ")}).`,
    );
  }
  return found[0];
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
