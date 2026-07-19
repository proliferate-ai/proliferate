import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  hashLedgerId,
  type CleanupLedger,
  type CleanupResourceKind,
} from "../local-workspace/cleanup-ledger.js";

/**
 * The self-host CloudFormation-WRAPPER controller (frozen tier-3 contract
 * §`SH-CFN-WRAPPER`: "shallow infrastructure wrapper proof … verify candidate
 * input digests, stack outputs, DNS/TLS, and `/meta` version. Do not repeat the
 * owner, invite, and Desktop authentication journey"). It drives the SHIPPED
 * `server/infra/self-hosted-aws/template.yaml` — the exact CloudFormation entry
 * point an operator uses via `launch-stack.sh` — to install the EXACT candidate:
 *
 *   validate-template on the repo template (+ record its byte-hash receipt)
 *   → upload the candidate `proliferate-deploy.tar.gz` + its SHA256SUMS to a
 *     run-scoped S3 prefix and presign bounded GET URLs
 *   → docker-load + push the candidate server image to a run-scoped GHCR tag
 *   → create-stack with the presigned bundle URLs + run-scoped image repo/tag,
 *     `CreateRoute53Record=true` on the owned qualification zone
 *   → wait stack-create-complete (bounded; a create failure tails
 *     describe-stack-events, bounded + secret-free) → read Outputs.
 *
 * Unlike the EC2-posture self-host world (`world.ts`/`ec2.ts`), this posture
 * provisions exactly ONE CloudFormation stack that itself owns the VPC, EC2
 * host, Elastic IP, IAM/SSM role, and (with `CreateRoute53Record=true`) the
 * Route53 A record. There is therefore NO controller-local AnyHarness/renderer/
 * browser and no separate EC2/SG/key-pair ledger: the cleanup posture is
 * stack + S3 objects + GHCR version + local materialized paths (the Route53
 * record deletion RIDES `delete-stack`, since the stack owns it).
 *
 * Every AWS/docker/gh action goes through an injectable exec seam (mirrors
 * `Ec2Exec` in `ec2.ts`) so unit tests run fully offline. Seams shell the `aws`
 * / `docker` / `gh` CLIs with AMBIENT credentials — never credential values on
 * argv, never a printed token. Every resource is registered in the durable
 * cleanup ledger BEFORE it is created (registered-before-create), keyed by its
 * deterministic run-scoped identity, so the releaser is correct even on a crash
 * between the ledger write and the create call.
 */

// ── Injectable CLI seams ────────────────────────────────────────────────────

/** Injectable `aws` CLI seam (s3 / cloudformation / ssm). Returns stdout, throws on non-zero. */
export interface CfnAwsExec {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string>;
}

/** Injectable `docker` CLI seam (load / tag / push / inspect). */
export interface DockerExec {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string>;
}

/** Injectable `gh` CLI seam (GHCR package-version delete via the GitHub API). */
export interface GhExec {
  run(args: readonly string[], options?: { timeoutMs?: number }): Promise<string>;
}

/** Registered-before-create callback (the same shape the EC2 provisioner uses). */
export type RegisterCfnCleanup = (
  kind: Extract<CleanupResourceKind, "cloudformation_stack" | "s3_object" | "ghcr_package_version">,
  providerId: string,
  release: () => Promise<void>,
  cancellationRelease?: () => Promise<CfnCancellationReleaseOutcome>,
) => Promise<void>;

/** The owned Route53 zone the run subdomain lives under (matches `dns.ts`). */
export const QUALIFICATION_ZONE = "qualification.proliferate.com";
export const CFN_RUNTIME_ARCHIVE_NAME = "anyharness-aarch64-unknown-linux-musl.tar.gz";
export const SELFHOST_QUALIFICATION_PURPOSE = "self-hosting-qualification";
/** Presigned-URL lifetime: long enough for a bounded stack bootstrap, no longer. */
export const PRESIGN_EXPIRY_SECONDS = 3600;
/** Bounded stack create/delete wait (a t4g bootstrap has a PT20M CreationPolicy). */
export const STACK_WAIT_TIMEOUT_MS = 30 * 60_000;
/** Each cancellation delete/observe call must leave headroom in the 25s process bridge. */
export const CFN_CANCELLATION_CALL_TIMEOUT_MS = 5_000;
/** Bounded describe-stack-events tail on a create failure. */
export const MAX_STACK_EVENT_TAIL = 8;
const MAX_EVENT_REASON_CHARS = 240;
/** Bounded SSM command poll (docker-inspect the running api image RepoDigest). */
export const SSM_POLL_TIMEOUT_MS = 120_000;
const SSM_POLL_INTERVAL_MS = 3_000;
/** Failure-diagnostic SSM acquisition stays well below the outer stack/cleanup budget. */
export const CFN_DIAGNOSTIC_TIMEOUT_MS = 90_000;
export const CFN_BOOTSTRAP_DIAGNOSTIC_FILENAME = "cfn-bootstrap-diagnostic.json";
const CFN_DIAGNOSTIC_MAX_OBSERVATIONS = 24;
const CFN_DIAGNOSTIC_COMMAND_TIMEOUT_SECONDS = 30;
const CFN_DIAGNOSTIC_COMMAND = [
  "for f in /var/log/cfn-init.log /var/log/cfn-init-cmd.log; do",
  "  [ -r \"$f\" ] || continue",
  "  printf '__PROLIFERATE_CFN_LOG__:%s\\n' \"${f##*/}\"",
  "  sudo grep -aiE 'Command [0-9]{2}-[A-Za-z0-9_-]+|exit(ed)?( with)? (error )?(code|status)|return code|timed out|timeout|failed|error|unhealthy|checksum|sha256|no space|permission denied|access denied|curl|download|docker compose|health' \"$f\" 2>/dev/null | tail -n 60 | cut -c1-500",
  "done",
].join("\n");

export type CfnBootstrapDiagnosticCaptureStatus =
  | "captured"
  | "instance_unavailable"
  | "ssm_unavailable"
  | "command_failed"
  | "no_allowlisted_observations";

export type CfnBootstrapDiagnosticSource = "cfn-init.log" | "cfn-init-cmd.log";

export type CfnBootstrapStage =
  | "01-install-base"
  | "02-install-compose-plugin"
  | "03-enable-docker"
  | "04-create-directories"
  | "01-fetch-verify-extract"
  | "01-daemon-reload"
  | "02-bootstrap"
  | "03-enable-cfn-hup"
  | "unknown";

export type CfnBootstrapFailureCategory =
  | "timeout"
  | "no_space"
  | "permission_denied"
  | "checksum"
  | "download"
  | "compose"
  | "health"
  | "command_failed"
  | "other";

export interface CfnBootstrapDiagnosticObservation {
  source: CfnBootstrapDiagnosticSource;
  stage: CfnBootstrapStage;
  outcome: "failed" | "completed" | "observed";
  exit_code: number | null;
  category: CfnBootstrapFailureCategory;
}

/**
 * Evidence-safe failure diagnostic. It deliberately carries no raw log line,
 * provider payload, hostname, URL, command text, or secret-shaped value.
 */
export interface CfnBootstrapDiagnostic {
  stack_name_hash: string;
  instance_id_hash: string | null;
  capture_status: CfnBootstrapDiagnosticCaptureStatus;
  detail:
    | "captured"
    | "instance_not_found"
    | "ssm_not_online"
    | "send_command_unauthorized"
    | "send_command_failed"
    | "command_poll_unauthorized"
    | "command_poll_timeout"
    | "command_terminal"
    | "no_allowlisted_observations";
  ssm_status: "Online" | "Success" | "Failed" | "TimedOut" | "Unavailable";
  observations: CfnBootstrapDiagnosticObservation[];
}

export interface CfnBootstrapDiagnosticArtifactV1 {
  schema_version: 1;
  kind: "proliferate.selfhost-cfn-bootstrap-diagnostic";
  run: {
    run_id: string;
    shard_id: string;
    attempt: number;
    source_sha: string;
  };
  diagnostic: CfnBootstrapDiagnostic;
}

/** A signal cleanup reconciles only observed absence; initiation stays in durable custody. */
export type CfnCancellationReleaseOutcome = "reconciled" | "delete_initiated";

// ── Pure, offline-testable helpers ──────────────────────────────────────────

/**
 * A collision-free, CloudFormation-safe stack name for a run/shard
 * (`[A-Za-z][-A-Za-z0-9]*`, ≤128). A short digest of the exact `<runId>:<shardId>`
 * pair guarantees uniqueness even if the sanitized prefix of two runs coincides.
 */
