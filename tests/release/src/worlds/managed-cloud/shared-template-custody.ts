import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { BakedInputDigest, E2bTemplateReceipt } from "./template.js";

export const SHARED_TEMPLATE_CUSTODY_FILENAME = "shared-e2b-template-custody.json";
export const SHARED_TEMPLATE_CUSTODY_KIND = "proliferate.managed-cloud-shared-template-custody" as const;

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const SAFE_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HOME_USER_PREFIX = "/home/user/";

export class SharedTemplateCustodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedTemplateCustodyError";
  }
}

export interface SharedTemplateCustodyIdentityV1 {
  runId: string;
  shardId: string;
  sourceSha: string;
  templateName: string;
  inputHash: string;
}

interface SharedTemplateCustodyBaseV1 {
  schema_version: 1;
  kind: typeof SHARED_TEMPLATE_CUSTODY_KIND;
  run_id: string;
  shard_id: string;
  source_sha: string;
  template_name: string;
  input_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SharedTemplateIntentCustodyV1 extends SharedTemplateCustodyBaseV1 {
  state: "intent";
  receipt: null;
  released_at: null;
}

export interface SharedTemplateAcquiredCustodyV1 extends SharedTemplateCustodyBaseV1 {
  state: "acquired";
  receipt: E2bTemplateReceipt;
  released_at: null;
}

export interface SharedTemplateReleasedCustodyV1 extends SharedTemplateCustodyBaseV1 {
  state: "released";
  receipt: E2bTemplateReceipt | null;
  released_at: string;
}

export type SharedTemplateCustodyV1 =
  | SharedTemplateIntentCustodyV1
  | SharedTemplateAcquiredCustodyV1
  | SharedTemplateReleasedCustodyV1;

export interface SharedTemplateCustodyClock {
  now(): Date;
}

const WALL_CLOCK: SharedTemplateCustodyClock = { now: () => new Date() };

export function sharedTemplateCustodyPath(parentRunDir: string): string {
  return path.join(parentRunDir, "cleanup-custody", SHARED_TEMPLATE_CUSTODY_FILENAME);
}

/**
 * Persists the pre-create intent. Repeated calls with the same identity are
 * idempotent, but a released identity cannot be reopened or overwritten.
 */
export async function recordSharedTemplateIntent(
  filePath: string,
  identity: SharedTemplateCustodyIdentityV1,
  clock: SharedTemplateCustodyClock = WALL_CLOCK,
): Promise<SharedTemplateCustodyV1> {
  validateIdentity(identity);
  const existing = await loadIfPresent(filePath);
  if (existing) {
    assertSharedTemplateCustodyIdentity(existing, identity);
    if (existing.state === "released") {
      throw new SharedTemplateCustodyError("A released shared-template custody record cannot be reopened.");
    }
    return existing;
  }

  const stamp = timestamp(clock);
  const created: SharedTemplateIntentCustodyV1 = {
    schema_version: 1,
    kind: SHARED_TEMPLATE_CUSTODY_KIND,
    run_id: identity.runId,
    shard_id: identity.shardId,
    source_sha: identity.sourceSha,
    template_name: identity.templateName,
    input_hash: identity.inputHash,
    state: "intent",
    created_at: stamp,
    updated_at: stamp,
    receipt: null,
    released_at: null,
  };
  await writeAtomic0600(filePath, created);
  return created;
}

export async function markSharedTemplateAcquired(
  filePath: string,
  identity: SharedTemplateCustodyIdentityV1,
  receipt: E2bTemplateReceipt,
  clock: SharedTemplateCustodyClock = WALL_CLOCK,
): Promise<SharedTemplateAcquiredCustodyV1> {
  const current = await loadSharedTemplateCustody(filePath, identity);
  assertSharedTemplateReceiptBinding(identity, receipt);

  if (current.state === "released") {
    throw new SharedTemplateCustodyError("A released shared-template custody record cannot be reacquired.");
  }
  if (current.state === "acquired") {
    if (!sameReceipt(current.receipt, receipt)) {
      throw new SharedTemplateCustodyError("Shared-template custody is already acquired with a different receipt.");
    }
    return current;
  }

  const acquired: SharedTemplateAcquiredCustodyV1 = {
    ...current,
    state: "acquired",
    updated_at: timestamp(clock),
    receipt: cloneReceipt(receipt),
    released_at: null,
  };
  validateChronology(acquired);
  await writeAtomic0600(filePath, acquired);
  return acquired;
}

/**
 * Marks an acquired template released after the caller has deleted it and
 * independently verified provider absence. The expected receipt prevents a
 * stale cleanup executor from releasing a newer immutable template.
 */
export async function markSharedTemplateReleased(
  filePath: string,
  identity: SharedTemplateCustodyIdentityV1,
  expectedReceipt: E2bTemplateReceipt,
  clock: SharedTemplateCustodyClock = WALL_CLOCK,
): Promise<SharedTemplateReleasedCustodyV1> {
  const current = await loadSharedTemplateCustody(filePath, identity);
  assertSharedTemplateReceiptBinding(identity, expectedReceipt);

  if (current.state === "intent") {
    throw new SharedTemplateCustodyError(
      "Intent-only custody cannot be released as an acquired template; prove no provider create separately.",
    );
  }
  if (!current.receipt || !sameReceipt(current.receipt, expectedReceipt)) {
    throw new SharedTemplateCustodyError("The release receipt does not match the custody record.");
  }
  if (current.state === "released") {
    return current;
  }

  const stamp = timestamp(clock);
  const released: SharedTemplateReleasedCustodyV1 = {
    ...current,
    state: "released",
    updated_at: stamp,
    receipt: cloneReceipt(current.receipt),
    released_at: stamp,
  };
  validateChronology(released);
  await writeAtomic0600(filePath, released);
  return released;
}

/**
 * Resolves intent → released only after the caller exhaustively proved that no
 * provider template was accepted. Kept separate so an acquired id can never be
 * discarded accidentally.
 */
export async function markSharedTemplateIntentReleasedWithoutAcquire(
  filePath: string,
  identity: SharedTemplateCustodyIdentityV1,
  clock: SharedTemplateCustodyClock = WALL_CLOCK,
): Promise<SharedTemplateReleasedCustodyV1> {
  const current = await loadSharedTemplateCustody(filePath, identity);
  if (current.state === "acquired") {
    throw new SharedTemplateCustodyError("Acquired custody must be released with its exact receipt.");
  }
  if (current.state === "released") {
    if (current.receipt !== null) {
      throw new SharedTemplateCustodyError("Released acquired custody cannot become an intent-only release.");
    }
    return current;
  }

  const stamp = timestamp(clock);
  const released: SharedTemplateReleasedCustodyV1 = {
    ...current,
    state: "released",
    updated_at: stamp,
    receipt: null,
    released_at: stamp,
  };
  validateChronology(released);
  await writeAtomic0600(filePath, released);
  return released;
}

export async function loadSharedTemplateCustody(
  filePath: string,
  expectedIdentity?: SharedTemplateCustodyIdentityV1,
): Promise<SharedTemplateCustodyV1> {
  const stats = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    throw new SharedTemplateCustodyError(
      error.code === "ENOENT" ? "Shared-template custody record does not exist." : "Cannot stat custody record.",
    );
  });
  if (!stats.isFile()) {
    throw new SharedTemplateCustodyError("Shared-template custody record must be a regular file.");
  }
  if ((stats.mode & 0o777) !== 0o600) {
    throw new SharedTemplateCustodyError("Shared-template custody record must have mode 0600.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new SharedTemplateCustodyError(
      error instanceof SyntaxError ? "Shared-template custody record is not valid JSON." : "Cannot read custody record.",
    );
  }
  const custody = validateDocument(parsed);
  if (expectedIdentity) {
    assertSharedTemplateCustodyIdentity(custody, expectedIdentity);
  }
  return custody;
}

