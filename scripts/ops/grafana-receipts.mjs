// Private rollback-receipt handling for the E1 Grafana operator tooling
// (grafana-alerting.mjs). Receipts hold real before-state, are written mode
// 0600 outside the Git worktree, and are never committed.
// Contract: specs/codebase/systems/engineering/issue-lifecycle/grafana-rules-delivery.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

function isDirWorldOrGroupWritable(dir) {
  const mode = fs.statSync(dir).mode;
  return (mode & 0o022) !== 0;
}

export function assertPrivateReceiptPath(receiptPath, { repoRoot = REPO_ROOT } = {}) {
  if (!receiptPath) {
    throw new Error("A --receipt path is required");
  }
  if (!path.isAbsolute(receiptPath)) {
    throw new Error("Receipt path must be absolute (relative/worktree-implied paths are refused)");
  }
  const resolved = path.resolve(receiptPath);
  const rel = path.relative(repoRoot, resolved);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error("Receipt path must be outside the Git worktree");
  }
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    throw new Error(`Receipt directory does not exist: ${dir}`);
  }
  if (isDirWorldOrGroupWritable(dir)) {
    throw new Error("Receipt directory is group/other writable; refusing a public path");
  }
  return resolved;
}

export function writeReceipt(receiptPath, payload, { repoRoot = REPO_ROOT } = {}) {
  const resolved = assertPrivateReceiptPath(receiptPath, { repoRoot });
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
  return resolved;
}

export function readReceipt(receiptPath, { repoRoot = REPO_ROOT } = {}) {
  const resolved = assertPrivateReceiptPath(receiptPath, { repoRoot });
  if (!fs.existsSync(resolved)) {
    throw new Error(`Receipt not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}