export function cfnStackName(runId: string, shardId: string): string {
  const digest = createHash("sha256").update(`${runId}:${shardId}`).digest("hex").slice(0, 8);
  const base = `proliferate-sh-cfn-${runId}-${shardId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
    .replace(/-$/g, "");
  return `${base}-${digest}`;
}

export interface CfnStackTag {
  key: "Purpose" | "Name" | "RunId" | "ShardId";
  value: string;
}

/**
 * Positive ownership tags for the stack and every CloudFormation resource that
 * supports stack-tag propagation. These are also the request tags required by
 * the bounded qualification IAM policy; an untagged create must never be sent.
 */
export function buildCfnStackTags(input: {
  stackName: string;
  runId: string;
  shardId: string;
}): CfnStackTag[] {
  const tags: CfnStackTag[] = [
    { key: "Purpose", value: SELFHOST_QUALIFICATION_PURPOSE },
    { key: "Name", value: input.stackName },
    { key: "RunId", value: input.runId },
    { key: "ShardId", value: input.shardId },
  ];
  for (const tag of tags) {
    if (!tag.value || tag.value.length > 256 || !/^[A-Za-z0-9_.:/=+@-]+$/.test(tag.value)) {
      throw new Error(`CFN: unsafe ${tag.key} ownership tag value.`);
    }
  }
  return tags;
}

/**
 * The run-scoped, immutable docker tag the candidate image is pushed under
 * (`<runId>-<shardId>`, sanitized to the docker tag charset). Never `stable`/
 * `latest`: a unique per-run tag cannot have drifted, which is what makes the
 * pushed-digest binding trustworthy.
 */
export function runScopedImageTag(runId: string, shardId: string): string {
  const raw = `${runId}-${shardId}`.toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/-+/g, "-");
  const trimmed = raw.replace(/^[-.]+/, "").slice(0, 120) || "run";
  return trimmed;
}

/** The run-scoped S3 key prefix (`qualification/<runId>/<shardId>/`). */
export function s3KeyPrefix(runId: string, shardId: string): string {
  return `qualification/${encodeURIComponent(runId)}/${encodeURIComponent(shardId)}/`;
}

/** The run subdomain FQDN the stack issues TLS + a Route53 record for. */
export function cfnSiteAddress(subdomainLabel: string, zone: string = QUALIFICATION_ZONE): string {
  return `${subdomainLabel}.${zone}`;
}

/** Splits a GHCR image repo (`ghcr.io/<org>/<name>`) into `{ org, packageName }`. */
export function parseGhcrRepo(repo: string): { org: string; packageName: string } {
  const withoutHost = repo.replace(/^ghcr\.io\//i, "");
  const segments = withoutHost.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    throw new Error(`CFN: RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO must be ghcr.io/<org>/<name>, got "${repo}".`);
  }
  const org = segments[0];
  const packageName = segments.slice(1).join("/");
  return { org, packageName };
}

/** One CloudFormation parameter in the `--parameters file://` JSON form. */
export interface CfnParameter {
  ParameterKey: string;
  ParameterValue: string;
}

/**
 * Builds the CloudFormation parameter list in the JSON form
 * (`[{ParameterKey, ParameterValue}, ...]`) that is written to a permission-
 * restricted file and passed as `--parameters file://<path>` — NOT as argv
 * (PR7-CONTROL-003). The deploy/runtime override values are presigned S3 URLs
 * carrying a bearer signature (`X-Amz-*`); keeping them out of argv keeps them out of the
 * process table, shell history, and any argv-echoing error. NoEcho template
 * params (Postgres/JWT/CloudSecret) are left to the template's auto-generate
 * default and never supplied here. Pure so param construction is asserted offline.
 */
export function buildCfnParameters(input: {
  releaseVersion: string;
  serverImageRepository: string;
  runtimeBinaryUrl: string;
  runtimeBinaryChecksumUrl: string;
  deployBundleUrl: string;
  deployBundleChecksumUrl: string;
  siteAddress: string;
  hostedZoneId: string;
}): CfnParameter[] {
  return [
    { ParameterKey: "ReleaseVersion", ParameterValue: input.releaseVersion },
    { ParameterKey: "ServerImageRepository", ParameterValue: input.serverImageRepository },
    { ParameterKey: "RuntimeBinaryUrl", ParameterValue: input.runtimeBinaryUrl },
    { ParameterKey: "RuntimeBinaryChecksumUrl", ParameterValue: input.runtimeBinaryChecksumUrl },
    { ParameterKey: "DeployBundleUrl", ParameterValue: input.deployBundleUrl },
    { ParameterKey: "DeployBundleChecksumUrl", ParameterValue: input.deployBundleChecksumUrl },
    { ParameterKey: "SiteAddress", ParameterValue: input.siteAddress },
    { ParameterKey: "CreateRoute53Record", ParameterValue: "true" },
    { ParameterKey: "HostedZoneId", ParameterValue: input.hostedZoneId },
  ];
}

/**
 * Redacts any presigned S3 URL (one bearing an AWS `X-Amz-*` signature query
 * parameter) from a diagnostic string, so a propagated aws-cli failure can never
 * carry the bearer signature into cell text / logs / evidence (PR7-CONTROL-003).
 */
export function scrubCfnParameterUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"']*[?&]X-Amz-[^\s"']*/gi, "[REDACTED_PRESIGNED_URL]");
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Observes whether the stack-owned Route53 A record for `recordName` is ABSENT
 * from `hostedZoneId` after stack deletion (PR7-CONTROL-008). Queries
 * `list-resource-record-sets` filtered to the name; returns true only when no A
 * record for that exact name survives. Any A record with the name (a survivor)
 * → false. Used as the cleanup stack's `observeRoute53RecordAbsent`.
 */
export async function route53RecordAbsent(
  exec: CfnAwsExec,
  hostedZoneId: string,
  recordName: string,
  region: string,
): Promise<boolean> {
  const fqdn = recordName.endsWith(".") ? recordName : `${recordName}.`;
  const raw = await exec.run([
    "route53",
    "list-resource-record-sets",
    "--hosted-zone-id",
    hostedZoneId,
    "--start-record-name",
    fqdn,
    "--start-record-type",
    "A",
    "--max-items",
    "1",
    "--region",
    region,
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // An unparseable response cannot prove absence → treat as a survivor.
    return false;
  }
  const sets = (parsed as { ResourceRecordSets?: Array<{ Name?: string; Type?: string }> }).ResourceRecordSets ?? [];
  const survivor = sets.some(
    (record) => record.Type === "A" && (record.Name === fqdn || record.Name === recordName),
  );
  return !survivor;
}

/**
 * The production parameter-file IO: a 0600 file under a fresh mkdtemp dir, so
 * the presigned-URL parameters land only in a permission-restricted file and are
 * removed after create-stack (PR7-CONTROL-003). Injected into
 * `createCfnStackAndWait` so unit tests never touch disk.
 */
export function tmpParameterFileIo(): (json: string) => Promise<{ path: string; remove: () => Promise<void> }> {
  return async (json: string) => {
    const dir = await mkdtemp(path.join(tmpdir(), "selfhost-cfn-"));
    const filePath = path.join(dir, "parameters.json");
    await writeFile(filePath, json, { mode: 0o600 });
    return { path: filePath, remove: () => rm(dir, { recursive: true, force: true }) };
  };
}

/** The stack Outputs the shallow wrapper proof reads. */
export interface CfnStackOutputs {
  baseUrl: string;
  siteAddress: string;
  instanceId: string;
  publicIp?: string;
}

/** Parses `aws cloudformation describe-stacks` JSON into the outputs the cell asserts. */
export function parseStackOutputs(describeStacksJson: string): CfnStackOutputs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(describeStacksJson);
  } catch (error) {
    throw new Error(`CFN: could not parse describe-stacks JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stacks = (parsed as { Stacks?: Array<{ Outputs?: Array<{ OutputKey?: string; OutputValue?: string }> }> }).Stacks;
  const outputs = stacks?.[0]?.Outputs;
  if (!Array.isArray(outputs)) {
    throw new Error("CFN: describe-stacks returned no Outputs array.");
  }
  const byKey = new Map<string, string>();
  for (const entry of outputs) {
    if (typeof entry.OutputKey === "string" && typeof entry.OutputValue === "string") {
      byKey.set(entry.OutputKey, entry.OutputValue);
    }
  }
  const baseUrl = byKey.get("BaseUrl");
  const siteAddress = byKey.get("SiteAddress");
  const instanceId = byKey.get("InstanceId");
  if (!baseUrl || !siteAddress || !instanceId) {
    throw new Error("CFN: describe-stacks Outputs are missing BaseUrl/SiteAddress/InstanceId.");
  }
  return { baseUrl, siteAddress, instanceId, publicIp: byKey.get("PublicIp") };
}

/** True iff BaseUrl == https://<SiteAddress> and SiteAddress == the requested FQDN, InstanceId present. */
export function outputsWellFormed(outputs: CfnStackOutputs, requestedSiteAddress: string): boolean {
  return (
    outputs.siteAddress === requestedSiteAddress &&
    outputs.baseUrl === `https://${requestedSiteAddress}` &&
    /^i-[0-9a-f]+$/i.test(outputs.instanceId)
  );
}

/**
 * Extracts the `sha256:<hex>` component of an image ref (`repo@sha256:…` or a
 * bare `sha256:…`). Returns null if none is present, so a comparison against a
 * missing digest fails closed rather than vacuously passing.
 */
export function digestSha256(imageRef: string): string | null {
  const match = imageRef.match(/sha256:[0-9a-f]{64}/i);
  return match ? match[0].toLowerCase() : null;
}

/** True iff the observed image ref and the pushed image ref carry the SAME sha256 digest. */
export function imageDigestBound(pushedRef: string, observedRef: string): boolean {
  const pushed = digestSha256(pushedRef);
  const observed = digestSha256(observedRef);
  return pushed !== null && observed !== null && pushed === observed;
}

/**
 * True iff the SHA256SUMS content lists the candidate bundle's sha256 for the
 * `proliferate-deploy.tar.gz` entry — the binding the stack's `sha256sum -c`
 * enforces on the box. Both bare-name (`<sha>  proliferate-deploy.tar.gz`) and
 * path-suffixed entries are accepted.
 */
export function bundleDigestBound(sumsContent: string, candidateBundleSha256: string): boolean {
  return namedAssetDigestBound(sumsContent, candidateBundleSha256, "proliferate-deploy.tar.gz");
}

/** True only when SHA256SUMS binds the exact arm64 runtime archive bytes. */
export function runtimeDigestBound(sumsContent: string, candidateRuntimeSha256: string): boolean {
  return namedAssetDigestBound(sumsContent, candidateRuntimeSha256, CFN_RUNTIME_ARCHIVE_NAME);
}

function namedAssetDigestBound(sumsContent: string, candidateSha256: string, basename: string): boolean {
  const want = candidateSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) {
    return false;
  }
  for (const line of sumsContent.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (!match) {
      continue;
    }
    const [, sha, name] = match;
    const normalizedName = name.trim().replace(/^\.\//, "");
    if (sha.toLowerCase() === want && (normalizedName === basename || normalizedName.endsWith(`/${basename}`))) {
      return true;
    }
  }
  return false;
}

/**
 * Formats a BOUNDED, secret-free tail of `describe-stack-events` for a
 * create-failure diagnostic. Only failure-status events are kept, each rendered
 * as `<LogicalResourceId> <ResourceStatus>: <truncated reason>` — NoEcho
 * template parameters never appear in stack events, and each reason is capped.
 */
export function boundedStackEventsTail(describeStackEventsJson: string, max: number = MAX_STACK_EVENT_TAIL): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(describeStackEventsJson);
  } catch {
    return "(stack events unavailable)";
  }
  const events = (
    parsed as {
      StackEvents?: Array<{ LogicalResourceId?: string; ResourceStatus?: string; ResourceStatusReason?: string }>;
    }
  ).StackEvents;
  if (!Array.isArray(events)) {
    return "(no stack events)";
  }
  const failures = events
    .filter((event) => typeof event.ResourceStatus === "string" && /FAILED/i.test(event.ResourceStatus))
    .slice(0, max)
    .map((event) => {
      const id = String(event.LogicalResourceId ?? "?");
      const status = String(event.ResourceStatus ?? "?");
      const reasonRaw = String(event.ResourceStatusReason ?? "").replace(/\s+/g, " ").trim();
      const reason = reasonRaw.length > MAX_EVENT_REASON_CHARS ? `${reasonRaw.slice(0, MAX_EVENT_REASON_CHARS)}…` : reasonRaw;
      return reason ? `${id} ${status}: ${reason}` : `${id} ${status}`;
    });
  return failures.length > 0 ? failures.join(" | ") : "(no FAILED stack events)";
}

