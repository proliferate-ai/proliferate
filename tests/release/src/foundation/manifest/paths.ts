/**
 * Canonical on-disk location of the core-release scenario manifest.
 *
 * Centralized so every entrypoint (runner CLI, aggregate CLI, manifest audit)
 * resolves the SAME file — the whole point of this workstream is that the
 * runner always loads the real manifest rather than trusting arbitrary --cells.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/release/src/foundation/manifest/paths.ts -> repo root is five levels up:
// manifest -> foundation -> src -> release -> tests -> <repo root>.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

export const SCENARIO_MANIFEST_RELATIVE_PATH =
  "specs/developing/testing/core-release-scenario-manifest.json";

export function defaultScenarioManifestPath(): string {
  return path.join(REPO_ROOT, SCENARIO_MANIFEST_RELATIVE_PATH);
}
