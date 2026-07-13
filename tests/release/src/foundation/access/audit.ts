/**
 * Redacted access audit.
 *
 * A broader developer diagnostic than `world-capabilities.ts`'s local-shape
 * preflight: it actually exercises `gh auth status` and
 * `aws sts get-caller-identity` (live, local CLI auth checks), plus shape
 * checks for the E2B key, a Stripe `sk_test_` key, and the LiteLLM/gateway
 * endpoint vars. This is deliberately outside the frozen preflight
 * contract's "local availability and safe basic shape only" scope — it is
 * meant to be run by a developer (or CI setup step) BEFORE a release-e2e
 * invocation, to answer "is my machine even credentialed for this?" No
 * function here returns, logs, or throws a message containing a credential
 * value; only exit-code-derived booleans and named shape verdicts surface.
 */

import { spawnSync } from "node:child_process";

import { describeShape, matchesShape } from "./redaction.js";
import type { LocalEnvironment } from "./env-file.js";

export type AccessCheckStatus = "ok" | "missing" | "malformed" | "error";

export interface AccessCheckResult {
  readonly name: string;
  readonly status: AccessCheckStatus;
  /** Redacted detail — never a credential value. */
  readonly detail: string;
}

export interface AccessAuditReport {
  readonly results: readonly AccessCheckResult[];
  readonly missingNames: readonly string[];
  readonly ok: boolean;
}

export interface CommandResult {
  readonly ok: boolean;
  /** True when the binary itself could not be found/spawned. */
  readonly spawnError: boolean;
}

/** Injectable so tests never actually shell out to `gh`/`aws`. */
export type RunCommand = (command: string, args: readonly string[]) => CommandResult;

export const defaultRunCommand: RunCommand = (command, args) => {
  const result = spawnSync(command, [...args], { stdio: "ignore" });
  if (result.error) {
    return { ok: false, spawnError: true };
  }
  return { ok: result.status === 0, spawnError: false };
};

export interface AccessAuditOptions {
  readonly env: LocalEnvironment;
  readonly runCommand?: RunCommand;
}

function cliCheck(name: string, command: string, args: readonly string[], runCommand: RunCommand): AccessCheckResult {
  const result = runCommand(command, args);
  if (result.spawnError) {
    return { name, status: "error", detail: `"${command}" is not installed or not on PATH` };
  }
  return result.ok
    ? { name, status: "ok", detail: `\`${command} ${args.join(" ")}\` exited 0` }
    : { name, status: "missing", detail: `\`${command} ${args.join(" ")}\` did not report an authenticated session` };
}

function envShapeCheck(
  name: string,
  envVarName: string,
  shape: Parameters<typeof matchesShape>[0],
  env: LocalEnvironment,
): AccessCheckResult {
  const value = env.resolve(envVarName);
  if (value === undefined) {
    return { name, status: "missing", detail: `${envVarName}: ${describeShape(undefined)}` };
  }
  if (!matchesShape(shape, value)) {
    return { name, status: "malformed", detail: `${envVarName}: ${describeShape(value)}, expected shape "${shape}"` };
  }
  return { name, status: "ok", detail: `${envVarName}: ${describeShape(value)}, ${shape}: yes` };
}

/**
 * Runs the standing set of access checks: GitHub CLI auth, AWS CLI identity,
 * E2B key shape, Stripe test-mode key shape, and the LiteLLM/gateway
 * endpoint var shape. Every result is redacted; `report.ok` is false and
 * `report.missingNames` lists every check that did not pass, by name only.
 */
export function runAccessAudit(options: AccessAuditOptions): AccessAuditReport {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const { env } = options;

  const results: AccessCheckResult[] = [
    cliCheck("github", "gh", ["auth", "status"], runCommand),
    cliCheck("aws", "aws", ["sts", "get-caller-identity"], runCommand),
    envShapeCheck("e2b", "RELEASE_E2E_E2B_API_KEY", "e2b_key_prefix", env),
    envShapeCheck("stripe", "STRIPE_SECRET_KEY", "sk_test_prefix", env),
    envShapeCheck("litellm-gateway", "RELEASE_E2E_GATEWAY_BASE_URL", "public_https_url", env),
  ];

  const missingNames = results.filter((r) => r.status !== "ok").map((r) => r.name);
  return { results, missingNames, ok: missingNames.length === 0 };
}
