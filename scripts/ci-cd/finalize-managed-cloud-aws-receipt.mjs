import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RECEIPT_KIND = "managed_cloud_aws_hard_cancel_cleanup";
const RECEIPT_SCHEMA_VERSION = 1;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function receiptTempPattern(receiptPath) {
  const basename = escapeRegExp(path.basename(receiptPath));
  const boundedInteger = "[1-9]\\d{0,19}";
  return new RegExp(`^${basename}\\.(?:${boundedInteger}\\.${boundedInteger}\\.tmp|${boundedInteger}\\.finalize\\.tmp)$`);
}

function requiredAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function expectedIdentity(env) {
  const workflowRunId = env.TARGET_WORKFLOW_RUN_ID ?? "";
  const attemptValue = env.TARGET_WORKFLOW_RUN_ATTEMPT ?? "";
  const cleanupSha = env.CLEANUP_SHA ?? "";
  if (!/^[1-9]\d*$/.test(workflowRunId)) throw new Error("workflow run id is malformed.");
  if (!/^[1-9]\d*$/.test(attemptValue)) throw new Error("workflow run attempt is malformed.");
  const workflowRunAttempt = Number(attemptValue);
  if (!Number.isSafeInteger(workflowRunAttempt)) throw new Error("workflow run attempt is malformed.");
  if (!/^[0-9a-f]{40}$/.test(cleanupSha)) throw new Error("cleanup sha is malformed.");
  return { workflowRunId, workflowRunAttempt, cleanupSha };
}

function failedReceipt(identity, reason) {
  return {
    kind: RECEIPT_KIND,
    schema_version: RECEIPT_SCHEMA_VERSION,
    workflow_run_id: identity.workflowRunId,
    workflow_run_attempt: identity.workflowRunAttempt,
    cleanup_sha: identity.cleanupSha,
    status: "failed",
    reason,
  };
}

function validatedReceipt(receiptPath, identity) {
  let row;
  try {
    row = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch {
    return { row: failedReceipt(identity, "AWS cleanup receipt was missing or malformed."), success: false };
  }
  const common =
    row?.kind === RECEIPT_KIND &&
    row?.schema_version === RECEIPT_SCHEMA_VERSION &&
    row?.workflow_run_id === identity.workflowRunId &&
    row?.workflow_run_attempt === identity.workflowRunAttempt &&
    row?.cleanup_sha === identity.cleanupSha &&
    ["reconciled", "not_needed", "failed"].includes(row?.status);
  const structured = common && Array.isArray(row.runs);
  const success = structured && row.status !== "failed";
  const failure =
    common &&
    row.status === "failed" &&
    (structured || (
      typeof row.reason === "string" &&
      row.reason.length > 0 &&
      row.reason.length <= 400
    ));
  if (!success && !failure) {
    return { row: failedReceipt(identity, "AWS cleanup receipt was missing or malformed."), success: false };
  }
  return { row, success };
}

export function removeReceiptTempSiblings(receiptPath) {
  requiredAbsolutePath(receiptPath, "AWS cleanup receipt path");
  const directory = path.dirname(receiptPath);
  const pattern = receiptTempPattern(receiptPath);
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;
    try {
      unlinkSync(path.join(directory, entry.name));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export function finalizeManagedCloudAwsReceipt(receiptPath, temporaryPath, env = process.env) {
  requiredAbsolutePath(receiptPath, "AWS cleanup receipt path");
  requiredAbsolutePath(temporaryPath, "AWS cleanup finalizer temp path");
  if (path.dirname(temporaryPath) !== path.dirname(receiptPath) ||
      !receiptTempPattern(receiptPath).test(path.basename(temporaryPath)) ||
      !temporaryPath.endsWith(".finalize.tmp")) {
    throw new Error("AWS cleanup finalizer temp path is not scoped to the canonical receipt.");
  }
  const identity = expectedIdentity(env);
  mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  removeReceiptTempSiblings(receiptPath);
  const result = validatedReceipt(receiptPath, identity);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(result.row)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, receiptPath);
  } finally {
    rmSync(temporaryPath, { force: true });
    removeReceiptTempSiblings(receiptPath);
  }
  return result;
}

async function main() {
  try {
    const result = finalizeManagedCloudAwsReceipt(process.argv[2], process.argv[3]);
    if (!result.success) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
