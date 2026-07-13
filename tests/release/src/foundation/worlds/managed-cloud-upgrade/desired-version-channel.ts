/**
 * Run/target-scoped desired-version channel for the managed-cloud upgrade
 * world.
 *
 * The upgrade transition flips ONLY this run's target from N-1 to exact N. It
 * must NEVER mutate a global/staging image-env pin (the shared-staging mutation
 * the release-testing contract forbids). The server side of this channel is the
 * `cloud_sandbox_desired_version` table + the heartbeat resolver
 * (server/proliferate/server/cloud/runtime_workers/service.py::_resolve_desired_versions),
 * which overlays a per-sandbox override on top of the global pin per component.
 *
 * NAMED PRODUCT GAP: the server can RESOLVE a target-scoped override on the
 * heartbeat, and the store exposes set/clear, but there is no authorized HTTP
 * route to SET/CLEAR a sandbox's desired version yet. This client targets the
 * intended route so the shape is exercised and the gap is explicit; until that
 * route ships, `set`/`clear` fail closed (they never silently succeed, and they
 * never fall back to mutating the global pin).
 */

import { ApiClient, ApiRequestError } from "../../../fixtures/http.js";

/** Deterministic channel id: scoped to the run and the single target sandbox. */
export function desiredVersionChannelId(runId: string, cloudSandboxId: string): string {
  return `dvchan:${runId}:${cloudSandboxId}`;
}

export interface DesiredVersionRecord {
  readonly anyharness: string | null;
  readonly worker: string | null;
}

/**
 * The write side of the target-scoped desired-version channel. Every method is
 * scoped to one sandbox (the collapsed 1:1 target identity) — there is no
 * fleet-wide or global mutation surface here by construction.
 */
export interface TargetScopedDesiredVersionChannel {
  readonly channelId: string;
  readonly cloudSandboxId: string;
  /** Read the current per-target override (null components defer to the global pin). */
  current(): Promise<DesiredVersionRecord | null>;
  /** Flip only this target's desired AnyHarness version to exact `version`. */
  setAnyharnessVersion(version: string): Promise<void>;
  /** Remove the override so the target defers back to the global pin. */
  clear(): Promise<void>;
}

/** Sanitized reason a channel write could not happen (for readiness/evidence). */
export class DesiredVersionChannelUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesiredVersionChannelUnavailable";
  }
}

/**
 * The intended authorized route for per-sandbox desired-version writes. Kept in
 * one place so the provisioner can probe it for readiness and the gap has a
 * single canonical location.
 */
export function desiredVersionRoute(cloudSandboxId: string): string {
  return `/v1/cloud/runtime-workers/sandboxes/${cloudSandboxId}/desired-versions`;
}

export class HttpDesiredVersionChannel implements TargetScopedDesiredVersionChannel {
  readonly channelId: string;
  readonly cloudSandboxId: string;
  private readonly client: ApiClient;

  constructor(client: ApiClient, runId: string, cloudSandboxId: string) {
    this.client = client;
    this.cloudSandboxId = cloudSandboxId;
    this.channelId = desiredVersionChannelId(runId, cloudSandboxId);
  }

  async current(): Promise<DesiredVersionRecord | null> {
    try {
      return await this.client.get<DesiredVersionRecord | null>(
        desiredVersionRoute(this.cloudSandboxId),
      );
    } catch (error) {
      throw this.translate(error, "read");
    }
  }

  async setAnyharnessVersion(version: string): Promise<void> {
    if (!version || version.trim().length === 0) {
      throw new DesiredVersionChannelUnavailable("refusing to set an empty desired AnyHarness version");
    }
    try {
      await this.client.put<DesiredVersionRecord>(desiredVersionRoute(this.cloudSandboxId), {
        anyharness: version,
      });
    } catch (error) {
      throw this.translate(error, "set");
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.delete<unknown>(desiredVersionRoute(this.cloudSandboxId));
    } catch (error) {
      throw this.translate(error, "clear");
    }
  }

  private translate(error: unknown, op: string): Error {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 405)) {
      return new DesiredVersionChannelUnavailable(
        `${op} desired-version failed: the authorized per-sandbox desired-version route ` +
          `(${desiredVersionRoute(this.cloudSandboxId)}) returned ${error.status}. The server store + ` +
          `heartbeat resolver exist, but the write route does not ship yet — named product gap. This ` +
          `channel refuses to fall back to mutating the global pin.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
