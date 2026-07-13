#!/usr/bin/env -S npx tsx
/**
 * `pnpm -C tests/release run access-audit`
 *
 * Runs the redacted access audit and prints a names-and-shapes-only report.
 * Exits nonzero and lists every missing/malformed/errored check by name when
 * the environment is not ready — never prints a credential value.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnvironment } from "./env-file.js";
import { runAccessAudit } from "./audit.js";

// tests/release/src/foundation/access/cli.ts -> repo root is five levels up:
// access -> foundation -> src -> release -> tests -> <repo root>.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

function main(): void {
  const env = loadLocalEnvironment({ repoRoot: REPO_ROOT });
  const report = runAccessAudit({ env });

  console.log("Access audit (redacted — no value is ever printed):");
  for (const result of report.results) {
    const marker = result.status === "ok" ? "OK" : result.status.toUpperCase();
    console.log(`  [${marker}] ${result.name}: ${result.detail}`);
  }

  if (report.ok) {
    console.log("\nAll checks passed.");
    return;
  }

  console.log(`\nMissing/failing checks: ${report.missingNames.join(", ")}`);
  process.exitCode = 1;
}

main();
