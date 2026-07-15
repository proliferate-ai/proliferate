import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { BuildMapError, sha256OfFile, type CandidateBuildArtifactV1 } from "./build-map.js";

/**
 * Copies a validated local_file artifact's exact bytes into run-owned storage
 * and re-verifies the SHA-256 of the copy, so the launched bytes are provably
 * the mapped bytes even if the source path changes after validation.
 */
export async function materializeLocalArtifact(
  artifact: CandidateBuildArtifactV1,
  runStorageDir: string,
): Promise<string> {
  // encodeURIComponent is injective on the artifact-id charset
  // ([A-Za-z0-9._-] plus "/", which encodes to %2F), so two distinct valid
  // ids can never materialize onto the same file — a plain "/"→"_" mangling
  // would collide (e.g. `a/b_c` vs `a_b/c`).
  const destination = path.join(runStorageDir, encodeURIComponent(artifact.artifact_id));
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(artifact.locator.path, destination);
  } catch (error) {
    throw new BuildMapError(
      `Could not materialize artifact "${artifact.artifact_id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const copiedSha = await sha256OfFile(destination);
  if (copiedSha !== artifact.sha256) {
    throw new BuildMapError(
      `Materialized bytes for "${artifact.artifact_id}" do not match the declared SHA-256 ` +
        `(declared ${artifact.sha256}, copied ${copiedSha}).`,
    );
  }
  // The copy must be executable for launch consumers; copyFile preserves
  // content but the destination inherits the source mode only on some
  // platforms, so set it explicitly.
  await chmod(destination, 0o755);
  return destination;
}
