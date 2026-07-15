import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import type { CleanupResourceKind } from "../local-workspace/cleanup-ledger.js";

/**
 * The run-scoped DNS contract (frozen spec decision 5): a Route53 A record on
 * the owned `qualification.proliferate.com` zone (taggable/ledgerable, matches
 * PR 2), with Caddy/Let's-Encrypt issuing TLS for the run subdomain during the
 * install cell. sslip.io is an implementation-only fallback; the frozen contract
 * is the owned zone. All Route53 access goes through the injectable seam so unit
 * tests run offline. The record name is deterministic (a collision-free run
 * subdomain), so it is registered in the ledger BEFORE the create with its final
 * identity as the safe provider id — registered-before-create with an idempotent
 * DELETE releaser.
 */

export const QUALIFICATION_ZONE = "qualification.proliferate.com";
const DEFAULT_TTL = 60;

/** Injectable AWS Route53 CLI seam. `run` returns stdout, throwing on non-zero exit. */
export interface Route53Exec {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string>;
}

export interface Route53Record {
  hostedZoneId: string;
  /** FQDN, e.g. `<run>.qualification.proliferate.com`. */
  recordName: string;
  ip: string;
  ttl: number;
}

export interface UpsertRoute53Options {
  hostedZoneId: string;
  /** The run subdomain label (see `runSubdomainLabel`). */
  subdomain: string;
  ip: string;
  zone?: string;
  ttl?: number;
  exec?: Route53Exec;
  log?: (message: string) => void;
  /** Registered-before-create for the `route53_record` kind. */
  registerCleanup(
    kind: Extract<CleanupResourceKind, "route53_record">,
    providerId: string,
    release: () => Promise<void>,
  ): Promise<void>;
}

/**
 * Upserts (CREATE) the run's A record and registers its deletion before the
 * change is submitted. Returns once the change is accepted; propagation is part
 * of the install cell's bounded TLS/health gate.
 */
export async function upsertRoute53ARecord(options: UpsertRoute53Options): Promise<Route53Record> {
  const exec = options.exec ?? defaultRoute53Exec;
  const log = options.log ?? (() => undefined);
  const zone = options.zone ?? QUALIFICATION_ZONE;
  const ttl = options.ttl ?? DEFAULT_TTL;
  const recordName = `${options.subdomain}.${zone}`;
  const record: Route53Record = { hostedZoneId: options.hostedZoneId, recordName, ip: options.ip, ttl };

  // Register the DELETE releaser BEFORE the UPSERT so an interrupted run always
  // has a durable record to reconcile. The record FQDN is the safe provider id.
  await options.registerCleanup("route53_record", recordName, () => deleteRoute53ARecord(record, { exec, log }));

  log(`upserting A record ${recordName} -> ${options.ip} in zone ${options.hostedZoneId}`);
  await exec.run(
    [
      "route53",
      "change-resource-record-sets",
      "--hosted-zone-id",
      options.hostedZoneId,
      "--change-batch",
      changeBatch("UPSERT", record),
    ],
    { timeoutMs: 60_000 },
  );
  return record;
}

/** Deletes the run's A record (reverse-order teardown); idempotent on replay. */
export async function deleteRoute53ARecord(
  record: Route53Record,
  options: { exec?: Route53Exec; log?: (message: string) => void },
): Promise<void> {
  const exec = options.exec ?? defaultRoute53Exec;
  const log = options.log ?? (() => undefined);
  log(`deleting A record ${record.recordName} in zone ${record.hostedZoneId}`);
  try {
    await exec.run(
      [
        "route53",
        "change-resource-record-sets",
        "--hosted-zone-id",
        record.hostedZoneId,
        "--change-batch",
        changeBatch("DELETE", record),
      ],
      { timeoutMs: 60_000 },
    );
  } catch (error) {
    // A DELETE of an already-absent record set errors; that is a clean,
    // idempotent teardown outcome, not a leak.
    if (isMissingRecord(error)) {
      return;
    }
    throw error;
  }
}

/**
 * The collision-free DNS label for a run/shard. Combines a sanitized run/shard
 * prefix with a short digest of the exact `<runId>:<shardId>` pair, so two
 * concurrent runs (or two shards) can never collide on the record name even if
 * their sanitized prefixes coincide. The result is a valid DNS label
 * (lowercase, `[a-z0-9-]`, starts/ends alphanumeric, ≤63 chars).
 */
export function runSubdomainLabel(runId: string, shardId: string): string {
  const digest = createHash("sha256").update(`${runId}:${shardId}`).digest("hex").slice(0, 8);
  const prefix = `sh-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/g, "");
  const label = `${prefix}-${digest}`.replace(/^-+/, "");
  // Guaranteed ≤ 61 chars (50 + '-' + 8, plus the leading "sh-"), starts with a
  // letter and ends with the hex digest, so it is always a valid DNS label.
  return label;
}

function changeBatch(action: "UPSERT" | "DELETE", record: Route53Record): string {
  return JSON.stringify({
    Changes: [
      {
        Action: action,
        ResourceRecordSet: {
          Name: record.recordName,
          Type: "A",
          TTL: record.ttl,
          ResourceRecords: [{ Value: record.ip }],
        },
      },
    ],
  });
}

function isMissingRecord(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidChangeBatch|not found|does not exist|but it was not found/i.test(message);
}

const execFileAsync = promisify(execFile);

const defaultRoute53Exec: Route53Exec = {
  async run(args, options) {
    const { stdout } = await execFileAsync("aws", [...args], {
      timeout: options?.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.toString();
  },
};
