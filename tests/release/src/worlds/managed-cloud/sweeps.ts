import { lstat } from "node:fs/promises";

import {
  listProviderSandboxesByTemplate,
  listProviderTemplateIds,
  type E2BTemplateSweepResult,
} from "../../fixtures/e2b-verify.js";

/**
 * Post-close provider sweeps for MANAGED-CLOUD-FIXTURE-SMOKE-1's cleanup-replay
 * cell (spec Cell E step 6). AFTER `world.close()` has released every ledger
 * entry, the cell independently sweeps each provider for resources positively
 * attributed to this run (by RunId/ShardId tag or run-scoped name) and asserts
 * ZERO remain. ANY remaining or ambiguous classification fails the cell.
 *
 * The AWS sweep shells `aws` via `execFile` (no shell word-split) with ambient
 * credentials, mirroring `ec2.ts`'s `defaultAwsExec` exactly — never argv
 * secrets, never touching `proliferate-prod*`. Every function is behind an
 * injectable exec seam so unit tests parse fake CLI JSON offline with no real
 * AWS call.
 *
 * Each sweep returns `{ provider, remaining_owned_resources }` — the exact
 * `provider_sweeps` evidence shape. A non-terminated instance, a surviving SG /
 * key pair / DNS record, or an unparseable CLI response all count as remaining
 * (fail-closed): the cell must be able to conclusively classify zero.
 */

export type SweepExec = (
  file: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultSweepExec: SweepExec = async (file, args, options) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout, stderr } = await run(file, [...args], {
    timeout: options?.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

export interface AwsSweepInputs {
  region: string;
  hostedZoneId: string;
  /** The run subdomain FQDN (record name to check for absence in Route53). */
  recordName: string;
  runId: string;
  shardId: string;
  /** Key-pair name prefix the world uses (`mcq-<runId>-<shardId>`). */
  keyNamePrefix: string;
}

/** Instance states that count as swept (not owned/live). */
const TERMINAL_INSTANCE_STATES = new Set(["terminated", "shutting-down"]);

/**
 * Counts AWS resources still owned by this run: non-terminal EC2 instances,
 * security groups, key pairs, and the run's Route53 A record. Returns the total
 * remaining across all four categories (0 = fully swept). A CLI failure counts
 * as ambiguous → fail-closed (returns a positive count with the reason in the
 * thrown-free path is not possible, so we surface via `AwsSweepResult.errors`).
 */
export interface AwsSweepResult {
  remaining: number;
  /** Per-category breakdown for diagnostics (never evidence — the count is). */
  detail: { instances: number; securityGroups: number; keyPairs: number; dnsRecords: number };
  /** Bounded reasons a category could not be conclusively classified (fail-closed). */
  errors: string[];
}

export type E2bTemplateProbe = (templateId: string) => Promise<E2BTemplateSweepResult>;
export type E2bTemplateInventoryProbe = () => Promise<string[]>;

/**
 * Counts every running/paused E2B sandbox observed on the exact immutable
 * run-owned template. The provider probe drains all pages. Any malformed or
 * mismatched response throws, so ambiguity cannot become zero.
 */
export async function sweepE2bForTemplate(
  templateId: string,
  probe: E2bTemplateProbe = listProviderSandboxesByTemplate,
  inventory: E2bTemplateInventoryProbe = listProviderTemplateIds,
): Promise<{ remaining: number }> {
  const [result, templateIds] = await Promise.all([probe(templateId), inventory()]);
  if (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.matches)) {
    throw new Error("E2B template sweep returned a malformed count/matches payload.");
  }
  if (result.count !== result.matches.length) {
    throw new Error("E2B template sweep count does not match its exhaustive match list.");
  }
  for (const match of result.matches) {
    if (
      !match.providerSandboxId ||
      match.templateId !== templateId ||
      (match.state !== "running" && match.state !== "paused")
    ) {
      throw new Error("E2B template sweep returned an ambiguously attributed sandbox.");
    }
  }
  if (!Array.isArray(templateIds) || templateIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("E2B template inventory returned a malformed id list.");
  }
  const exactTemplateMatches = templateIds.filter((id) => id === templateId).length;
  if (exactTemplateMatches > 1) {
    throw new Error("E2B template inventory returned the same immutable template id more than once.");
  }
  return { remaining: result.count + exactTemplateMatches };
}

/**
 * Directly probes run-owned filesystem paths after cleanup. Only ENOENT is
 * absent; a present path counts as remaining and every other lstat error is
 * ambiguous/non-green.
 */
export async function sweepFilesystemPaths(paths: readonly string[]): Promise<{ remaining: number }> {
  let remaining = 0;
  for (const ownedPath of paths) {
    try {
      await lstat(ownedPath);
      remaining += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`filesystem sweep could not classify ${ownedPath}: ${boundedError(error)}`);
      }
    }
  }
  return { remaining };
}

