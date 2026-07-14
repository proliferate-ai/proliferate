/**
 * Helpers for the tier-4 AnyHarness binary self-update scenario (T4-CLOUD-1,
 * owned by specs/developing/testing/tier-4-scenario-contract.md; shipped
 * mechanics live in specs/codebase/structures/proliferate-worker/guides/lifecycle.md).
 * Two kinds of thing live here:
 *
 * - Pure logic the scenario asserts against (version parsing, binary
 *   convergence, the ECS task-definition mutation that bumps the
 *   advertised runtime pin). These are unit-tested in
 *   `anyharness-upgrade.test.ts` — no network, no AWS.
 * - Thin impure wrappers (`bumpStagingRuntimePin`, `restoreStagingRuntimePin`)
 *   that shell out to the AWS CLI. The mutation payload they send is built by
 *   the pure functions, so the risky "which fields change" logic is covered by
 *   unit tests and the wrappers only orchestrate.
 *
 * Why an ECS env change at all: the server advertises the runtime pin from
 * `RUNTIME_VERSION` (server/proliferate/server/version.py `runtime_version_pin`),
 * which is baked into the release image as a Docker ENV — there is no runtime
 * override API. The only way to move the *advertised* pin without cutting a new
 * release is to override `RUNTIME_VERSION` in the staging server task
 * definition's `environment` array (ECS env wins over the image ENV), which
 * forces one rolling task replacement. Acceptable for the Tier 4 staging
 * target; the scenario restores the original task definition in a `finally`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The runtime `/health` body, trimmed to what this scenario reads. */
export interface RuntimeHealth {
  status?: string;
  version?: string;
}

/**
 * The version the runtime reports for itself at `/health`. Empty string when
 * absent so callers compare against a concrete value rather than `undefined`.
 */
export function runtimeHealthVersion(health: RuntimeHealth): string {
  return (health.version ?? "").trim();
}

/**
 * The binary-track convergence predicate: the running AnyHarness version (what
 * `/health` reports) equals the version the server advertises in
 * `desiredVersions.anyharness`. An empty advertised pin is never converged; an
 * unstamped server pins nothing and the mechanism is a no-op, which is a
 * distinct state the scenario reports as blocked.
 */
export function anyharnessBinaryConverged(runningVersion: string, advertisedPin: string): boolean {
  const running = runningVersion.trim();
  const pin = advertisedPin.trim();
  return pin.length > 0 && running === pin;
}

/** A single container definition, as returned by `describe-task-definition`. */
interface EcsContainerDefinition {
  name: string;
  environment?: Array<{ name: string; value: string }>;
  [key: string]: unknown;
}

/** The subset of a task definition this module reads/writes. */
export interface EcsTaskDefinition {
  family: string;
  containerDefinitions: EcsContainerDefinition[];
  [key: string]: unknown;
}

/**
 * `register-task-definition` rejects the read-only fields
 * `describe-task-definition` echoes back. Strip them so a described definition
 * round-trips into a new revision. Pure — returns a new object, never mutates.
 */
