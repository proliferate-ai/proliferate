import {
  canonicalQueueJson,
  QueueCanonicalError,
  queueUtf8Bytes,
  sha256QueueText,
} from "./support-report-queue-canonical";

export const SUPPORT_QUEUE_SCHEMA_VERSION = 2 as const;
export const SUPPORT_QUEUE_MAX_JOBS = 10;
export const SUPPORT_QUEUE_DOCUMENT_MAX_BYTES = 2_097_152;
const SUPPORT_QUEUE_JOURNAL_OVERHEAD_BYTES = 128;
const LOWER_SHA256 = /^[0-9a-f]{64}$/;

export interface SupportQueueDocumentV2<TJob> {
  schemaVersion: typeof SUPPORT_QUEUE_SCHEMA_VERSION;
  revision: number;
  jobs: TJob[];
  documentSha256: string;
}

export interface SupportQueueJournalV2<TJob> {
  schemaVersion: typeof SUPPORT_QUEUE_SCHEMA_VERSION;
  target: SupportQueueDocumentV2<TJob>;
}

export type SupportQueueJobParser<TJob> = (value: unknown, index: number) => TJob;

export type SupportQueueDocumentFailure =
  | "bytes_exceeded"
  | "hash_invalid"
  | "jobs_exceeded"
  | "noncanonical"
  | "parse_failed"
  | "revision_exhausted"
  | "shape_invalid";

export class SupportQueueDocumentError extends Error {
  readonly failure: SupportQueueDocumentFailure;

  constructor(failure: SupportQueueDocumentFailure) {
    super(`Support queue document is invalid: ${failure}.`);
    this.name = "SupportQueueDocumentError";
    this.failure = failure;
  }
}

export async function createSupportQueueDocument<TJob>(
  revision: number,
  jobs: readonly TJob[],
): Promise<SupportQueueDocumentV2<TJob>> {
  validateRevision(revision);
  if (jobs.length > SUPPORT_QUEUE_MAX_JOBS) {
    throw new SupportQueueDocumentError("jobs_exceeded");
  }
  const hashInput = {
    schemaVersion: SUPPORT_QUEUE_SCHEMA_VERSION,
    revision,
    jobs: [...jobs],
  };
  let hashBytes: string;
  try {
    hashBytes = canonicalQueueJson(hashInput);
  } catch (error) {
    throw mapCanonicalError(error);
  }
  const document: SupportQueueDocumentV2<TJob> = {
    ...hashInput,
    documentSha256: await sha256QueueText(hashBytes),
  };
  encodeSupportQueueDocument(document);
  return document;
}

export async function createNextSupportQueueDocument<TJob>(
  current: SupportQueueDocumentV2<TJob>,
  jobs: readonly TJob[],
): Promise<SupportQueueDocumentV2<TJob>> {
  if (current.revision >= Number.MAX_SAFE_INTEGER) {
    throw new SupportQueueDocumentError("revision_exhausted");
  }
  return createSupportQueueDocument(current.revision + 1, jobs);
}

export function encodeSupportQueueDocument<TJob>(
  document: SupportQueueDocumentV2<TJob>,
): string {
  let encoded: string;
  try {
    encoded = canonicalQueueJson(document);
  } catch (error) {
    throw mapCanonicalError(error);
  }
  if (queueUtf8Bytes(encoded) > SUPPORT_QUEUE_DOCUMENT_MAX_BYTES) {
    throw new SupportQueueDocumentError("bytes_exceeded");
  }
  return encoded;
}

