/**
 * Typed ready-world verification.
 *
 * A provisioner returns a handle only after observing real readiness, but the
 * runner independently refuses a handle that does not match the run/shard/world
 * identity it asked for, or whose readiness observations are incomplete (any
 * `ok === false`, or no observation at all). This prevents an adapter bug from
 * letting an unhealthy or cross-run world through.
 */

import type { RunIdentity, ShardIdentity, WorldId } from "../contracts/identity.js";
import type { ReadyWorldHandle } from "../contracts/world.js";
import { WorldReadinessError } from "../contracts/world.js";

export function verifyReadyHandle(
  handle: ReadyWorldHandle,
  run: RunIdentity,
  shard: ShardIdentity,
  expectedWorld: WorldId,
): void {
  const observations = handle.readiness ?? [];
  if (handle.world !== expectedWorld) {
    throw new WorldReadinessError(
      expectedWorld,
      `world identity mismatch: provisioner returned "${handle.world}" for expected "${expectedWorld}"`,
      observations,
    );
  }
  if (handle.run.runId !== run.runId) {
    throw new WorldReadinessError(
      expectedWorld,
      `run identity mismatch: handle carries runId "${handle.run.runId}", expected "${run.runId}"`,
      observations,
    );
  }
  if (handle.shard.shardId !== shard.shardId) {
    throw new WorldReadinessError(
      expectedWorld,
      `shard identity mismatch: handle carries shardId "${handle.shard.shardId}", expected "${shard.shardId}"`,
      observations,
    );
  }
  if (observations.length === 0) {
    throw new WorldReadinessError(expectedWorld, "ready handle carries no readiness observations", observations);
  }
  const failed = observations.filter((o) => !o.ok);
  if (failed.length > 0) {
    throw new WorldReadinessError(
      expectedWorld,
      `incomplete readiness: ${failed.map((o) => o.check).join(", ")}`,
      observations,
    );
  }
}