export function assertSharedTemplateCustodyIdentity(
  custody: SharedTemplateCustodyV1,
  expected: SharedTemplateCustodyIdentityV1,
): void {
  validateIdentity(expected);
  const mismatches = [
    custody.run_id === expected.runId ? null : "run_id",
    custody.shard_id === expected.shardId ? null : "shard_id",
    custody.source_sha === expected.sourceSha ? null : "source_sha",
    custody.template_name === expected.templateName ? null : "template_name",
    custody.input_hash === expected.inputHash ? null : "input_hash",
  ].filter((field): field is string => field !== null);
  if (mismatches.length > 0) {
    throw new SharedTemplateCustodyError(
      `Shared-template custody does not belong to this run (${mismatches.join(", ")} mismatch).`,
    );
  }
}

export function assertSharedTemplateReceiptBinding(
  identity: SharedTemplateCustodyIdentityV1,
  receipt: E2bTemplateReceipt,
): void {
  validateIdentity(identity);
  validateReceipt(receipt);
  if (receipt.artifact_id !== `e2b-template/${identity.templateName}`) {
    throw new SharedTemplateCustodyError("Shared-template receipt artifact_id does not match template_name.");
  }
  if (receipt.inputHash !== identity.inputHash) {
    throw new SharedTemplateCustodyError("Shared-template receipt inputHash does not match the intent input hash.");
  }
}

