import { describe, expect, it } from "vitest";

import {
  createNextSupportQueueDocument,
  createSupportQueueDocument,
  encodeSupportQueueDocument,
  encodeSupportQueueJournal,
  parseSupportQueueDocument,
  parseSupportQueueJournal,
  SUPPORT_QUEUE_DOCUMENT_MAX_BYTES,
  SupportQueueDocumentError,
} from "./support-report-queue-document";

const parseJob = (value: unknown): { id: string; value?: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid job");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") throw new Error("invalid job");
  if (record.value !== undefined && typeof record.value !== "string") {
    throw new Error("invalid job");
  }
  return { id: record.id, ...(typeof record.value === "string" ? { value: record.value } : {}) };
};

describe("support queue V2 document", () => {
  it("creates, hashes, encodes, and parses exact canonical bytes", async () => {
    const document = await createSupportQueueDocument(0, [{ id: "job-1" }]);
    expect(document.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    const raw = encodeSupportQueueDocument(document);
    expect(raw.startsWith('{"documentSha256":')).toBe(true);
    await expect(parseSupportQueueDocument(raw, parseJob)).resolves.toEqual(document);
  });

  it("pins the document hash independent of caller object key order", async () => {
    const first = await createSupportQueueDocument(7, [{ value: "same", id: "job-1" }]);
    const second = await createSupportQueueDocument(7, [{ id: "job-1", value: "same" }]);
    expect(first.documentSha256).toBe(second.documentSha256);
    expect(encodeSupportQueueDocument(first)).toBe(encodeSupportQueueDocument(second));
  });

  it("rejects noncanonical, unknown, corrupt, and unsafe documents", async () => {
    const document = await createSupportQueueDocument(0, [{ id: "job-1" }]);
    const raw = encodeSupportQueueDocument(document);
    await expect(parseSupportQueueDocument(` ${raw}`, parseJob)).rejects.toMatchObject({
      failure: "noncanonical",
    });
    await expect(parseSupportQueueDocument(
      raw.replace('"jobs":', '"extra":true,"jobs":'),
      parseJob,
    )).rejects.toBeInstanceOf(SupportQueueDocumentError);
    await expect(parseSupportQueueDocument(
      raw.replace(document.documentSha256, "0".repeat(64)),
      parseJob,
    )).rejects.toMatchObject({ failure: "hash_invalid" });
    const unsafe = raw.replace('"revision":0', '"revision":9007199254740993');
    await expect(parseSupportQueueDocument(unsafe, parseJob)).rejects.toBeInstanceOf(
      SupportQueueDocumentError,
    );
  });

  it("rejects the eleventh job and revision exhaustion", async () => {
    await expect(createSupportQueueDocument(
      0,
      Array.from({ length: 11 }, (_, index) => ({ id: `job-${index}` })),
    )).rejects.toMatchObject({ failure: "jobs_exceeded" });
    const exhausted = await createSupportQueueDocument(Number.MAX_SAFE_INTEGER, []);
    await expect(createNextSupportQueueDocument(exhausted, [])).rejects.toMatchObject({
      failure: "revision_exhausted",
    });
  });

  it("applies the cap to the complete checksummed target document", async () => {
    const empty = await createSupportQueueDocument(0, [{ id: "job-1", value: "" }]);
    const exactLength = SUPPORT_QUEUE_DOCUMENT_MAX_BYTES
      - new TextEncoder().encode(encodeSupportQueueDocument(empty)).byteLength;
    const exact = await createSupportQueueDocument(0, [{
      id: "job-1",
      value: "x".repeat(exactLength),
    }]);
    expect(new TextEncoder().encode(encodeSupportQueueDocument(exact))).toHaveLength(
      SUPPORT_QUEUE_DOCUMENT_MAX_BYTES,
    );
    await expect(createSupportQueueDocument(0, [{
      id: "job-1",
      value: "x".repeat(exactLength + 1),
    }])).rejects
      .toMatchObject({ failure: "bytes_exceeded" });
  });

  it("requires the job validator to preserve the exact canonical value", async () => {
    const document = await createSupportQueueDocument(0, [{ id: "job-1", extra: true }]);
    await expect(parseSupportQueueDocument(
      encodeSupportQueueDocument(document),
      parseJob,
    )).rejects.toMatchObject({ failure: "shape_invalid" });
  });

  it("creates from descriptor-safe job bytes without invoking array getters", async () => {
    const jobs = [Object.defineProperty({ id: "job-1" }, "secret", {
      enumerable: true,
      get: () => "must not run",
    })];
    await expect(createSupportQueueDocument(0, jobs)).rejects.toMatchObject({
      failure: "shape_invalid",
    });
  });

  it("round-trips the canonical journal and rejects wrapper drift", async () => {
    const target = await createSupportQueueDocument(2, [{ id: "job-1" }]);
    const raw = encodeSupportQueueJournal(target);
    await expect(parseSupportQueueJournal(raw, parseJob)).resolves.toEqual({
      schemaVersion: 2,
      target,
    });
    await expect(parseSupportQueueJournal(`${raw}\n`, parseJob)).rejects.toMatchObject({
      failure: "noncanonical",
    });
  });
});
