import { ENV_MANIFEST, type EnvVarSpec } from "./env-manifest.js";

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