/** Proves the producer durably handed off this exact immutable receipt. */
export function assertSharedTemplateCustodyAcquired(
  custody: SharedTemplateCustodyV1,
  expectedReceipt: E2bTemplateReceipt,
): asserts custody is SharedTemplateAcquiredCustodyV1 {
  if (custody.state !== "acquired" || !sameReceipt(custody.receipt, expectedReceipt)) {
    throw new SharedTemplateCustodyError(
      "Shared-template producer custody is not acquired with the exact emitted receipt.",
    );
  }
}

async function loadIfPresent(filePath: string): Promise<SharedTemplateCustodyV1 | null> {
  try {
    await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return loadSharedTemplateCustody(filePath);
}

async function writeAtomic0600(filePath: string, custody: SharedTemplateCustodyV1): Promise<void> {
  validateDocument(custody);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tmp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(custody, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(tmp, 0o600);
    await rename(tmp, filePath);
    await chmod(filePath, 0o600);
    const dirHandle = await open(dir, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

function validateDocument(value: unknown): SharedTemplateCustodyV1 {
  const row = requireRecord(value, "custody");
  requireExactKeys(
    row,
    [
      "schema_version", "kind", "run_id", "shard_id", "source_sha", "template_name",
      "input_hash", "state", "created_at", "updated_at", "receipt", "released_at",
    ],
    "custody",
  );
  if (row.schema_version !== 1 || row.kind !== SHARED_TEMPLATE_CUSTODY_KIND) {
    throw new SharedTemplateCustodyError("Unsupported shared-template custody schema or kind.");
  }
  const identity: SharedTemplateCustodyIdentityV1 = {
    runId: requireString(row.run_id, "custody.run_id"),
    shardId: requireString(row.shard_id, "custody.shard_id"),
    sourceSha: requireString(row.source_sha, "custody.source_sha"),
    templateName: requireString(row.template_name, "custody.template_name"),
    inputHash: requireString(row.input_hash, "custody.input_hash"),
  };
  validateIdentity(identity);
  const createdAt = requireTimestamp(row.created_at, "custody.created_at");
  const updatedAt = requireTimestamp(row.updated_at, "custody.updated_at");
  const base: SharedTemplateCustodyBaseV1 = {
    schema_version: 1,
    kind: SHARED_TEMPLATE_CUSTODY_KIND,
    run_id: identity.runId,
    shard_id: identity.shardId,
    source_sha: identity.sourceSha,
    template_name: identity.templateName,
    input_hash: identity.inputHash,
    created_at: createdAt,
    updated_at: updatedAt,
  };

  let custody: SharedTemplateCustodyV1;
  if (row.state === "intent") {
    if (row.receipt !== null || row.released_at !== null) {
      throw new SharedTemplateCustodyError("Intent custody must have null receipt and released_at.");
    }
    custody = { ...base, state: "intent", receipt: null, released_at: null };
  } else if (row.state === "acquired") {
    if (row.released_at !== null) {
      throw new SharedTemplateCustodyError("Acquired custody must have null released_at.");
    }
    const receipt = validateReceipt(row.receipt);
    assertSharedTemplateReceiptBinding(identity, receipt);
    custody = { ...base, state: "acquired", receipt, released_at: null };
  } else if (row.state === "released") {
    const receipt = row.receipt === null ? null : validateReceipt(row.receipt);
    if (receipt) {
      assertSharedTemplateReceiptBinding(identity, receipt);
    }
    custody = {
      ...base,
      state: "released",
      receipt,
      released_at: requireTimestamp(row.released_at, "custody.released_at"),
    };
  } else {
    throw new SharedTemplateCustodyError("custody.state must be intent, acquired, or released.");
  }
  validateChronology(custody);
  return custody;
}

function validateReceipt(value: unknown): E2bTemplateReceipt {
  const row = requireRecord(value, "custody.receipt");
  requireExactKeys(row, ["artifact_id", "templateId", "buildId", "inputHash", "bakedInputs"], "custody.receipt");
  const artifactId = requireString(row.artifact_id, "custody.receipt.artifact_id");
  const templateId = requireSafeProviderId(row.templateId, "custody.receipt.templateId");
  const buildId = requireSafeProviderId(row.buildId, "custody.receipt.buildId");
  const inputHash = requireSha256(row.inputHash, "custody.receipt.inputHash");
  if (!Array.isArray(row.bakedInputs) || row.bakedInputs.length === 0 || row.bakedInputs.length > 64) {
    throw new SharedTemplateCustodyError("custody.receipt.bakedInputs must contain 1..64 entries.");
  }
  const seen = new Set<string>();
  const bakedInputs = row.bakedInputs.map((entry, index): BakedInputDigest => {
    const baked = requireRecord(entry, `custody.receipt.bakedInputs[${index}]`);
    requireExactKeys(baked, ["destination", "sha256"], `custody.receipt.bakedInputs[${index}]`);
    const destination = requireString(baked.destination, `custody.receipt.bakedInputs[${index}].destination`);
    if (!destination.startsWith(HOME_USER_PREFIX) || destination.length > 512 || seen.has(destination)) {
      throw new SharedTemplateCustodyError("Receipt baked-input destinations must be unique paths under /home/user/.");
    }
    seen.add(destination);
    return { destination, sha256: requireSha256(baked.sha256, `custody.receipt.bakedInputs[${index}].sha256`) };
  });
  return { artifact_id: artifactId, templateId, buildId, inputHash, bakedInputs };
}

function validateIdentity(identity: SharedTemplateCustodyIdentityV1): void {
  if (!SAFE_ID_PATTERN.test(identity.runId) || !SAFE_ID_PATTERN.test(identity.shardId)) {
    throw new SharedTemplateCustodyError("Shared-template runId/shardId are not safe bounded identifiers.");
  }
  if (!FULL_SHA_PATTERN.test(identity.sourceSha)) {
    throw new SharedTemplateCustodyError("Shared-template sourceSha must be a lowercase 40-hex SHA.");
  }
  if (!SAFE_TEMPLATE_NAME_PATTERN.test(identity.templateName)) {
    throw new SharedTemplateCustodyError("Shared-template templateName is not a safe bounded provider name.");
  }
  if (identity.templateName !== `proliferate-runtime-qual-${identity.runId}`) {
    throw new SharedTemplateCustodyError(
      "Shared-template templateName must be the exact run-derived qualification template name.",
    );
  }
  if (!SHA256_PATTERN.test(identity.inputHash)) {
    throw new SharedTemplateCustodyError("Shared-template inputHash must be a lowercase 64-hex SHA-256.");
  }
}

function validateChronology(custody: SharedTemplateCustodyV1): void {
  const created = Date.parse(custody.created_at);
  const updated = Date.parse(custody.updated_at);
  if (updated < created) {
    throw new SharedTemplateCustodyError("custody.updated_at cannot precede created_at.");
  }
  if (custody.state === "released" && Date.parse(custody.released_at) < updated) {
    throw new SharedTemplateCustodyError("custody.released_at cannot precede updated_at.");
  }
}

function timestamp(clock: SharedTemplateCustodyClock): string {
  const date = clock.now();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new SharedTemplateCustodyError("Custody clock returned an invalid date.");
  }
  return date.toISOString();
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SharedTemplateCustodyError(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(row: Record<string, unknown>, expected: readonly string[], where: string): void {
  const expectedSet = new Set(expected);
  const extras = Object.keys(row).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => !(key in row));
  if (extras.length > 0 || missing.length > 0) {
    throw new SharedTemplateCustodyError(
      `${where} has invalid keys (missing: ${missing.join(", ") || "none"}; extra: ${extras.join(", ") || "none"}).`,
    );
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SharedTemplateCustodyError(`${where} must be a non-empty string.`);
  }
  return value;
}

function requireTimestamp(value: unknown, where: string): string {
  const text = requireString(value, where);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== text) {
    throw new SharedTemplateCustodyError(`${where} must be a canonical ISO-8601 timestamp.`);
  }
  return text;
}

function requireSafeProviderId(value: unknown, where: string): string {
  const text = requireString(value, where);
  if (!SAFE_PROVIDER_ID_PATTERN.test(text)) {
    throw new SharedTemplateCustodyError(`${where} is not a safe bounded provider identifier.`);
  }
  return text;
}

function requireSha256(value: unknown, where: string): string {
  const text = requireString(value, where);
  if (!SHA256_PATTERN.test(text)) {
    throw new SharedTemplateCustodyError(`${where} must be a lowercase 64-hex SHA-256.`);
  }
  return text;
}

function sameReceipt(left: E2bTemplateReceipt, right: E2bTemplateReceipt): boolean {
  return (
    left.artifact_id === right.artifact_id &&
    left.templateId === right.templateId &&
    left.buildId === right.buildId &&
    left.inputHash === right.inputHash &&
    left.bakedInputs.length === right.bakedInputs.length &&
    left.bakedInputs.every(
      (entry, index) =>
        entry.destination === right.bakedInputs[index]?.destination &&
        entry.sha256 === right.bakedInputs[index]?.sha256,
    )
  );
}

function cloneReceipt(receipt: E2bTemplateReceipt): E2bTemplateReceipt {
  return {
    ...receipt,
    bakedInputs: receipt.bakedInputs.map((entry) => ({ ...entry })),
  };
}