const ALLOWED_CFN_BOOTSTRAP_STAGES = new Set<CfnBootstrapStage>([
  "01-install-base",
  "02-install-compose-plugin",
  "03-enable-docker",
  "04-create-directories",
  "01-fetch-verify-extract",
  "01-daemon-reload",
  "02-bootstrap",
  "03-enable-cfn-hup",
]);

/**
 * Reduces bounded raw SSM output to a fixed-token diagnostic. Raw lines are
 * never returned or persisted: only allowlisted template stage names, numeric
 * exit codes, and coarse failure categories survive.
 */
export function parseCfnBootstrapDiagnosticOutput(raw: string): CfnBootstrapDiagnosticObservation[] {
  let source: CfnBootstrapDiagnosticSource = "cfn-init.log";
  const observations: CfnBootstrapDiagnosticObservation[] = [];
  const seen = new Set<string>();
  const activeStage: Record<CfnBootstrapDiagnosticSource, CfnBootstrapStage> = {
    "cfn-init.log": "unknown",
    "cfn-init-cmd.log": "unknown",
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const marker = rawLine.match(/^__PROLIFERATE_CFN_LOG__:(cfn-init(?:-cmd)?\.log)$/);
    if (marker) {
      source = marker[1] as CfnBootstrapDiagnosticSource;
      continue;
    }
    const line = rawLine.slice(0, 500);
    if (!line.trim()) {
      continue;
    }

    const stageMatch = line.match(/\bCommand\s+([0-9]{2}-[A-Za-z0-9_-]{1,64})\b/i);
    const candidateStage = stageMatch?.[1]?.toLowerCase() as CfnBootstrapStage | undefined;
    if (candidateStage && ALLOWED_CFN_BOOTSTRAP_STAGES.has(candidateStage)) {
      activeStage[source] = candidateStage;
    }
    // cfn-init commonly logs the command name and its error/exit on adjacent
    // lines. Carry only the last allowlisted stage token within the same file;
    // no arbitrary prior text survives.
    const stage = activeStage[source];
    const exitMatch = line.match(
      /\b(?:exit(?:ed)?(?:\s+with)?(?:\s+(?:error\s+)?(?:code|status))?|return\s+code)\s*[:=]?\s*(\d{1,3})\b/i,
    );
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
    const lower = line.toLowerCase();
    const outcome: CfnBootstrapDiagnosticObservation["outcome"] =
      /failed|error|denied|unhealthy|no space|timed out|timeout/.test(lower)
        ? "failed"
        : /completed|succeeded|success/.test(lower)
          ? "completed"
          : "observed";
    const category = cfnBootstrapFailureCategory(lower);

    // A stage-heading line updates `activeStage` but is not itself a failure
    // observation. Lines without an exit/outcome/category carry no result.
    if (exitCode === null && category === "other" && outcome === "observed") {
      continue;
    }
    const observation: CfnBootstrapDiagnosticObservation = {
      source,
      stage,
      outcome,
      exit_code: exitCode,
      category,
    };
    const key = JSON.stringify(observation);
    if (!seen.has(key)) {
      seen.add(key);
      observations.push(observation);
    }
    if (observations.length >= CFN_DIAGNOSTIC_MAX_OBSERVATIONS) {
      break;
    }
  }
  return observations;
}

function cfnBootstrapFailureCategory(lower: string): CfnBootstrapFailureCategory {
  if (/timed out|timeout/.test(lower)) return "timeout";
  if (/no space/.test(lower)) return "no_space";
  if (/permission denied|access denied/.test(lower)) return "permission_denied";
  if (/checksum|sha256/.test(lower)) return "checksum";
  if (/curl|download|fetch|http/.test(lower)) return "download";
  if (/docker compose|\bcompose\b/.test(lower)) return "compose";
  if (/unhealthy|\bhealth\b/.test(lower)) return "health";
  if (/failed|error|exit|return code/.test(lower)) return "command_failed";
  return "other";
}

