/**
 * T2-AUTH-1 cell: fresh `/setup` claim -> password login -> logout -> relogin
 * -> wrong-password rejection -> permanent second-claim rejection (the
 * `T2-AUTH-1` happy core, core-release-validation.md's Tier 2 manifest row).
 *
 * Per the workstream brief, this reuses the EXISTING Playwright spec
 * (`tests/intent/specs/auth.spec.ts`'s "T2-AUTH-1" describe block) rather than
 * re-implementing the browser-driven login/logout/claim flow a second time:
 * it shells out to the real Playwright runner, pointed at the world handle's
 * ALREADY-BOOTED stack via `TIER2_INTENT_EXTERNAL_STACK=1` (see the matching
 * glue in tests/intent/stack/global-setup.ts), so no second stack boots. The
 * cell result is explicit (one `FinalCellResult`), exactly-once (one
 * `runCell` call, one Playwright invocation, no silent retry loop at this
 * layer), and evidence-bound (the raw JSON reporter output and a sanitized
 * per-test breakdown are appended to the evidence sink before returning).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import type { EvidenceSink } from "../../../contracts/evidence.js";
import type { FinalCellResult } from "../../../contracts/results.js";
import { loadBootModule } from "../support/intent-bridge.js";
import { runCell, type CellOutcome } from "../cell-runner.js";
import type { InternalTier2WorldHandle } from "../provisioner.js";

const CELL: import("../../../contracts/identity.js").CellIdentity = {
  scenarioId: "T2-AUTH-1",
  world: "tier-2",
  productHost: "desktop-web",
  dimensions: {},
};

interface PlaywrightSpecResult {
  title: string;
  status: string;
  errorMessage: string | null;
}

interface PlaywrightJsonReport {
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
  suites?: unknown[];
}

function collectSpecResults(report: PlaywrightJsonReport): PlaywrightSpecResult[] {
  const results: PlaywrightSpecResult[] = [];
  const walk = (suite: any): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          results.push({
            title: spec.title,
            status: r.status,
            errorMessage: r.error?.message ? String(r.error.message).split("\n")[0].slice(0, 300) : null,
          });
        }
      }
    }
    for (const sub of suite.suites ?? []) {
      walk(sub);
    }
  };
  for (const suite of report.suites ?? []) {
    walk(suite);
  }
  return results;
}

export async function runT2Auth1Cell(
  handle: InternalTier2WorldHandle,
  evidence: EvidenceSink,
): Promise<FinalCellResult> {
  return runCell(CELL, evidence, async (): Promise<CellOutcome> => {
    const { REPO_ROOT } = await loadBootModule();
    const intentDir = path.join(REPO_ROOT, "tests", "intent");
    const spawned = spawnSync(
      "pnpm",
      ["exec", "playwright", "test", "specs/auth.spec.ts", "--grep", "T2-AUTH-1", "--reporter=json"],
      {
        cwd: intentDir,
        encoding: "utf8",
        env: {
          ...process.env,
          TIER2_INTENT_EXTERNAL_STACK: "1",
          TIER2_INTENT_API_BASE_URL: handle.serverUrl,
          TIER2_INTENT_WEB_BASE_URL: handle.webUrl,
          TIER2_INTENT_ANYHARNESS_BASE_URL: handle.anyharnessUrl,
          TIER2_INTENT_DATABASE_URL: handle.databaseUrl,
          TIER2_INTENT_SETUP_TOKEN_FILE: handle.setupTokenFile,
        },
      },
    );

    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(spawned.stdout) as PlaywrightJsonReport;
    } catch {
      return {
        status: "failed",
        detail: `could not parse Playwright JSON reporter output (exit ${spawned.status}): ${(spawned.stderr || spawned.stdout || "").slice(0, 500)}`,
      };
    }

    const specResults = collectSpecResults(report);
    await evidence.append({ kind: "t2-auth-1-playwright-report", stats: report.stats, specResults });

    if (specResults.length === 0) {
      return { status: "failed", detail: "no T2-AUTH-1 tests were collected by the --grep filter (collector bug)" };
    }
    if (report.stats.unexpected > 0 || report.stats.skipped > 0) {
      const failing = specResults.filter((r) => r.status !== "passed");
      const detail = failing
        .map((r) => `${r.title}: ${r.status}${r.errorMessage ? ` (${r.errorMessage})` : ""}`)
        .join("; ");
      return {
        status: "failed",
        detail: `T2-AUTH-1 happy core did not pass in full: ${detail}`,
        correlationIds: [`playwright-exit-${spawned.status}`],
      };
    }

    return {
      status: "green",
      detail: `T2-AUTH-1 happy core passed: ${specResults.length} tests (${report.stats.expected} expected, 0 unexpected, 0 skipped)`,
    };
  });
}
