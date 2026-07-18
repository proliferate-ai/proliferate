import path from "node:path";

import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import {
  constructLocalWorld,
  type ConstructLocalWorldOptions,
  type LocalWorldPorts,
  type ReadyLocalWorld,
} from "../../worlds/local-workspace/world.js";
import { resolveWorldConstructionInputs, type QualificationLiteLlmConfigLike } from "../local-world-smoke-1.js";
import { evictClaimedOwner } from "../../fixtures/authenticated-actor.js";

/**
 * Shared local-functional world boot (BRIEF §"World lifecycle").
 *
 * Owner: builders-ci workstream.
 *
 * Every functional local scenario (LOCAL-1..7) boots its OWN `ReadyLocalWorld`
 * from the validated, path-bearing `ctx.candidateBuildMap` — the same three
 * candidate artifacts, run identity, run dir, and pre-allocated ports
 * `LOCAL-WORLD-SMOKE-1` uses. Per-scenario boot is the frozen decision
 * (correctness-first isolation); the honest cost is one server/postgres/redis/
 * anyharness/renderer/chromium stack per functional scenario per run (5 boots
 * for the full functional suite). A threaded shared-boot optimization is
 * deliberately deferred and MUST NOT be introduced without integrator sign-off,
 * because it would let one scenario's runtime state contaminate another.
 *
 * This helper is the single place the map/identity/dir/ports/litellm inputs are
 * resolved off the context (reusing `resolveWorldConstructionInputs` from the
 * smoke) so no functional collector re-derives them. When any input is absent
 * (a diagnostic invocation with no candidate map), it returns a typed failure
 * the collector maps to a clean `blocked`/`failed` cell — never a throw out of
 * `runCells` that would lose sibling results.
 *
 * ── Two frozen correctness invariants this seam owns (fix round 1) ────────────
 *
 * 1. WORLD-PER-SCENARIO, SERIALIZED. Every functional scenario boots exactly
 *    ONE `ReadyLocalWorld` shared by all its cells, and scenario-level world
 *    boots are serialized through the module-level `worldBootMutex` below: the
 *    mutex is acquired before construction and released only when the world's
 *    `close()` resolves, so two worlds never run concurrently on the laptop.
 *
 * 2. PORTS ARE REUSED FROM THE SIDECAR, NOT RE-ALLOCATED. Each world reuses the
 *    single `local-world-ports.json` sidecar's ports (threaded verbatim as
 *    `inputs.ports`) rather than allocating fresh ephemeral ports per boot. This
 *    is REQUIRED, not an optimization: the candidate renderer dist is built with
 *    `VITE_PROLIFERATE_API_BASE_URL` baked to the sidecar's API port, so a world
 *    serving that exact dist must bring the Server up on the sidecar's API port
 *    (and the renderer on the sidecar's renderer port) or the browser's baked
 *    API origin will not resolve. Serialization (invariant 1) is what makes
 *    reusing one fixed port set safe — only one world binds them at a time.
 */

export interface LocalFunctionalWorldInputs {
  map: CandidateBuildMapV1;
  litellm: QualificationLiteLlmConfigLike;
  run: RunIdentityV1;
  runDir: string;
  ports: LocalWorldPorts;
}

export type LocalFunctionalWorldResolution =
  | { ok: true; value: LocalFunctionalWorldInputs }
  | { ok: false; reason: string };

/**
 * Resolves the world-construction inputs off the run context, delegating to the
 * smoke's `resolveWorldConstructionInputs` so the required-env / map / identity
 * / ports checks stay single-sourced. Returns a typed failure (never throws) so
 * the caller can finalize a clean non-green cell.
 */
export function resolveLocalFunctionalWorldInputs(
  ctx: ScenarioRunContext,
): LocalFunctionalWorldResolution {
  // Single-source the required-env / map / identity / dir / ports checks against
  // the smoke's resolver so every functional scenario derives world inputs
  // identically. The smoke's value shape (`{ map, litellm, run, runDir, ports }`)
  // is exactly `LocalFunctionalWorldInputs`, and its failure branch is the same
  // typed `{ ok: false; reason }` a collector maps to a clean non-green cell.
  return resolveWorldConstructionInputs(ctx);
}

