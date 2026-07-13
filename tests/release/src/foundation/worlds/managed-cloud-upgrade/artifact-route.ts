/**
 * Immutable candidate-N artifact route construction for the managed-cloud
 * upgrade world.
 *
 * Per the tier-4 contract the candidate API redirects the target updater to
 * run-scoped immutable artifacts, e.g.:
 *
 *   qualification/<run-id>/<candidate-sha>/linux-x86_64/anyharness
 *   qualification/<run-id>/<candidate-sha>/linux-x86_64/anyharness.sha256
 *
 * No test copies a binary into the sandbox: the product heartbeat + update
 * path must cause convergence. This module only computes/validates the route
 * prefix and per-component paths. A route may never fall back to a rolling
 * `stable` reference — a missing candidate artifact fails closed.
 */

import type { PlatformKey } from "../../contracts/artifacts.js";

export class ArtifactRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactRouteError";
  }
}

/** A single path segment must be path-safe (no traversal, no separators). */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(segment: string, label: string): void {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new ArtifactRouteError(
      `${label} "${segment}" is not path-safe; run-scoped artifact routes must contain only ` +
        `[A-Za-z0-9._-] to prevent traversal or ambiguous keys.`,
    );
  }
  if (segment === "latest" || segment === "stable") {
    throw new ArtifactRouteError(
      `${label} "${segment}" is a rolling reference; a candidate artifact route must be immutable.`,
    );
  }
}

/**
 * The run-scoped immutable route prefix for candidate-N artifacts:
 * `qualification/<runId>/<candidateSha>`. Both id segments are validated so an
 * injected value can never escape the run's key space.
 */
export function candidateArtifactRoutePrefix(runId: string, candidateSha: string): string {
  assertSafeSegment(runId, "runId");
  assertSafeSegment(candidateSha, "candidateSha");
  return `qualification/${runId}/${candidateSha}`;
}

/** The immutable route for one component binary under a validated prefix. */
export function componentArtifactRoute(
  prefix: string,
  platform: PlatformKey,
  component: "anyharness" | "worker" | "supervisor",
): { readonly binary: string; readonly checksum: string } {
  assertSafeSegment(platform, "platform");
  assertSafeSegment(component, "component");
  const base = `${prefix}/${platform}/${component}`;
  return { binary: base, checksum: `${base}.sha256` };
}
