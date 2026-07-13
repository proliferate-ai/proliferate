/**
 * Trusted secret preflight for the Tier 2 world's one real-network exception:
 * Stripe test mode (release-worlds-and-fixtures.md "Secret preflight";
 * core-release-validation.md's Tier 2 billing rows). Runs after cell
 * selection, before any world provisioning or provider spend. It never prints
 * the resolved key — only a sanitized `detail` string — and diagnostic vs.
 * strict handling of the result belongs to `contracts/evaluate.ts`, not here.
 *
 * Resolution order (ambient wins, matches tests/intent/stack/billing-global-
 * setup.ts's convention so both suites agree on where a Stripe test key comes
 * from):
 *   1. STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY / TIER2_BILLING_STRIPE_SECRET_KEY
 *      in the ambient process environment.
 *   2. STRIPE_SECRET_KEY in ~/.proliferate-local/dev/release-e2e.env, parsed as
 *      data (never sourced as shell).
 *   3. `stripe config --list`'s test_mode_api_key (the developer's local
 *      Stripe CLI login) — a convenience fallback, not a substitute for (1)/(2)
 *      in CI.
 */

import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { CapabilityRequirement, PreflightReport, RequirementResult, RequirementStatus } from "../../contracts/preflight.js";
import { parseEnvFileAsData } from "./support/env-file.js";

export interface StripeKeyResolution {
  readonly status: RequirementStatus;
  /** Sanitized — never the key value itself. */
  readonly detail: string;
  /** The resolved key, for the caller to hand to the boot process only; never logged. */
  readonly secretKey: string | null;
}

const AMBIENT_ENV_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY", "TIER2_BILLING_STRIPE_SECRET_KEY"] as const;

function classify(name: string, value: string): StripeKeyResolution {
  if (!value.startsWith("sk_test_")) {
    return { status: "malformed", detail: `${name} is set but does not start with sk_test_ (refusing a live-mode-shaped key)`, secretKey: null };
  }
  return { status: "satisfied", detail: `present (via ${name}, ${value.length} chars)`, secretKey: value };
}

export function defaultReleaseE2eEnvPath(): string {
  return path.join(os.homedir(), ".proliferate-local", "dev", "release-e2e.env");
}

/** Real resolution against the ambient environment, the local secret file, and
 * the Stripe CLI config. Pass an explicit `env`/`envFilePath` only from tests. */
export function resolveStripeTestSecretKey(
  env: NodeJS.ProcessEnv = process.env,
  envFilePath: string = defaultReleaseE2eEnvPath(),
): StripeKeyResolution {
  for (const name of AMBIENT_ENV_NAMES) {
    const value = env[name];
    if (value && value.trim().length > 0) {
      return classify(name, value.trim());
    }
  }

  const parsed = parseEnvFileAsData(envFilePath);
  if (parsed.STRIPE_SECRET_KEY) {
    return classify(`STRIPE_SECRET_KEY in ${envFilePath}`, parsed.STRIPE_SECRET_KEY);
  }

  const cli = spawnSync("stripe", ["config", "--list"], { encoding: "utf8", env });
  if (cli.status === 0) {
    const match = cli.stdout.match(/test_mode_api_key\s*=\s*'([^']+)'/);
    if (match) {
      return classify("`stripe config --list` test_mode_api_key", match[1]);
    }
  }

  return { status: "missing", detail: "no sk_test_ credential in env, release-e2e.env, or stripe CLI config", secretKey: null };
}

/**
 * Builds the `PreflightReport` for the Stripe-dependent Tier 2 cells given an
 * already-resolved `StripeKeyResolution`. Pure and injectable so unit tests
 * can assert the diagnostic/strict handling with a FAKE resolution instead of
 * exercising the real environment/CLI every time.
 */
export function buildTier2StripePreflight(
  stripeDependentCellKeys: readonly string[],
  resolution: StripeKeyResolution,
): PreflightReport {
  const requirement: CapabilityRequirement = {
    kind: "env-var",
    name: "STRIPE_SECRET_KEY",
    shape: "sk_test_prefix",
    requiredByCellKeys: stripeDependentCellKeys,
  };
  const result: RequirementResult = { requirement, status: resolution.status, detail: resolution.detail };
  const complete = resolution.status === "satisfied";
  return {
    results: [result],
    blockedCellKeys: complete ? [] : [...stripeDependentCellKeys],
    complete,
  };
}
