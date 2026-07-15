import type { ScenarioRunContext } from "../types.js";
import type { CandidateBuildMapV1 } from "../../artifacts/build-map.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import { constructLocalWorld, type LocalWorldPorts, type ReadyLocalWorld } from "../../worlds/local-workspace/world.js";
import { resolveWorldConstructionInputs, type QualificationLiteLlmConfigLike } from "../local-world-smoke-1.js";

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
 * Boots one `ReadyLocalWorld` for a functional local scenario from resolved
 * inputs, via `constructLocalWorld`. The caller owns `world.close()` in a
 * `finally` exactly once, and folds the returned cleanup evidence into each
 * green cell's kind-scoped evidence.
 */
export function bootLocalFunctionalWorld(inputs: LocalFunctionalWorldInputs): Promise<ReadyLocalWorld> {
  // Identical world construction to `LOCAL-WORLD-SMOKE-1`'s `buildWorld` default:
  // the exact candidate three-artifact bytes, resolved LiteLLM access, run
  // identity, run/shard dir, and pre-allocated ports. Reuse — never fork — the
  // merged world code so a functional scenario's world is byte-identical to the
  // proven smoke world.
  return constructLocalWorld({
    run: inputs.run,
    map: inputs.map,
    litellm: inputs.litellm,
    runDir: inputs.runDir,
    ports: inputs.ports,
  });
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
