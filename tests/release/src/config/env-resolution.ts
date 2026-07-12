import { ENV_MANIFEST, findEnvVarSpec, type EnvVarSpec } from "./env-manifest.js";
import type { RuntimeLane, TargetLane } from "./types.js";

export interface ResolvedEnvVar {
  spec: EnvVarSpec;
  value: string | undefined;
  present: boolean;
}

export interface EnvResolution {
  /** Every declared var this call cared about, resolved or not. */
  all: ResolvedEnvVar[];
  /** Subset that is missing (unset or empty string). */
  missing: ResolvedEnvVar[];
  present(name: string): boolean;
  get(name: string): string | undefined;
  /** Throws if `value` is undefined; use after `assertResolved` has run. */
  require(name: string): string;
}

/**
 * Resolves every var in `names` (default: the full manifest) against
 * `source` (default: process.env). Never throws by itself — callers decide
 * whether missing vars are fatal via `assertResolved`, so `--dry-run` can
 * report gaps without failing the run.
 */
export function resolveEnv(
  names: readonly string[] = ENV_MANIFEST.map((spec) => spec.name),
  source: NodeJS.ProcessEnv = process.env,
): EnvResolution {
  const specsByName = new Map(ENV_MANIFEST.map((spec) => [spec.name, spec]));
  const all: ResolvedEnvVar[] = names.map((name) => {
    const spec = specsByName.get(name);
    if (!spec) {
      throw new Error(
        `resolveEnv: "${name}" is not declared in the env manifest (src/config/env-manifest.ts). ` +
          "Add it there before referencing it from a scenario.",
      );
    }
    const raw = source[name];
    const value = raw && raw.trim().length > 0 ? raw : undefined;
    return { spec, value, present: value !== undefined };
  });
  const missing = all.filter((entry) => !entry.present);
  const byName = new Map(all.map((entry) => [entry.spec.name, entry]));

  return {
    all,
    missing,
    present: (name) => byName.get(name)?.present ?? false,
    get: (name) => byName.get(name)?.value,
    require: (name) => {
      const entry = byName.get(name);
      if (!entry?.present || entry.value === undefined) {
        throw new MissingEnvVarsError([entry ?? { spec: mustFindSpec(name), value: undefined, present: false }]);
      }
      return entry.value;
    },
  };
}

function mustFindSpec(name: string): EnvVarSpec {
  const spec = ENV_MANIFEST.find((candidate) => candidate.name === name);
  if (!spec) {
    throw new Error(`"${name}" is not declared in the env manifest.`);
  }
  return spec;
}

/**
 * Named-variable error listing every missing var and where to get it.
 * Thrown by `assertResolved` outside --dry-run, and by `EnvResolution.require`
 * when a scenario reaches into a var it needs but was never granted.
 */
export class MissingEnvVarsError extends Error {
  readonly missing: ResolvedEnvVar[];

  constructor(missing: ResolvedEnvVar[]) {
    const lines = missing.map(
      (entry) => `  - ${entry.spec.name}: ${entry.spec.description} (${entry.spec.whereItLives})`,
    );
    super(
      `Missing ${missing.length} required environment variable(s):\n${lines.join("\n")}\n` +
        "Set these before running without --dry-run. See specs/developing/reference/env-vars.yaml " +
        "and the PR description for tests/release for the full manifest.",
    );
    this.name = "MissingEnvVarsError";
    this.missing = missing;
  }
}

/**
 * Utility that throws a named-variable error when any resolved var is missing
 * (a no-op under `dryRun`). Retained for callers that genuinely cannot proceed
 * without a var; the runner itself (`src/cli/run.ts`) no longer uses it as a
 * global gate — a missing credential blocks only the dependent scenarios/lanes
 * (#1069) rather than failing the whole run.
 */
export function assertResolved(resolution: EnvResolution, options: { dryRun: boolean }): void {
  if (resolution.missing.length === 0) {
    return;
  }
  if (options.dryRun) {
    return;
  }
  throw new MissingEnvVarsError(resolution.missing);
}