/** The artifact lives outside `<runDir>/cfn`, which cleanup removes on success. */
export function cfnBootstrapDiagnosticArtifactPath(runDir: string): string {
  return path.join(runDir, "logs", CFN_BOOTSTRAP_DIAGNOSTIC_FILENAME);
}

/** Atomically writes the already-reduced diagnostic before stack cleanup. */
export async function writeCfnBootstrapDiagnosticArtifact(
  artifactPath: string,
  artifact: CfnBootstrapDiagnosticArtifactV1,
): Promise<void> {
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  // Defense in depth: the structured type cannot carry raw output, and this
  // guard prevents a future widening from persisting common secret shapes.
  if (/X-Amz-|Bearer\s+|\b(?:sk|vk)-[A-Za-z0-9._-]{6,}|\beyJ[A-Za-z0-9._-]{10,}/i.test(serialized)) {
    throw new Error("CFN: refusing to persist a secret-shaped bootstrap diagnostic.");
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const tmpPath = `${artifactPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmpPath, serialized, { mode: 0o600 });
    await rename(tmpPath, artifactPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Safe one-line summary for the ordinary failed-cell reason. */
export function summarizeCfnBootstrapDiagnostic(diagnostic: CfnBootstrapDiagnostic): string {
  const observations = diagnostic.observations
    .slice(0, 4)
    .map((item) => `${item.stage}:${item.outcome}:exit=${item.exit_code ?? "unknown"}:${item.category}`)
    .join(",");
  return observations
    ? `${diagnostic.capture_status}(${observations})`
    : `${diagnostic.capture_status}(${diagnostic.detail})`;
}

// ── S3 upload / presign ─────────────────────────────────────────────────────

/**
 * Uploads the candidate deploy bundle, arm64 runtime archive, and their shared
 * SHA256SUMS to the run-scoped S3 prefix and returns presigned (bounded-expiry)
 * GET URLs for each. Registers an
 * `s3_object` cleanup intent BEFORE each `s3 cp` (registered-before-create), so
 * an interrupted run always has a durable delete releaser.
 */
export async function uploadBundleAndPresign(input: {
  exec: CfnAwsExec;
  region: string;
  bucket: string;
  keyPrefix: string;
  bundlePath: string;
  runtimePath: string;
  sumsPath: string;
  expirySeconds?: number;
  registerCleanup: RegisterCfnCleanup;
  timeoutMs?: number;
  log?: (message: string) => void;
}): Promise<{
  deployBundleUrl: string;
  deployBundleChecksumUrl: string;
  runtimeBinaryUrl: string;
  runtimeKey: string;
  bundleKey: string;
  sumsKey: string;
}> {
  const { exec, region, bucket, keyPrefix } = input;
  const log = input.log ?? (() => undefined);
  const expiry = input.expirySeconds ?? PRESIGN_EXPIRY_SECONDS;
  const bundleKey = `${keyPrefix}proliferate-deploy.tar.gz`;
  const runtimeKey = `${keyPrefix}${CFN_RUNTIME_ARCHIVE_NAME}`;
  const sumsKey = `${keyPrefix}self-hosted-assets.SHA256SUMS`;

  await input.registerCleanup("s3_object", `s3://${bucket}/${bundleKey}`, () =>
    deleteS3Object(exec, region, bucket, bundleKey),
  );
  log(`s3 cp bundle -> s3://${bucket}/${bundleKey}`);
  await exec.run(["s3", "cp", input.bundlePath, `s3://${bucket}/${bundleKey}`, "--region", region], {
    timeoutMs: input.timeoutMs,
  });

  await input.registerCleanup("s3_object", `s3://${bucket}/${runtimeKey}`, () =>
    deleteS3Object(exec, region, bucket, runtimeKey),
  );
  log(`s3 cp runtime -> s3://${bucket}/${runtimeKey}`);
  await exec.run(["s3", "cp", input.runtimePath, `s3://${bucket}/${runtimeKey}`, "--region", region], {
    timeoutMs: input.timeoutMs,
  });

  await input.registerCleanup("s3_object", `s3://${bucket}/${sumsKey}`, () =>
    deleteS3Object(exec, region, bucket, sumsKey),
  );
  log(`s3 cp sums -> s3://${bucket}/${sumsKey}`);
  await exec.run(["s3", "cp", input.sumsPath, `s3://${bucket}/${sumsKey}`, "--region", region], {
    timeoutMs: input.timeoutMs,
  });

  const deployBundleUrl = (
    await exec.run(["s3", "presign", `s3://${bucket}/${bundleKey}`, "--expires-in", String(expiry), "--region", region])
  ).trim();
  const runtimeBinaryUrl = (
    await exec.run(["s3", "presign", `s3://${bucket}/${runtimeKey}`, "--expires-in", String(expiry), "--region", region])
  ).trim();
  const deployBundleChecksumUrl = (
    await exec.run(["s3", "presign", `s3://${bucket}/${sumsKey}`, "--expires-in", String(expiry), "--region", region])
  ).trim();
  if (!deployBundleUrl || !runtimeBinaryUrl || !deployBundleChecksumUrl) {
    throw new Error("CFN: aws s3 presign returned an empty URL.");
  }
  return { deployBundleUrl, deployBundleChecksumUrl, runtimeBinaryUrl, runtimeKey, bundleKey, sumsKey };
}

/** Deletes one S3 object (idempotent — an already-absent object is a clean outcome). */
export async function deleteS3Object(exec: CfnAwsExec, region: string, bucket: string, key: string): Promise<void> {
  await exec.run(["s3", "rm", `s3://${bucket}/${key}`, "--region", region]);
}

// ── Candidate server-image push to GHCR ─────────────────────────────────────

/**
 * docker-loads the candidate server-image archive, tags it to the run-scoped
 * GHCR repo:tag, pushes it, and returns the pushed image's digest. Registers a
 * `ghcr_package_version` cleanup intent BEFORE the push (the version id is
 * resolved by tag at delete time). `docker login` is assumed ambient (an
 * operator's `gh auth token`); no credential is ever printed or placed on argv.
 */
export async function pushCandidateServerImage(input: {
  docker: DockerExec;
  gh: GhExec;
  archivePath: string;
  targetRepo: string;
  tag: string;
  registerCleanup: RegisterCfnCleanup;
  timeoutMs?: number;
  log?: (message: string) => void;
}): Promise<{ imageRef: string; pushedDigest: string }> {
  const { docker, gh, targetRepo, tag } = input;
  const log = input.log ?? (() => undefined);
  const imageRef = `${targetRepo}:${tag}`;
  assertNotRollingTag(tag);

  await input.registerCleanup("ghcr_package_version", imageRef, () => deleteGhcrPackageVersion(gh, targetRepo, tag));

  log(`docker load ${input.archivePath}`);
  const loadOut = await docker.run(["load", "-i", input.archivePath], { timeoutMs: input.timeoutMs });
  const match = loadOut.match(/Loaded image:\s*(\S+)/);
  if (!match) {
    throw new Error("CFN: could not parse the loaded image ref from 'docker load' output.");
  }
  const loadedRef = match[1];

  log(`docker tag ${loadedRef} ${imageRef}`);
  await docker.run(["tag", loadedRef, imageRef]);
  log(`docker push ${imageRef}`);
  await docker.run(["push", imageRef], { timeoutMs: input.timeoutMs });

  const inspected = (await docker.run(["inspect", "--format", "{{index .RepoDigests 0}}", imageRef])).trim();
  const pushedDigest = digestSha256(inspected);
  if (!pushedDigest) {
    throw new Error(`CFN: could not resolve the pushed image digest for ${imageRef} (saw "${inspected}").`);
  }
  return { imageRef, pushedDigest };
}

/**
 * Deletes the run-scoped GHCR container package version by tag: resolves the
 * version id whose container tags include the run tag, then
 * `DELETE /orgs/{org}/packages/container/{name}/versions/{id}`. Idempotent — a
 * tag no longer present is a clean, already-deleted outcome.
 */