/**
 * The relay is hosted only on the run-owned ingress instance. A real AWS sweep
 * proving zero non-terminal ingress instances is therefore an independent
 * provider proof that no relay process can still execute.
 */
export function sweepProcessHostFromAws(result: AwsSweepResult): { remaining: number } {
  if (result.errors.length > 0) {
    throw new Error(`process-host sweep is ambiguous because AWS sweep failed: ${result.errors.join("; ")}`);
  }
  return { remaining: result.detail.instances > 0 ? 1 : 0 };
}

export async function sweepAwsForRun(
  inputs: AwsSweepInputs,
  exec: SweepExec = defaultSweepExec,
): Promise<AwsSweepResult> {
  const errors: string[] = [];
  const tagFilters = [
    "--filters",
    `Name=tag:RunId,Values=${inputs.runId}`,
    `Name=tag:ShardId,Values=${inputs.shardId}`,
  ];

  let instances = 0;
  try {
    const { stdout } = await exec(
      "aws",
      ["ec2", "describe-instances", "--region", inputs.region, ...tagFilters, "--output", "json"],
      { timeoutMs: 60_000 },
    );
    instances = countNonTerminalInstances(stdout);
  } catch (error) {
    errors.push(`describe-instances: ${boundedError(error)}`);
    instances = 1; // ambiguous → fail-closed.
  }

  let securityGroups = 0;
  try {
    const { stdout } = await exec(
      "aws",
      ["ec2", "describe-security-groups", "--region", inputs.region, ...tagFilters, "--output", "json"],
      { timeoutMs: 60_000 },
    );
    securityGroups = countArrayField(stdout, "SecurityGroups");
  } catch (error) {
    errors.push(`describe-security-groups: ${boundedError(error)}`);
    securityGroups = 1;
  }

  let keyPairs = 0;
  try {
    const { stdout } = await exec(
      "aws",
      [
        "ec2",
        "describe-key-pairs",
        "--region",
        inputs.region,
        "--filters",
        `Name=key-name,Values=${inputs.keyNamePrefix}-*`,
        "--output",
        "json",
      ],
      { timeoutMs: 60_000 },
    );
    keyPairs = countArrayField(stdout, "KeyPairs");
  } catch (error) {
    errors.push(`describe-key-pairs: ${boundedError(error)}`);
    keyPairs = 1;
  }

  let dnsRecords = 0;
  try {
    const { stdout } = await exec(
      "aws",
      [
        "route53",
        "list-resource-record-sets",
        "--hosted-zone-id",
        inputs.hostedZoneId,
        "--start-record-name",
        inputs.recordName,
        "--max-items",
        "5",
        "--output",
        "json",
      ],
      { timeoutMs: 60_000 },
    );
    dnsRecords = countMatchingRecordSets(stdout, inputs.recordName);
  } catch (error) {
    errors.push(`list-resource-record-sets: ${boundedError(error)}`);
    dnsRecords = 1;
  }

  return {
    remaining: instances + securityGroups + keyPairs + dnsRecords,
    detail: { instances, securityGroups, keyPairs, dnsRecords },
    errors,
  };
}

/** Counts EC2 instances across reservations whose state is NOT terminal. */
export function countNonTerminalInstances(stdout: string): number {
  const parsed = JSON.parse(stdout) as {
    Reservations?: Array<{ Instances?: Array<{ State?: { Name?: string } }> }>;
  };
  if (!Array.isArray(parsed.Reservations)) {
    throw new Error("AWS describe-instances response has no Reservations array.");
  }
  let count = 0;
  for (const reservation of parsed.Reservations) {
    if (!Array.isArray(reservation.Instances)) {
      throw new Error("AWS describe-instances reservation has no Instances array.");
    }
    for (const instance of reservation.Instances) {
      const state = instance.State?.Name ?? "unknown";
      if (!TERMINAL_INSTANCE_STATES.has(state)) {
        count += 1;
      }
    }
  }
  return count;
}

/** Counts entries of a top-level array field (SecurityGroups / KeyPairs). */
export function countArrayField(stdout: string, field: "SecurityGroups" | "KeyPairs"): number {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const value = parsed[field];
  if (!Array.isArray(value)) {
    throw new Error(`AWS response has no ${field} array.`);
  }
  return value.length;
}

/** Counts record sets whose name equals the run record (Route53 appends a trailing dot). */
export function countMatchingRecordSets(stdout: string, recordName: string): number {
  const parsed = JSON.parse(stdout) as { ResourceRecordSets?: Array<{ Name?: string }> };
  if (!Array.isArray(parsed.ResourceRecordSets)) {
    throw new Error("Route53 response has no ResourceRecordSets array.");
  }
  const wanted = normalizeDnsName(recordName);
  return parsed.ResourceRecordSets.filter((set) => normalizeDnsName(set.Name ?? "") === wanted).length;
}

function normalizeDnsName(name: string): string {
  return name.replace(/\.$/, "").toLowerCase();
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