export async function parseSupportQueueDocument<TJob>(
  raw: string,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueDocumentV2<TJob>> {
  if (queueUtf8Bytes(raw) > SUPPORT_QUEUE_DOCUMENT_MAX_BYTES) {
    throw new SupportQueueDocumentError("bytes_exceeded");
  }
  const parsed = parseCanonicalRaw(raw);
  const record = exactRecord(parsed, ["documentSha256", "jobs", "revision", "schemaVersion"]);
  if (record.schemaVersion !== SUPPORT_QUEUE_SCHEMA_VERSION
    || !Array.isArray(record.jobs)
    || typeof record.documentSha256 !== "string"
    || !LOWER_SHA256.test(record.documentSha256)) {
    throw new SupportQueueDocumentError("shape_invalid");
  }
  validateRevision(record.revision);
  if (record.jobs.length > SUPPORT_QUEUE_MAX_JOBS) {
    throw new SupportQueueDocumentError("jobs_exceeded");
  }
  const jobs = record.jobs.map((job, index) => {
    try {
      const rawJob = canonicalQueueJson(job);
      const parsedJob = parseJob(job, index);
      if (canonicalQueueJson(parsedJob) !== rawJob) {
        throw new SupportQueueDocumentError("shape_invalid");
      }
      return parsedJob;
    } catch (error) {
      if (error instanceof SupportQueueDocumentError) throw error;
      throw new SupportQueueDocumentError("shape_invalid");
    }
  });
  const expectedHash = await sha256QueueText(canonicalQueueJson({
    schemaVersion: SUPPORT_QUEUE_SCHEMA_VERSION,
    revision: record.revision,
    jobs: record.jobs,
  }));
  if (record.documentSha256 !== expectedHash) {
    throw new SupportQueueDocumentError("hash_invalid");
  }
  return {
    schemaVersion: SUPPORT_QUEUE_SCHEMA_VERSION,
    revision: record.revision,
    jobs,
    documentSha256: record.documentSha256,
  };
}

export function encodeSupportQueueJournal<TJob>(
  target: SupportQueueDocumentV2<TJob>,
): string {
  let encoded: string;
  try {
    encoded = canonicalQueueJson({
      schemaVersion: SUPPORT_QUEUE_SCHEMA_VERSION,
      target,
    });
  } catch (error) {
    throw mapCanonicalError(error);
  }
  if (queueUtf8Bytes(encoded)
    > SUPPORT_QUEUE_DOCUMENT_MAX_BYTES + SUPPORT_QUEUE_JOURNAL_OVERHEAD_BYTES) {
    throw new SupportQueueDocumentError("bytes_exceeded");
  }
  return encoded;
}

export async function parseSupportQueueJournal<TJob>(
  raw: string,
  parseJob: SupportQueueJobParser<TJob>,
): Promise<SupportQueueJournalV2<TJob>> {
  if (queueUtf8Bytes(raw)
    > SUPPORT_QUEUE_DOCUMENT_MAX_BYTES + SUPPORT_QUEUE_JOURNAL_OVERHEAD_BYTES) {
    throw new SupportQueueDocumentError("bytes_exceeded");
  }
  const parsed = parseCanonicalRaw(raw);
  const record = exactRecord(parsed, ["schemaVersion", "target"]);
  if (record.schemaVersion !== SUPPORT_QUEUE_SCHEMA_VERSION) {
    throw new SupportQueueDocumentError("shape_invalid");
  }
  let targetRaw: string;
  try {
    targetRaw = canonicalQueueJson(record.target);
  } catch (error) {
    throw mapCanonicalError(error);
  }
  return {
    schemaVersion: SUPPORT_QUEUE_SCHEMA_VERSION,
    target: await parseSupportQueueDocument(targetRaw, parseJob),
  };
}

function parseCanonicalRaw(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new SupportQueueDocumentError("parse_failed");
  }
  let canonical: string;
  try {
    canonical = canonicalQueueJson(parsed);
  } catch (error) {
    throw mapCanonicalError(error);
  }
  if (canonical !== raw) {
    throw new SupportQueueDocumentError("noncanonical");
  }
  return parsed;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SupportQueueDocumentError("shape_invalid");
  }
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new SupportQueueDocumentError("shape_invalid");
  }
  return value as Record<string, unknown>;
}

function validateRevision(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
    || Object.is(value, -0)) {
    throw new SupportQueueDocumentError("shape_invalid");
  }
}

function mapCanonicalError(error: unknown): SupportQueueDocumentError {
  return error instanceof QueueCanonicalError
    ? new SupportQueueDocumentError("shape_invalid")
    : new SupportQueueDocumentError("shape_invalid");
}