export async function deleteGhcrPackageVersion(
  gh: GhExec,
  targetRepo: string,
  tag: string,
  log: (message: string) => void = () => undefined,
): Promise<void> {
  const { org, packageName } = parseGhcrRepo(targetRepo);
  const encodedName = encodeURIComponent(packageName);
  const listPath = `/orgs/${org}/packages/container/${encodedName}/versions`;
  let raw: string;
  try {
    raw = await gh.run(["api", "--paginate", listPath]);
  } catch (error) {
    if (isGhNotFound(error)) {
      return; // The package/version is already gone.
    }
    throw error;
  }
  const versions = parseGhcrVersions(raw);
  const match = versions.find((version) => version.tags.includes(tag));
  if (match === undefined) {
    return; // No version carries this tag — nothing to delete (idempotent).
  }
  // Deleting a package VERSION removes ALL of its tags. Our tag is run-scoped and
  // immutable, so the expected case is a version carrying ONLY our tag. If the
  // version also carries SIBLING tags (someone else's, or a shared digest), do
  // NOT delete it — that would reap tags this run never owned (PR7-CONTROL-008).
  // Untag-only is not available on the GHCR versions API, so refuse and record a
  // reconcile note; the run-owned resource (our tag) points at a shared version
  // we must not destroy. This surfaces as a cleanup failure, not a silent pass.
  const siblingTags = match.tags.filter((t) => t !== tag);
  if (siblingTags.length > 0) {
    throw new Error(
      `CFN cleanup: GHCR version ${match.id} for tag "${tag}" also carries sibling tag(s) ` +
        `[${siblingTags.join(", ")}]; refusing to delete the shared version (would reap tags this run does not own). ` +
        "The run-scoped tag should be the version's only tag; investigate the shared digest.",
    );
  }
  log(`deleting GHCR package version ${match.id} (sole tag "${tag}")`);
  await gh.run(["api", "--method", "DELETE", `/orgs/${org}/packages/container/${encodedName}/versions/${match.id}`]);
}

/** Parses a (possibly `--paginate`-concatenated) GHCR versions JSON payload. */
export function parseGhcrVersions(
  raw: string,
): Array<{ id: number; tags: string[] }> {
  const results: Array<{ id: number; tags: string[] }> = [];
  // `gh api --paginate` normally merges array pages into ONE JSON array; some
  // versions concatenate consecutive `][` arrays. Handle both without splitting
  // on whitespace (JSON strings may contain spaces): parse the whole payload,
  // else parse each bracket-balanced top-level array.
  for (const chunk of topLevelJsonArrays(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) {
      continue;
    }
    for (const entry of parsed as Array<{ id?: unknown; metadata?: { container?: { tags?: unknown } } }>) {
      const id = typeof entry.id === "number" ? entry.id : Number(entry.id);
      const tags = entry.metadata?.container?.tags;
      if (Number.isFinite(id) && Array.isArray(tags)) {
        results.push({ id, tags: tags.filter((tag): tag is string => typeof tag === "string") });
      }
    }
  }
  return results;
}

/** Finds the GHCR version id whose container tags include `tag`, or null. */
export function ghcrVersionIdForTag(versions: Array<{ id: number; tags: string[] }>, tag: string): number | null {
  const match = versions.find((version) => version.tags.includes(tag));
  return match ? match.id : null;
}

// ── CloudFormation template + stack ─────────────────────────────────────────

/** Reads the repo template's bytes and returns their sha256 (the template receipt). */
export async function templateFileSha256(templatePath: string): Promise<string> {
  const bytes = await readFile(templatePath);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * `aws cloudformation validate-template` on the repo template file. Returns true
 * on success; throws a bounded error on a genuine template validation failure.
 * The bundle does NOT ship the template (`proliferate-deploy.tar.gz` is built
 * from `server/deploy/**`; the template lives in `server/infra/self-hosted-aws/`),
 * so the receipt is repo-file byte-hash + validate, not a bundle-embedded copy.
 */
export async function validateTemplate(
  exec: CfnAwsExec,
  templatePath: string,
  region: string,
  timeoutMs?: number,
): Promise<boolean> {
  await exec.run(
    ["cloudformation", "validate-template", "--template-body", `file://${templatePath}`, "--region", region],
    { timeoutMs },
  );
  return true;
}

/**
 * Registers the stack cleanup BEFORE `create-stack`, submits the create with the
 * candidate parameters, waits (bounded) for `stack-create-complete`, and returns
 * the parsed Outputs. Qualification alone asks CloudFormation to retain a failed
 * create (`DO_NOTHING`) just long enough for the optional bounded diagnostic
 * callback, then the already-registered cleanup owns deletion. On a create
 * failure it appends bounded, secret-free event + diagnostic summaries to the
 * thrown error. The production template/launch path is unchanged.
 */
export async function createCfnStackAndWait(input: {
  exec: CfnAwsExec;
  stackName: string;
  templatePath: string;
  parameters: readonly CfnParameter[];
  tags: readonly CfnStackTag[];
  region: string;
  registerCleanup: RegisterCfnCleanup;
  /**
   * Writes the parameter JSON to a permission-restricted (0600) local file and
   * returns its path + a cleanup handle. Injected so unit tests never touch
   * disk; the production impl (`tmpParameterFileIo`) uses mkdtemp + 0600.
   */
  writeParameterFile: (json: string) => Promise<{ path: string; remove: () => Promise<void> }>;
  onCreateFailure?: (context: {
    stackName: string;
    region: string;
    eventTail: string;
  }) => Promise<CfnBootstrapDiagnostic>;
  waitTimeoutMs?: number;
  log?: (message: string) => void;
}): Promise<CfnStackOutputs> {
  const { exec, stackName, region } = input;
  const log = input.log ?? (() => undefined);
  const waitTimeoutMs = input.waitTimeoutMs ?? STACK_WAIT_TIMEOUT_MS;

  await input.registerCleanup(
    "cloudformation_stack",
    stackName,
    () => deleteCfnStackAndWait(exec, stackName, region, { waitTimeoutMs }),
    () => initiateCfnStackDeletionForCancellation(exec, stackName, region),
  );

  log(`create-stack ${stackName}`);
  // Presigned DeployBundle URLs carry a bearer signature; write the parameters
  // to a 0600 file and pass `--parameters file://<path>` so they never enter
  // argv / the process table / an argv-echoing error (PR7-CONTROL-003).
  const paramFile = await input.writeParameterFile(JSON.stringify(input.parameters));
  let createError: unknown;
  try {
    await exec.run([
      "cloudformation",
      "create-stack",
      "--stack-name",
      stackName,
      "--template-body",
      `file://${input.templatePath}`,
      "--parameters",
      `file://${paramFile.path}`,
      "--capabilities",
      "CAPABILITY_IAM",
      // Qualification-only retention: the durable cleanup was registered
      // before create, so a failed stack remains only for bounded diagnostics
      // and is still deleted by the ordinary reverse-order finalizer.
      "--on-failure",
      "DO_NOTHING",
      "--tags",
      ...input.tags.map((tag) => `Key=${tag.key},Value=${tag.value}`),
      "--region",
      region,
    ]);
  } catch (error) {
    createError = error;
  }
  // Remove the 0600 bearer-URL parameter file BEFORE proceeding. A removal
  // failure is NOT swallowed (PR7-CONTROL-003): leaving a local file that holds
  // live presigned S3 bearer URLs is a real safety failure, so it fails the cell
  // — even when create-stack itself succeeded. A create error takes precedence
  // (it is the root cause); otherwise a removal error is fatal.
  let removeError: unknown;
  try {
    await paramFile.remove();
  } catch (error) {
    removeError = error;
  }
  if (createError !== undefined) {
    // Scrub in case the aws-cli echoed the file contents or a resolved URL.
    throw new Error(scrubCfnParameterUrls(`CFN: create-stack ${stackName} failed: ${errText(createError)}`));
  }
  if (removeError !== undefined) {
    throw new Error(
      scrubCfnParameterUrls(
        `CFN: failed to remove the 0600 CloudFormation parameter file "${paramFile.path}" holding presigned ` +
          `bearer URLs after create-stack ${stackName}: ${errText(removeError)}. Refusing to continue with a ` +
          "leaked bearer-URL file on disk.",
      ),
    );
  }

  try {
    await exec.run(["cloudformation", "wait", "stack-create-complete", "--stack-name", stackName, "--region", region], {
      timeoutMs: waitTimeoutMs,
    });
  } catch (error) {
    const tail = await describeStackEventsTail(exec, stackName, region).catch(() => "(stack events unavailable)");
    let diagnosticSummary = "not_requested";
    if (input.onCreateFailure) {
      try {
        const diagnostic = await input.onCreateFailure({ stackName, region, eventTail: tail });
        diagnosticSummary = summarizeCfnBootstrapDiagnostic(diagnostic);
      } catch {
        // Keep the original create failure authoritative and fail closed. The
        // fixed marker cannot leak a callback/provider/filesystem error.
        diagnosticSummary = "capture_failed";
      }
    }
    throw new Error(
      scrubCfnParameterUrls(
        `CFN: stack ${stackName} did not reach CREATE_COMPLETE (${errText(error)}). ` +
          `Recent failures: ${tail}. Bootstrap diagnostic: ${diagnosticSummary}`,
      ),
    );
  }

  const describe = await exec.run([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--output",
    "json",
  ]);
  return parseStackOutputs(describe);
}

/** Reads a bounded, secret-free tail of the stack's FAILED events. */
export async function describeStackEventsTail(exec: CfnAwsExec, stackName: string, region: string): Promise<string> {
  const raw = await exec.run([
    "cloudformation",
    "describe-stack-events",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--output",
    "json",
  ]);
  return boundedStackEventsTail(raw);
}

/** Deletes the stack (which also removes its Route53 record) and waits for completion; idempotent. */
export async function deleteCfnStackAndWait(
  exec: CfnAwsExec,
  stackName: string,
  region: string,
  options: { waitTimeoutMs?: number } = {},
): Promise<void> {
  const waitTimeoutMs = options.waitTimeoutMs ?? STACK_WAIT_TIMEOUT_MS;
  await exec.run(["cloudformation", "delete-stack", "--stack-name", stackName, "--region", region]);
  await exec.run(["cloudformation", "wait", "stack-delete-complete", "--stack-name", stackName, "--region", region], {
    timeoutMs: waitTimeoutMs,
  });
}

/**
 * Signal-safe stack cleanup: submit one exact `delete-stack`, then make one
 * bounded status observation. It never enters the ordinary 30-minute waiter.
 * A successfully submitted but still-running deletion remains unreconciled in
 * the durable ledger so the cancellation receipt is red and follow-up cleanup
 * can verify absence idempotently.
 */
export async function initiateCfnStackDeletionForCancellation(
  exec: CfnAwsExec,
  stackName: string,
  region: string,
  options: { callTimeoutMs?: number } = {},
): Promise<CfnCancellationReleaseOutcome> {
  const callTimeoutMs = options.callTimeoutMs ?? CFN_CANCELLATION_CALL_TIMEOUT_MS;
  try {
    await exec.run(
      ["cloudformation", "delete-stack", "--stack-name", stackName, "--region", region],
      { timeoutMs: callTimeoutMs },
    );
  } catch (error) {
    if (cfnStackAbsentError(error)) {
      return "reconciled";
    }
    throw new Error("CFN cancellation cleanup could not confirm that delete-stack was accepted.");
  }

  try {
    const status = (
      await exec.run(
        [
          "cloudformation",
          "describe-stacks",
          "--stack-name",
          stackName,
          "--region",
          region,
          "--query",
          "Stacks[0].StackStatus",
          "--output",
          "text",
        ],
        { timeoutMs: callTimeoutMs },
      )
    ).trim();
    return status === "DELETE_COMPLETE" ? "reconciled" : "delete_initiated";
  } catch (error) {
    return cfnStackAbsentError(error) ? "reconciled" : "delete_initiated";
  }
}

function cfnStackAbsentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:does not exist|not exist|not found)/i.test(message);
}

function ssmAuthorizationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:AccessDenied|UnauthorizedOperation|not authorized to perform)/i.test(message);
}

function ssmTargetNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:InvalidInstanceId|TargetNotConnected|not (?:in a valid state|connected|online|registered)|does not exist in the current account)/i
    .test(message);
}

/**
 * Parses the bounded `describe-stack-events` projection used when a failed
 * EC2 resource has no `describe-stack-resource` physical id. CloudFormation's
 * CreationPolicy failure event carries the signaling instance as either the
 * physical id or the exact `UniqueId i-...` token. Ambiguous projections fail
 * closed instead of selecting an instance from an earlier attempt.
 */
export function parseCfnInstanceIdEventProjection(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }

  const candidates = new Set<string>();
  for (const row of parsed) {
    if (
      !Array.isArray(row)
      || row.length !== 2
      || row.some((field) => field !== null && typeof field !== "string")
    ) {
      return null;
    }
    const physicalId = typeof row[0] === "string" ? row[0].trim() : "";
    if (/^i-[0-9a-f]+$/i.test(physicalId)) {
      candidates.add(physicalId.toLowerCase());
    }
    const reason = typeof row[1] === "string" ? row[1] : "";
    for (const match of reason.matchAll(/\bUniqueId\s+(i-[0-9a-f]+)\b/gi)) {
      candidates.add(match[1].toLowerCase());
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

async function resolveCfnBootstrapInstanceId(
  exec: CfnAwsExec,
  stackName: string,
  region: string,
): Promise<string | null> {
  try {
    const direct = (
      await exec.run(
        [
          "cloudformation",
          "describe-stack-resource",
          "--stack-name",
          stackName,
          "--logical-resource-id",
          "ProliferateInstance",
          "--region",
          region,
          "--query",
          "StackResourceDetail.PhysicalResourceId",
          "--output",
          "text",
        ],
        { timeoutMs: 15_000 },
      )
    ).trim();
    if (/^i-[0-9a-f]+$/i.test(direct)) {
      return direct.toLowerCase();
    }
  } catch {
    // A CreationPolicy failure may omit StackResourceDetail even though its
    // matching failure event retains the signaling EC2 UniqueId.
  }

  try {
    const projectedEvents = await exec.run(
      [
        "cloudformation",
        "describe-stack-events",
        "--stack-name",
        stackName,
        "--region",
        region,
        "--max-items",
        "32",
        "--query",
        "StackEvents[?LogicalResourceId=='ProliferateInstance'].[PhysicalResourceId,ResourceStatusReason]",
        "--output",
        "json",
      ],
      { timeoutMs: 15_000 },
    );
    return parseCfnInstanceIdEventProjection(projectedEvents);
  } catch {
    return null;
  }
}

// ── Failed-bootstrap SSM diagnostics (qualification only) ──────────────────

/**
 * Captures a bounded, allowlisted diagnostic from a retained CREATE_FAILED
 * stack. Every provider call and the total poll are bounded. Provider errors
 * become a fixed non-green diagnostic status; arbitrary error/output text is
 * never serialized.
 */
export async function captureCfnBootstrapDiagnostic(input: {
  exec: CfnAwsExec;
  stackName: string;
  region: string;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CfnBootstrapDiagnostic> {
  const { exec, stackName, region } = input;
  const pollTimeoutMs = input.pollTimeoutMs ?? CFN_DIAGNOSTIC_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? SSM_POLL_INTERVAL_MS;
  const now = input.now ?? Date.now;
  const sleepFn = input.sleep ?? sleep;
  const stackNameHash = createHash("sha256").update(stackName).digest("hex");

  const instanceId = await resolveCfnBootstrapInstanceId(exec, stackName, region);
  if (instanceId === null) {
    return emptyCfnBootstrapDiagnostic(stackNameHash, null, "instance_unavailable", "instance_not_found");
  }
  const instanceIdHash = createHash("sha256").update(instanceId).digest("hex");

  const deadline = now() + pollTimeoutMs;
  let commandId = "";
  do {
    try {
      const candidate = (
        await exec.run(
          [
            "ssm",
            "send-command",
            "--instance-ids",
            instanceId,
            "--document-name",
            "AWS-RunShellScript",
            "--timeout-seconds",
            String(CFN_DIAGNOSTIC_COMMAND_TIMEOUT_SECONDS),
            "--parameters",
            JSON.stringify({ commands: [CFN_DIAGNOSTIC_COMMAND] }),
            "--region",
            region,
            "--query",
            "Command.CommandId",
            "--output",
            "text",
          ],
          { timeoutMs: 15_000 },
        )
      ).trim();
      if (!candidate || candidate === "None") {
        return emptyCfnBootstrapDiagnostic(
          stackNameHash,
          instanceIdHash,
          "ssm_unavailable",
          "send_command_failed",
        );
      }
      commandId = candidate;
      break;
    } catch (error) {
      if (ssmAuthorizationError(error)) {
        return emptyCfnBootstrapDiagnostic(
          stackNameHash,
          instanceIdHash,
          "ssm_unavailable",
          "send_command_unauthorized",
        );
      }
      if (!ssmTargetNotReadyError(error)) {
        return emptyCfnBootstrapDiagnostic(
          stackNameHash,
          instanceIdHash,
          "ssm_unavailable",
          "send_command_failed",
        );
      }
    }
    if (now() >= deadline) break;
    await sleepFn(pollIntervalMs);
  } while (now() < deadline);
  if (!commandId) {
    return emptyCfnBootstrapDiagnostic(stackNameHash, instanceIdHash, "ssm_unavailable", "ssm_not_online");
  }

  let lastStatus = "Pending";
  while (now() < deadline) {
    await sleepFn(pollIntervalMs);
    let raw = "";
    try {
      raw = await exec.run(
        [
          "ssm",
          "get-command-invocation",
          "--command-id",
          commandId,
          "--instance-id",
          instanceId,
          "--region",
          region,
          "--output",
          "json",
        ],
        { timeoutMs: 15_000 },
      );
    } catch (error) {
      if (ssmAuthorizationError(error)) {
        return emptyCfnBootstrapDiagnostic(
          stackNameHash,
          instanceIdHash,
          "ssm_unavailable",
          "command_poll_unauthorized",
        );
      }
      continue;
    }
    let parsed: { Status?: unknown; StandardOutputContent?: unknown };
    try {
      parsed = JSON.parse(raw) as { Status?: unknown; StandardOutputContent?: unknown };
    } catch {
      continue;
    }
    lastStatus = typeof parsed.Status === "string" ? parsed.Status : lastStatus;
    if (lastStatus === "Success") {
      const observations = parseCfnBootstrapDiagnosticOutput(
        typeof parsed.StandardOutputContent === "string" ? parsed.StandardOutputContent : "",
      );
      if (observations.length === 0) {
        return emptyCfnBootstrapDiagnostic(
          stackNameHash,
          instanceIdHash,
          "no_allowlisted_observations",
          "no_allowlisted_observations",
          "Success",
        );
      }
      return {
        stack_name_hash: stackNameHash,
        instance_id_hash: instanceIdHash,
        capture_status: "captured",
        detail: "captured",
        ssm_status: "Success",
        observations,
      };
    }
    if (["Failed", "Cancelled", "TimedOut", "Undeliverable", "Terminated"].includes(lastStatus)) {
      return emptyCfnBootstrapDiagnostic(
        stackNameHash,
        instanceIdHash,
        "command_failed",
        "command_terminal",
        lastStatus === "TimedOut" ? "TimedOut" : "Failed",
      );
    }
  }
  return emptyCfnBootstrapDiagnostic(
    stackNameHash,
    instanceIdHash,
    "ssm_unavailable",
    "command_poll_timeout",
    "Unavailable",
  );
}

function emptyCfnBootstrapDiagnostic(
  stackNameHash: string,
  instanceIdHash: string | null,
  captureStatus: CfnBootstrapDiagnosticCaptureStatus,
  detail: CfnBootstrapDiagnostic["detail"],
  ssmStatus: CfnBootstrapDiagnostic["ssm_status"] = "Unavailable",
): CfnBootstrapDiagnostic {
  return {
    stack_name_hash: stackNameHash,
    instance_id_hash: instanceIdHash,
    capture_status: captureStatus,
    detail,
    ssm_status: ssmStatus,
    observations: [],
  };
}

// ── SSM image-digest readback (the image-digest binding proof) ───────────────

/**
 * Reads the RUNNING api container's image RepoDigest on the stack's host over
 * SSM (`aws ssm send-command` → poll `get-command-invocation`) and returns its
 * `sha256:<hex>` component. The template provisions an SSM-enabled instance role
 * (`AmazonSSMManagedInstanceCore`), so this needs no SSH/key pair. Bounded poll;
 * throws (so the caller's fallback engages) if SSM never yields a digest.
 */
export async function ssmInspectRunningImageDigest(input: {
  exec: CfnAwsExec;
  instanceId: string;
  region: string;
  pollTimeoutMs?: number;
  log?: (message: string) => void;
}): Promise<string> {
  const { exec, instanceId, region } = input;
  const pollTimeoutMs = input.pollTimeoutMs ?? SSM_POLL_TIMEOUT_MS;
  const command =
    "sudo docker inspect --format '{{index .RepoDigests 0}}' \"$(sudo docker ps -qf name=api | head -n1)\"";
  const commandId = (
    await exec.run([
      "ssm",
      "send-command",
      "--instance-ids",
      instanceId,
      "--document-name",
      "AWS-RunShellScript",
      "--parameters",
      JSON.stringify({ commands: [command] }),
      "--region",
      region,
      "--query",
      "Command.CommandId",
      "--output",
      "text",
    ])
  ).trim();
  if (!commandId || commandId === "None") {
    throw new Error("CFN: ssm send-command returned no CommandId.");
  }

  const deadline = Date.now() + pollTimeoutMs;
  let lastStatus = "Pending";
  while (Date.now() < deadline) {
    await sleep(SSM_POLL_INTERVAL_MS);
    const raw = await exec
      .run([
        "ssm",
        "get-command-invocation",
        "--command-id",
        commandId,
        "--instance-id",
        instanceId,
        "--region",
        region,
        "--output",
        "json",
      ])
      .catch(() => "");
    if (!raw) {
      continue;
    }
    let parsed: { Status?: string; StandardOutputContent?: string };
    try {
      parsed = JSON.parse(raw) as { Status?: string; StandardOutputContent?: string };
    } catch {
      continue;
    }
    lastStatus = parsed.Status ?? lastStatus;
    if (lastStatus === "Success") {
      const digest = digestSha256(parsed.StandardOutputContent ?? "");
      if (!digest) {
        throw new Error("CFN: SSM docker-inspect produced no sha256 RepoDigest.");
      }
      return digest;
    }
    if (["Failed", "Cancelled", "TimedOut", "Undeliverable", "Terminated"].includes(lastStatus)) {
      throw new Error(`CFN: SSM command reached terminal status ${lastStatus} without a digest.`);
    }
  }
  throw new Error(`CFN: SSM docker-inspect did not complete within ${pollTimeoutMs}ms (last status ${lastStatus}).`);
}

// ── CFN-posture cleanup stack (stack + S3 + GHCR + local paths) ──────────────

/**
 * The bounded, evidence-safe cleanup summary the CFN world's `close()` returns —
 * exactly the `cleanup` block of `SelfHostCfnWrapperEvidenceV1`
 * (`SelfHostCfnCleanupEvidenceBlock`). `route53RecordDeleted` RIDES the stack
 * deletion (the stack owns the record), so it equals `stackDeleted`.
 */
export interface SelfHostCfnWorldCleanupEvidence {
  ledgerIdHash: string;
  registered: number;
  reconciled: number;
  failed: number;
  stackDeleted: boolean;
  s3ObjectsDeleted: boolean;
  ghcrVersionDeleted: boolean;
  route53RecordDeleted: boolean;
  localPathsRemoved: boolean;
}

/** The CFN-posture cleanup kinds this world registers/releases. */
export type SelfHostCfnCleanupResourceKind = Extract<
  CleanupResourceKind,
  "cloudformation_stack" | "s3_object" | "ghcr_package_version" | "run_directory" | "extracted_artifacts"
>;

/**
 * Evidence-boolean categories → the kinds that satisfy them. Every category
 * needs ≥1 registered entry, all reconciled, for its boolean to be true — so an
 * incomplete/failed run can never show a fully-clean summary (mirrors the EC2
 * world's `SELFHOST_EVIDENCE_CATEGORIES` discipline). `route53RecordDeleted` is
 * NOT a category here: the record is stack-owned and its flag equals
 * `stackDeleted` (set after the run).
 */
export const SELFHOST_CFN_EVIDENCE_CATEGORIES = {
  stackDeleted: ["cloudformation_stack"],
  s3ObjectsDeleted: ["s3_object"],
  ghcrVersionDeleted: ["ghcr_package_version"],
  localPathsRemoved: ["run_directory", "extracted_artifacts"],
} satisfies Record<string, SelfHostCfnCleanupResourceKind[]>;

interface CfnCleanupRegistration {
  entryId: string;
  kind: SelfHostCfnCleanupResourceKind;
  release: () => Promise<void>;
  cancellationRelease?: () => Promise<CfnCancellationReleaseOutcome>;
}

/**
 * Accumulates reverse-order releasers backed by the durable ledger. Deletion
 * order: the stack tears down FIRST (releasing its EC2 host + Route53 record),
 * then the GHCR version and S3 objects the box no longer needs, then the local
 * materialized paths LAST — so registration order is local paths → S3 → GHCR →
 * stack. Like the EC2 stack, `runAll` never throws for an individual failure; it
 * counts them and preserves the `run_directory` releaser when any earlier
 * releaser failed so replay-by-run still has the ledger.
 */
export class SelfHostCfnCleanupStack {
  private readonly ledger: CleanupLedger;
  private readonly log: (message: string) => void;
  private readonly registrations: CfnCleanupRegistration[] = [];
  /**
   * Optional post-delete observation that the stack-owned Route53 A record is
   * actually gone (PR7-CONTROL-008): `route53RecordDeleted` no longer merely
   * equates to `stackDeleted` — when this is supplied, the record must be
   * OBSERVED absent for the flag to be true. Absent (unit tests) → the flag
   * falls back to `stackDeleted`, the prior behavior.
   */
  private readonly observeRoute53RecordAbsent?: () => Promise<boolean>;

  constructor(options: {
    ledger: CleanupLedger;
    log?: (message: string) => void;
    observeRoute53RecordAbsent?: () => Promise<boolean>;
  }) {
    this.ledger = options.ledger;
    this.log = options.log ?? (() => undefined);
    this.observeRoute53RecordAbsent = options.observeRoute53RecordAbsent;
  }

  /** Writes an `intent` record and returns the entry id to acquire. */
  async register(
    kind: SelfHostCfnCleanupResourceKind,
    release: () => Promise<void>,
    cancellationRelease?: () => Promise<CfnCancellationReleaseOutcome>,
  ): Promise<string> {
    const entryId = randomUUID();
    await this.ledger.registerIntent(kind, entryId);
    this.registrations.push({ entryId, kind, release, cancellationRelease });
    return entryId;
  }

  /** Marks a registered resource acquired with its safe provider identity. */
  async acquired(entryId: string, providerId: string): Promise<void> {
    await this.ledger.markAcquired(entryId, providerId);
  }

  /** register + acquire in one step (the registered-before-create callback shape). */
  async registerAcquire(
    kind: SelfHostCfnCleanupResourceKind,
    providerId: string,
    release: () => Promise<void>,
    cancellationRelease?: () => Promise<CfnCancellationReleaseOutcome>,
  ): Promise<void> {
    const entryId = await this.register(kind, release, cancellationRelease);
    await this.acquired(entryId, providerId);
  }

  /**
   * Releases every acquired resource in reverse registration order, marking each
   * reconciled, and returns the bounded evidence summary. Never throws for an
   * individual failure.
   */
  async runAll(): Promise<SelfHostCfnWorldCleanupEvidence> {
    const succeeded = new Set<string>();
    let failed = 0;
    for (const registration of [...this.registrations].reverse()) {
      if (registration.kind === "run_directory" && failed > 0) {
        failed += 1;
        this.log(
          `cleanup releaser for run_directory skipped: ${failed - 1} earlier releaser(s) failed this run; ` +
            `preserving the run directory and cleanup ledger for replay-by-run`,
        );
        continue;
      }
      try {
        await registration.release();
        succeeded.add(registration.entryId);
        await this.ledger.markReconciled(registration.entryId).catch(() => undefined);
      } catch (error) {
        failed += 1;
        this.log(
          `cleanup releaser for ${registration.kind} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const stackDeleted = this.categoryClean("stackDeleted", succeeded);
    // The Route53 A record is stack-owned (CreateRoute53Record=true), so its
    // deletion RIDES delete-stack — but "the stack deleted" is not proof the
    // record is gone (a partial rollback / retained resource could leave it).
    // When an observer is supplied, require the record be OBSERVED absent; a
    // survivor (or a failed observation) makes route53RecordDeleted false
    // (PR7-CONTROL-008). Without an observer (unit tests) fall back to
    // stackDeleted.
    let route53RecordDeleted = stackDeleted;
    if (stackDeleted && this.observeRoute53RecordAbsent) {
      try {
        route53RecordDeleted = await this.observeRoute53RecordAbsent();
        if (!route53RecordDeleted) {
          this.log("route53 A record survived stack deletion — marking route53RecordDeleted=false");
        }
      } catch (error) {
        route53RecordDeleted = false;
        this.log(
          `route53 survivor check failed (${error instanceof Error ? error.message : String(error)}); ` +
            "marking route53RecordDeleted=false",
        );
      }
    }
    return {
      ledgerIdHash: hashLedgerId(this.ledger.ledgerId),
      registered: this.registrations.length,
      reconciled: succeeded.size,
      failed,
      stackDeleted,
      s3ObjectsDeleted: this.categoryClean("s3ObjectsDeleted", succeeded),
      ghcrVersionDeleted: this.categoryClean("ghcrVersionDeleted", succeeded),
      route53RecordDeleted,
      localPathsRemoved: this.categoryClean("localPathsRemoved", succeeded),
    };
  }

  /**
   * Bounded SIGINT/SIGTERM posture. Only the stack has a signal-specific
   * releaser: submit its exact delete request and observe once, leaving every
   * unverified/deferred entry acquired. The run directory and ledger therefore
   * survive for upload and replay, and the returned summary stays red until an
   * observed-absent follow-up performs ordinary reconciliation.
   */
  async runForCancellation(): Promise<SelfHostCfnWorldCleanupEvidence> {
    const succeeded = new Set<string>();
    let failed = this.registrations.length;
    for (const registration of [...this.registrations].reverse()) {
      if (registration.kind !== "cloudformation_stack") {
        continue;
      }
      if (!registration.cancellationRelease) {
        this.log("CFN cancellation cleanup has no bounded stack releaser; preserving durable custody");
        continue;
      }
      try {
        const outcome = await registration.cancellationRelease();
        if (outcome !== "reconciled") {
          this.log("CFN cancellation delete was initiated but absence is not yet proven; preserving durable custody");
          continue;
        }
        try {
          await this.ledger.markReconciled(registration.entryId);
          succeeded.add(registration.entryId);
          failed -= 1;
        } catch {
          this.log("CFN cancellation observed stack absence but could not persist reconciliation; preserving custody");
        }
      } catch {
        this.log("CFN cancellation delete initiation failed; preserving durable custody");
      }
    }
    return {
      ledgerIdHash: hashLedgerId(this.ledger.ledgerId),
      registered: this.registrations.length,
      reconciled: succeeded.size,
      failed,
      stackDeleted: this.categoryClean("stackDeleted", succeeded),
      s3ObjectsDeleted: false,
      ghcrVersionDeleted: false,
      // Signal cleanup intentionally avoids an extra Route53 provider call.
      // Even observed stack absence remains fail-closed for DNS until replay.
      route53RecordDeleted: false,
      localPathsRemoved: false,
    };
  }

  private categoryClean(
    category: keyof typeof SELFHOST_CFN_EVIDENCE_CATEGORIES,
    succeeded: ReadonlySet<string>,
  ): boolean {
    const kinds = new Set<SelfHostCfnCleanupResourceKind>(SELFHOST_CFN_EVIDENCE_CATEGORIES[category]);
    const inCategory = this.registrations.filter((registration) => kinds.has(registration.kind));
    if (inCategory.length === 0) {
      return false;
    }
    return inCategory.every((registration) => succeeded.has(registration.entryId));
  }
}

// ── Defaults + small utilities ───────────────────────────────────────────────

const execFileAsync = promisify(execFile);

/** Real `aws` seam (never used in unit tests; credentials stay ambient). */
export const defaultCfnAwsExec: CfnAwsExec = {
  async run(args, options) {
    const { stdout } = await execFileAsync("aws", [...args], {
      timeout: options?.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString();
  },
};

/** Real `docker` seam. */
export const defaultDockerExec: DockerExec = {
  async run(args, options) {
    const { stdout } = await execFileAsync("docker", [...args], {
      timeout: options?.timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.toString();
  },
};

/** Real `gh` seam. */
export const defaultGhExec: GhExec = {
  async run(args, options) {
    const { stdout } = await execFileAsync("gh", [...args], {
      timeout: options?.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString();
  },
};

function assertNotRollingTag(tag: string): void {
  const lower = tag.trim().toLowerCase();
  if (lower === "stable" || lower === "latest") {
    throw new Error(`CFN: refusing to push the candidate image to a rolling tag ("${tag}").`);
  }
}

function isGhNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 404|Not Found|could not find/i.test(message);
}

/**
 * Splits a `gh api --paginate` payload into its concatenated top-level JSON
 * arrays by tracking bracket depth OUTSIDE of strings (JSON strings may contain
 * brackets or spaces). The common single-array case yields exactly one chunk.
 */
function topLevelJsonArrays(raw: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "[") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