export function registerableTaskDefinition(taskDef: EcsTaskDefinition): Record<string, unknown> {
  const READ_ONLY = new Set([
    "taskDefinitionArn",
    "revision",
    "status",
    "requiresAttributes",
    "compatibilities",
    "registeredAt",
    "registeredBy",
    "deregisteredAt",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(taskDef)) {
    if (!READ_ONLY.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Return a copy of `taskDef` with `RUNTIME_VERSION` set to `version` in the
 * named container's `environment`, overriding any existing entry (and thus the
 * image's baked-in `RUNTIME_VERSION` ENV, since ECS task env wins). Pure.
 */
export function withRuntimeVersionPin(
  taskDef: EcsTaskDefinition,
  containerName: string,
  version: string,
): EcsTaskDefinition {
  const containerDefinitions = taskDef.containerDefinitions.map((container) => {
    if (container.name !== containerName) {
      return container;
    }
    const environment = (container.environment ?? []).filter((entry) => entry.name !== "RUNTIME_VERSION");
    environment.push({ name: "RUNTIME_VERSION", value: version });
    return { ...container, environment };
  });
  return { ...taskDef, containerDefinitions };
}

/**
 * Read `RUNTIME_VERSION` out of a container's env (undefined when unset). The
 * advertised pin's source of truth, used to record the pre-bump baseline so the
 * scenario restores exactly what was there (including "unset").
 */
export function runtimeVersionPinOf(
  taskDef: EcsTaskDefinition,
  containerName: string,
): string | undefined {
  const container = taskDef.containerDefinitions.find((c) => c.name === containerName);
  return container?.environment?.find((entry) => entry.name === "RUNTIME_VERSION")?.value;
}

export interface StagingEcsTarget {
  cluster: string;
  service: string;
  container: string;
  region: string;
}

/** Guardrail: refuse to touch anything whose name looks like production. */
export function assertNotProduction(target: StagingEcsTarget): void {
  const haystack = `${target.cluster} ${target.service}`.toLowerCase();
  if (haystack.includes("prod")) {
    throw new Error(
      `anyharness-upgrade: refusing to mutate a production-looking ECS target (${target.cluster}/${target.service}). ` +
        "This scenario is staging-only.",
    );
  }
}

async function aws(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("aws", args, { maxBuffer: 32 * 1024 * 1024 });
  const text = stdout.trim();
  return text.length > 0 ? JSON.parse(text) : undefined;
}

/** The task definition ARN the service currently runs. */
export async function currentServiceTaskDefinition(target: StagingEcsTarget): Promise<string> {
  const described = (await aws([
    "ecs",
    "describe-services",
    "--cluster",
    target.cluster,
    "--services",
    target.service,
    "--region",
    target.region,
    "--query",
    "services[0].taskDefinition",
    "--output",
    "json",
  ])) as string;
  return described;
}

async function describeTaskDefinition(arn: string, region: string): Promise<EcsTaskDefinition> {
  const described = (await aws([
    "ecs",
    "describe-task-definition",
    "--task-definition",
    arn,
    "--region",
    region,
    "--query",
    "taskDefinition",
    "--output",
    "json",
  ])) as EcsTaskDefinition;
  return described;
}

export interface RuntimePinBumpResult {
  /** The task-def ARN the service ran before the bump (restore target). */
  previousTaskDefinitionArn: string;
  /** `RUNTIME_VERSION` before the bump, or undefined if it was unset. */
  previousPin: string | undefined;
  /** The new task-def ARN registered with the bumped pin. */
  newTaskDefinitionArn: string;
}

/**
 * Register a new revision of the staging server task definition with
 * `RUNTIME_VERSION=version` and point the service at it. Returns what is needed
 * to restore. Staging-only (guarded). This forces one rolling task replacement.
 */
export async function bumpStagingRuntimePin(
  target: StagingEcsTarget,
  version: string,
): Promise<RuntimePinBumpResult> {
  assertNotProduction(target);
  const previousTaskDefinitionArn = await currentServiceTaskDefinition(target);
  const current = await describeTaskDefinition(previousTaskDefinitionArn, target.region);
  const previousPin = runtimeVersionPinOf(current, target.container);

  const bumped = withRuntimeVersionPin(current, target.container, version);
  const registerInput = registerableTaskDefinition(bumped);
  const registered = (await aws([
    "ecs",
    "register-task-definition",
    "--region",
    target.region,
    "--cli-input-json",
    JSON.stringify(registerInput),
    "--query",
    "taskDefinition.taskDefinitionArn",
    "--output",
    "json",
  ])) as string;

  await aws([
    "ecs",
    "update-service",
    "--cluster",
    target.cluster,
    "--service",
    target.service,
    "--task-definition",
    registered,
    "--region",
    target.region,
    "--query",
    "service.taskDefinition",
    "--output",
    "json",
  ]);

  return { previousTaskDefinitionArn, previousPin, newTaskDefinitionArn: registered };
}

/** Point the service back at its pre-bump task definition. Best-effort. */
export async function restoreStagingRuntimePin(
  target: StagingEcsTarget,
  previousTaskDefinitionArn: string,
): Promise<void> {
  assertNotProduction(target);
  await aws([
    "ecs",
    "update-service",
    "--cluster",
    target.cluster,
    "--service",
    target.service,
    "--task-definition",
    previousTaskDefinitionArn,
    "--region",
    target.region,
    "--query",
    "service.taskDefinition",
    "--output",
    "json",
  ]);
}