/**
 * A minimal FIFO async mutex: `acquire()` resolves with a single-use `release`
 * once every earlier acquirer has released. Used to serialize world boots so no
 * two `ReadyLocalWorld`s are ever live at once (invariant 1 above). Exported for
 * offline unit tests.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    const previous = this.tail;
    let releaseNext!: () => void;
    this.tail = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    // The caller waits for the previous holder to release, then receives its own
    // one-shot release (idempotence is the caller's concern; we hand back the
    // resolver directly).
    return previous.then(() => releaseNext);
  }
}

/**
 * The single process-wide gate every functional world boot passes through. It is
 * held from just before construction until the world's `close()` resolves, so
 * serialized scenarios never bind the shared sidecar ports (or a Docker
 * project/network) concurrently.
 */
const worldBootMutex = new AsyncMutex();

/**
 * Slugifies a scenario id into a filesystem-safe world subdir name
 * (`T3-AUTHROUTE-1` → `t3-authroute-1`). Exported for offline unit tests.
 */
export function worldDirSlug(worldId: string): string {
  const slug = worldId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "world";
}

/** Injectable constructor seam (defaults to the real world) so the mutex/
 * world-root wiring is unit-testable without booting a container/browser. */
export type ConstructLocalWorldFn = (options: ConstructLocalWorldOptions) => Promise<ReadyLocalWorld>;

/**
 * Boots one `ReadyLocalWorld` for a functional local scenario from resolved
 * inputs, via `constructLocalWorld`, under the world-boot mutex. `worldId` (the
 * scenario id) scopes the world's mutable subdir to
 * `<runDir>/worlds/<slug>` so its teardown never deletes the shared
 * `<runDir>/artifacts` source or a sibling scenario's world. The mutex is held
 * until the returned world's `close()` resolves. The caller owns `world.close()`
 * in a `finally` exactly once, and folds the returned cleanup evidence into each
 * green cell's kind-scoped evidence.
 */
export async function bootLocalFunctionalWorld(
  inputs: LocalFunctionalWorldInputs,
  worldId: string,
  construct: ConstructLocalWorldFn = constructLocalWorld,
): Promise<ReadyLocalWorld> {
  const release = await worldBootMutex.acquire();
  const worldRoot = path.join(inputs.runDir, "worlds", worldDirSlug(worldId));
  let world: ReadyLocalWorld;
  try {
    // Identical world construction to `LOCAL-WORLD-SMOKE-1`'s `buildWorld`
    // default (the exact candidate three-artifact bytes, resolved LiteLLM
    // access, run identity, and the SIDECAR ports — see invariant 2), plus a
    // per-scenario `worldRoot` so world-per-scenario teardown is isolated. The
    // shared `<runDir>/artifacts` source stays read-only.
    world = await construct({
      run: inputs.run,
      map: inputs.map,
      litellm: inputs.litellm,
      runDir: inputs.runDir,
      worldRoot,
      ports: inputs.ports,
    });
  } catch (error) {
    // Construction failed: release the gate immediately so the next serialized
    // scenario can boot, then surface the failure to the collector.
    release();
    throw error;
  }

  // Hold the mutex until this world is fully torn down. Wrap `close()` so the
  // release happens exactly once, whether close resolves or throws. Also
  // evict the claim-once cache entry for this world's run dir on every
  // teardown path: a scenario may boot a SECOND, freshly-constructed world
  // against this exact same `worldRoot` (e.g. T3-AUTHROUTE-1's batch
  // collector followed by its route=change collector), and without eviction
  // that next world would inherit this world's now-stale owner credentials
  // from `authenticatedActor`'s per-world claim cache and 401 on login.
  const realClose = world.close.bind(world);
  let released = false;
  const releaseOnce = (): void => {
    if (!released) {
      released = true;
      evictClaimedOwner(worldRoot);
      release();
    }
  };
  return {
    ...world,
    close: async () => {
      try {
        return await realClose();
      } finally {
        releaseOnce();
      }
    },
  };
}

/**
 * True when this run supplied the candidate world (functional entrypoint). The
 * functional scenarios branch their local lane on this: present → world-driven
 * functional journey; absent → legacy diagnostic path (T3-CHAT-1/T3-CFG-1/
 * T3-INT-1) or a clean `blocked` (T3-AUTHROUTE-1/T3-SESSION-1, which have no
 * legacy path). See BRIEF §"Cell registration → legacy coexistence".
 */
export function isWorldBackedRun(ctx: ScenarioRunContext): boolean {
  return ctx.candidateBuildMap !== null && ctx.runIdentity !== null && ctx.runDir !== null && ctx.ports !== null;
}
