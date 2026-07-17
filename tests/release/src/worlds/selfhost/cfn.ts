import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  hashLedgerId,
  type CleanupLedger,
  type CleanupResourceKind,
} from "../local-workspace/cleanup-ledger.js";
import { randomUUID } from "node:crypto";

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
) => Promise<void>;

/** The owned Route53 zone the run subdomain lives under (matches `dns.ts`). */
export const QUALIFICATION_ZONE = "qualification.proliferate.com";
/** Presigned-URL lifetime: long enough for a bounded stack bootstrap, no longer. */
export const PRESIGN_EXPIRY_SECONDS = 3600;
/** Bounded stack create/delete wait (a t4g bootstrap has a PT20M CreationPolicy). */
export const STACK_WAIT_TIMEOUT_MS = 30 * 60_000;
/** Bounded describe-stack-events tail on a create failure. */
export const MAX_STACK_EVENT_TAIL = 8;
const MAX_EVENT_REASON_CHARS = 240;
/** Bounded SSM command poll (docker-inspect the running api image RepoDigest). */
export const SSM_POLL_TIMEOUT_MS = 120_000;
const SSM_POLL_INTERVAL_MS = 3_000;

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
 * (PR7-CONTROL-003). The two DeployBundle values are presigned S3 URLs carrying
 * a bearer signature (`X-Amz-*`); keeping them out of argv keeps them out of the
 * process table, shell history, and any argv-echoing error. NoEcho template
 * params (Postgres/JWT/CloudSecret) are left to the template's auto-generate
 * default and never supplied here. Pure so param construction is asserted offline.
 */
export function buildCfnParameters(input: {
  releaseVersion: string;
  serverImageRepository: string;
  deployBundleUrl: string;
  deployBundleChecksumUrl: string;
  siteAddress: string;
  hostedZoneId: string;
}): CfnParameter[] {
  return [
    { ParameterKey: "ReleaseVersion", ParameterValue: input.releaseVersion },
    { ParameterKey: "ServerImageRepository", ParameterValue: input.serverImageRepository },
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
  const want = candidateBundleSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) {
    return false;
  }
  for (const line of sumsContent.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (!match) {
      continue;
    }
    const [, sha, name] = match;
    if (sha.toLowerCase() === want && /(^|\/)proliferate-deploy\.tar\.gz$/.test(name.trim())) {
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

// ── S3 upload / presign ─────────────────────────────────────────────────────

/**
 * Uploads the candidate deploy bundle + its SHA256SUMS to the run-scoped S3
 * prefix and returns presigned (bounded-expiry) GET URLs for each. Registers an
 * `s3_object` cleanup intent BEFORE each `s3 cp` (registered-before-create), so
 * an interrupted run always has a durable delete releaser.
 */
export async function uploadBundleAndPresign(input: {
  exec: CfnAwsExec;
  region: string;
  bucket: string;
  keyPrefix: string;
  bundlePath: string;
  sumsPath: string;
  expirySeconds?: number;
  registerCleanup: RegisterCfnCleanup;
  timeoutMs?: number;
  log?: (message: string) => void;
}): Promise<{ deployBundleUrl: string; deployBundleChecksumUrl: string; bundleKey: string; sumsKey: string }> {
  const { exec, region, bucket, keyPrefix } = input;
  const log = input.log ?? (() => undefined);
  const expiry = input.expirySeconds ?? PRESIGN_EXPIRY_SECONDS;
  const bundleKey = `${keyPrefix}proliferate-deploy.tar.gz`;
  const sumsKey = `${keyPrefix}self-hosted-assets.SHA256SUMS`;

  await input.registerCleanup("s3_object", `s3://${bucket}/${bundleKey}`, () =>
    deleteS3Object(exec, region, bucket, bundleKey),
  );
  log(`s3 cp bundle -> s3://${bucket}/${bundleKey}`);
  await exec.run(["s3", "cp", input.bundlePath, `s3://${bucket}/${bundleKey}`, "--region", region], {
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
  const deployBundleChecksumUrl = (
    await exec.run(["s3", "presign", `s3://${bucket}/${sumsKey}`, "--expires-in", String(expiry), "--region", region])
  ).trim();
  if (!deployBundleUrl || !deployBundleChecksumUrl) {
    throw new Error("CFN: aws s3 presign returned an empty URL.");
  }
  return { deployBundleUrl, deployBundleChecksumUrl, bundleKey, sumsKey };
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
 * the parsed Outputs. On a create failure it appends a bounded, secret-free
 * `describe-stack-events` tail to the thrown error. The Route53 record is
 * stack-owned (`CreateRoute53Record=true`), so its deletion rides `delete-stack`.
 */
export async function createCfnStackAndWait(input: {
  exec: CfnAwsExec;
  stackName: string;
  templatePath: string;
  parameters: readonly CfnParameter[];
  region: string;
  registerCleanup: RegisterCfnCleanup;
  /**
   * Writes the parameter JSON to a permission-restricted (0600) local file and
   * returns its path + a cleanup handle. Injected so unit tests never touch
   * disk; the production impl (`tmpParameterFileIo`) uses mkdtemp + 0600.
   */
  writeParameterFile: (json: string) => Promise<{ path: string; remove: () => Promise<void> }>;
  waitTimeoutMs?: number;
  log?: (message: string) => void;
}): Promise<CfnStackOutputs> {
  const { exec, stackName, region } = input;
  const log = input.log ?? (() => undefined);
  const waitTimeoutMs = input.waitTimeoutMs ?? STACK_WAIT_TIMEOUT_MS;

  await input.registerCleanup("cloudformation_stack", stackName, () =>
    deleteCfnStackAndWait(exec, stackName, region, { waitTimeoutMs }),
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
    throw new Error(
      scrubCfnParameterUrls(
        `CFN: stack ${stackName} did not reach CREATE_COMPLETE (${errText(error)}). Recent failures: ${tail}`,
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
  async register(kind: SelfHostCfnCleanupResourceKind, release: () => Promise<void>): Promise<string> {
    const entryId = randomUUID();
    await this.ledger.registerIntent(kind, entryId);
    this.registrations.push({ entryId, kind, release });
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
  ): Promise<void> {
    const entryId = await this.register(kind, release);
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
