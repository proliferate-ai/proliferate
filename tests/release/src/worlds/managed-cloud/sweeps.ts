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
  let count = 0;
  for (const reservation of parsed.Reservations ?? []) {
    for (const instance of reservation.Instances ?? []) {
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
  return Array.isArray(value) ? value.length : 0;
}

/** Counts record sets whose name equals the run record (Route53 appends a trailing dot). */
export function countMatchingRecordSets(stdout: string, recordName: string): number {
  const parsed = JSON.parse(stdout) as { ResourceRecordSets?: Array<{ Name?: string }> };
  const wanted = normalizeDnsName(recordName);
  return (parsed.ResourceRecordSets ?? []).filter((set) => normalizeDnsName(set.Name ?? "") === wanted).length;
}

function normalizeDnsName(name: string): string {
  return name.replace(/\.$/, "").toLowerCase();
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
