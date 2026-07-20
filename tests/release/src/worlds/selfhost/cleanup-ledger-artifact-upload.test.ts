import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLEANUP_LEDGER_FILENAME } from "../local-workspace/cleanup-ledger.js";
import { CFN_BOOTSTRAP_DIAGNOSTIC_FILENAME, CFN_CLEANUP_RECEIPT_FILENAME } from "./cfn.js";

/**
 * SHR-006: the self-host cleanup ledger must be Actions-durable — it must
 * survive to CI artifacts even when the run is interrupted, not just on a
 * clean green run. `if: always()` on the selfhost job's upload step already
 * covers "the step runs on an interrupted/failed job"; what was missing is the
 * ledger's own glob in that step's `path:` list. The ledger is written
 * directly under the run/shard directory
 * (`worlds/local-workspace/cleanup-ledger.ts` `openCleanupLedger` ->
 * `path.join(runDir, CLEANUP_LEDGER_FILENAME)`), one level ABOVE the
 * `evidence/`/`logs/` subdirectories the upload step already globbed — so
 * without its own glob entry it never reached the uploaded artifact, upload
 * step running or not.
 *
 * This test proves the ON-DISK ledger path (the exact `make
 * qualification-selfhost` / release-e2e.yml run-dir convention:
 * `tests/release/.output/selfhost-world/<run_id>/<shard_id>/`, see the
 * `qualification-selfhost` Makefile target and
 * `scripts/ci-cd/build-selfhost-qualification-candidates.mjs`'s
 * `--run-dir`) is matched by one of the glob lines actually present in the
 * `release-e2e-selfhost-install` job's upload step right now — reading the
 * real workflow file, not a hardcoded copy of it, so a future edit that drops
 * or renames the glob fails this test instead of silently regressing.
 */

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
// tests/release/src/worlds/selfhost -> repo root is five levels up.
const REPO_ROOT = path.resolve(TEST_FILE_DIR, "..", "..", "..", "..", "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "release-e2e.yml");
const SELFHOST_JOB_NAME = "release-e2e-selfhost-install:";
const UPLOAD_STEP_NAME = "Upload V4 report and bounded diagnostic logs";

/** The exact run/shard-dir convention `make qualification-selfhost` builds (Makefile `qualification-selfhost` target). */
function ledgerPathForRun(runId: string, shardId: string): string {
  return `tests/release/.output/selfhost-world/${runId}/${shardId}/${CLEANUP_LEDGER_FILENAME}`;
}

/**
 * A glob-to-regex match matching `@actions/glob`'s semantics: `**` crosses `/`
 * boundaries (any depth, including zero segments), a single `*` never does.
 */
function matchesGlob(glob: string, candidate: string): boolean {
  // `@actions/glob` semantics: `**/` matches zero or more full path segments and
  // bare `**` matches anything (crossing `/`); a single `*` never crosses `/`.
  // Sentinel the `**` forms before escaping so the single-`*` rule leaves them
  // alone, then expand the sentinels to their crossing-`/` regex.
  const escaped = glob
    .replace(/\*\*\//g, " DSS ")
    .replace(/\*\*/g, " DS ")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .split(" DSS ")
    .join("(?:[^/]*/)*")
    .split(" DS ")
    .join(".*");
  return new RegExp(`^${escaped}$`).test(candidate);
}

/** `upload-artifact` includes a directory entry's descendants recursively. */
function uploadGlobIncludes(glob: string, candidate: string): boolean {
  if (matchesGlob(glob, candidate)) {
    return true;
  }
  if (!glob.endsWith("/")) {
    return false;
  }
  let parent = path.posix.dirname(candidate);
  while (parent !== "." && parent !== "/") {
    if (matchesGlob(glob, `${parent}/`)) {
      return true;
    }
    parent = path.posix.dirname(parent);
  }
  return false;
}

/** Isolates the `release-e2e-selfhost-install` job's upload-step `path:` block from the real workflow file. */
function extractUploadGlobs(workflowText: string): string[] {
  const jobStart = workflowText.indexOf(SELFHOST_JOB_NAME);
  assert.ok(jobStart >= 0, `release-e2e.yml no longer defines the "${SELFHOST_JOB_NAME}" job.`);
  const jobBody = workflowText.slice(jobStart);

  const stepStart = jobBody.indexOf(UPLOAD_STEP_NAME);
  assert.ok(
    stepStart >= 0,
    `the "${SELFHOST_JOB_NAME}" job no longer has an "${UPLOAD_STEP_NAME}" step.`,
  );
  const stepBody = jobBody.slice(stepStart);

  const pathBlockStart = stepBody.indexOf("path: |");
  assert.ok(pathBlockStart >= 0, `the "${UPLOAD_STEP_NAME}" step no longer has a "path: |" block.`);
  const afterPathHeader = stepBody.slice(pathBlockStart + "path: |".length);

  // The block is every subsequent line indented deeper than the "path:" key,
  // up to (not including) the first line that dedents back to it (here,
  // "retention-days:").
  const lines = afterPathHeader.split("\n").slice(1);
  const globs: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    if (!/^\s{10,}\S/.test(line)) {
      break;
    }
    globs.push(line.trim());
  }
  assert.ok(globs.length > 0, `no glob lines were parsed out of the "${UPLOAD_STEP_NAME}" step's "path:" block.`);
  return globs;
}

test("the selfhost job's upload-artifact step path globs cover the cleanup ledger file", () => {
  const workflowText = readFileSync(WORKFLOW_PATH, "utf8");
  const globs = extractUploadGlobs(workflowText);

  const ledgerPath = ledgerPathForRun("qs-ci-12345-1", "1");
  const matched = globs.some((glob) => matchesGlob(glob, ledgerPath));
  assert.ok(
    matched,
    `none of the upload step's globs (${JSON.stringify(globs)}) match the ledger's on-disk path ` +
      `"${ledgerPath}" (CLEANUP_LEDGER_FILENAME="${CLEANUP_LEDGER_FILENAME}").`,
  );

  // The pre-existing evidence/logs globs must still be present (append-only —
  // this change must not have narrowed what was already uploaded).
  assert.ok(
    globs.some((glob) => glob.includes("evidence/")),
    `the evidence/ glob was lost from the upload step (globs: ${JSON.stringify(globs)}).`,
  );
  assert.ok(
    globs.some((glob) => glob.includes("logs/")),
    `the logs/ glob was lost from the upload step (globs: ${JSON.stringify(globs)}).`,
  );

  // PR7-CONTROL-008: the NESTED ledgers must also be covered — SELFHOST-CFN-1
  // writes its ledger under `.../cfn/`, and SELFHOST-ISOLATION-1's two boxes
  // under `.../server-a/` and `.../server-b/`. The two-level glob missed all
  // three; the `**` glob must match every one.
  const nestedLedgerPaths = [
    `tests/release/.output/selfhost-world/qs-ci-12345-1/1/cfn/${CLEANUP_LEDGER_FILENAME}`,
    `tests/release/.output/selfhost-world/qs-ci-12345-1/1/server-a/${CLEANUP_LEDGER_FILENAME}`,
    `tests/release/.output/selfhost-world/qs-ci-12345-1/1/server-b/${CLEANUP_LEDGER_FILENAME}`,
  ];
  for (const nested of nestedLedgerPaths) {
    assert.ok(
      globs.some((glob) => matchesGlob(glob, nested)),
      `no upload glob (${JSON.stringify(globs)}) matches the nested ledger "${nested}".`,
    );
  }

  // Failed CFN bootstrap diagnostics are written before nested-world cleanup
  // beside the parent run evidence, so they must also survive the red job.
  const cfnDiagnosticPath =
    `tests/release/.output/selfhost-world/qs-ci-12345-1/1/logs/${CFN_BOOTSTRAP_DIAGNOSTIC_FILENAME}`;
  assert.ok(
    globs.some((glob) => uploadGlobIncludes(glob, cfnDiagnosticPath)),
    `no upload glob (${JSON.stringify(globs)}) matches the CFN diagnostic "${cfnDiagnosticPath}".`,
  );

  const cfnCleanupReceiptPath =
    `tests/release/.output/selfhost-world/qs-ci-12345-1/1/logs/${CFN_CLEANUP_RECEIPT_FILENAME}`;
  assert.ok(
    globs.some((glob) => uploadGlobIncludes(glob, cfnCleanupReceiptPath)),
    `no upload glob (${JSON.stringify(globs)}) matches the CFN cleanup receipt "${cfnCleanupReceiptPath}".`,
  );

  const cfnCancellationReceiptPath =
    "tests/release/.output/selfhost-world/qs-ci-12345-1/1/cfn-cancellation-finalization.json";
  assert.ok(
    globs.some((glob) => matchesGlob(glob, cfnCancellationReceiptPath)),
    `no upload glob (${JSON.stringify(globs)}) matches the CFN cancellation receipt ` +
      `"${cfnCancellationReceiptPath}".`,
  );
});

test("matchesGlob: single-level `*` never crosses a `/` boundary", () => {
  assert.equal(matchesGlob("a/*/c", "a/b/c"), true);
  assert.equal(matchesGlob("a/*/c", "a/b/x/c"), false);
  assert.equal(matchesGlob("a/*/*/ledger.json", "a/run-1/shard-1/ledger.json"), true);
});