/**
 * The subset of `requiredEnv` that is not satisfied for a scenario running on
 * `runtimeLane` (#1069). A var is unsatisfied when it is absent, OR when it was
 * supplied only by this run's local durable-user seeding but the lane is not
 * `local`: a per-run seeded fresh user cannot stand in for the sandbox lane's
 * needs (the durable staging identity's warm, persistent sandbox plus E2B + a
 * publicly reachable server URL), so sandbox-lane durable-dependent scenarios
 * stay blocked even after the local seed runs. Callers report the result as a
 * blocked run, the same convention as an out-of-band gate.
 */
export function missingRequiredForLane(
  requiredEnv: readonly string[],
  runtimeLane: RuntimeLane,
  resolution: EnvResolution,
  locallySeeded: ReadonlySet<string>,
): string[] {
  return requiredEnv.filter((name) => {
    if (!resolution.present(name)) {
      return true;
    }
    const requiredValue = findEnvVarSpec(name)?.requiredValue;
    if (requiredValue !== undefined && resolution.get(name) !== requiredValue) {
      return true;
    }
    return runtimeLane !== "local" && locallySeeded.has(name);
  });
}

/**
 * Env vars the durable identity needs only on the LOCAL target lane. On
 * `--lane staging` the durable user (proliferate-e2e-bot) is GitHub-OAuth-only
 * and has no password, so it authenticates through the rotating product
 * session (tests/release/src/fixtures/staging-session.ts) instead of
 * email+password. These names are therefore dropped from a scenario's
 * `requiredEnv` on the staging target — the staging session's own availability
 * is checked separately (it can come from the rotating state file, not just an
 * env var, so it cannot be expressed as a plain required env var).
 */
const DURABLE_PASSWORD_ENV: ReadonlySet<string> = new Set([
  "RELEASE_E2E_DURABLE_USER_EMAIL",
  "RELEASE_E2E_DURABLE_USER_PASSWORD",
]);

/**
 * True when a scenario depends on the durable identity (it lists the durable
 * user's email in `requiredEnv`). Used to decide whether the staging target
 * must also have a live staging session (checked via
 * `stagingSessionAvailable`) before the scenario can run for real.
 */
export function scenarioUsesDurableIdentity(requiredEnv: readonly string[]): boolean {
  return requiredEnv.includes("RELEASE_E2E_DURABLE_USER_EMAIL");
}

/**
 * The `requiredEnv` a scenario actually needs for a given TARGET lane. On the
 * staging target the durable user's email/password are dropped (see
 * `DURABLE_PASSWORD_ENV`); everything else — including the local-only vars a
 * scenario genuinely cannot run without on staging (e.g.
 * RELEASE_E2E_LOCAL_DATABASE_URL, which billing_probe.py reads from a profile
 * DB that staging does not expose) — is kept, so those scenarios still report
 * blocked with an accurate reason rather than silently attempting to run.
 */
export function requiredEnvForTargetLane(
  requiredEnv: readonly string[],
  targetLane: TargetLane,
): string[] {
  if (targetLane !== "staging") {
    return [...requiredEnv];
  }
  return requiredEnv.filter((name) => !DURABLE_PASSWORD_ENV.has(name));
}

/** Human-readable blocked reason naming each unsatisfied var and where it lives. */
export function blockedReasonForMissingEnv(
  scenarioId: string,
  runtimeLane: RuntimeLane,
  missing: readonly string[],
  locallySeeded: ReadonlySet<string>,
): string {
  const lines = missing.map((name) => {
    const spec = findEnvVarSpec(name);
    const seededNote = locallySeeded.has(name)
      ? " [set for this run by local durable-user seeding, which does not satisfy the sandbox lane]"
      : "";
    const exactValueNote = spec?.requiredValue ? ` [must equal ${JSON.stringify(spec.requiredValue)}]` : "";
    const suffix = spec ? ` — ${spec.description} (${spec.whereItLives})` : "";
    return `      - ${name}${seededNote}${exactValueNote}${suffix}`;
  });
  return `${scenarioId}/${runtimeLane}: blocked on unsatisfied environment requirement(s) — set the following to run it for real:\n${lines.join("\n")}`;
}
