#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const executionManifestPath = path.join(
  repoRoot,
  "specs/developing/testing/core-release-execution-manifest.json",
);

const lanes = [
  {
    lane: "tier2-core",
    config: "tests/intent/playwright.config.ts",
    configArg: "playwright.config.ts",
    gate: "merge",
    job: "intent-tests",
  },
  {
    lane: "tier2-billing",
    config: "tests/intent/playwright.billing.config.ts",
    configArg: "playwright.billing.config.ts",
    gate: "merge",
    job: "intent-billing",
  },
  {
    lane: "tier2-surfaces-readiness",
    config: "tests/intent/playwright.surfaces.config.ts",
    configArg: "playwright.surfaces.config.ts",
    gate: "merge",
    job: "intent-surfaces",
  },
];

function listLane(lane) {
  const result = spawnSync(
    "pnpm",
    [
      "-C",
      "tests/intent",
      "exec",
      "playwright",
      "test",
      "--config",
      lane.configArg,
      "--list",
      "--reporter=json",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" },
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
    throw new Error(`failed to collect ${lane.lane} through ${lane.config}: ${detail}`);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Playwright emitted invalid JSON for ${lane.lane}: ${String(error)}`);
  }
  if (report.errors?.length) {
    throw new Error(`${lane.lane} collection reported errors: ${JSON.stringify(report.errors)}`);
  }

  const cells = [];
  const visitSuite = (suite, parentTitles = []) => {
    const isFileSuite = suite.line === 0 && suite.title === suite.file;
    const titles = isFileSuite || !suite.title ? parentTitles : [...parentTitles, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const collectedTest of spec.tests ?? []) {
        const file = path
          .relative(repoRoot, path.resolve(report.config.rootDir, spec.file))
          .split(path.sep)
          .join("/");
        if (file.startsWith("../") || path.isAbsolute(file)) {
          throw new Error(`${lane.lane} collected a spec outside the repository: ${spec.file}`);
        }
        const title = [...titles, spec.title].filter(Boolean).join(" › ");
        const legacyTitleIds = [...new Set(title.match(/T2-[A-Z0-9-]+/g) ?? [])];
        cells.push({
          lane: lane.lane,
          gate: lane.gate,
          job: lane.job,
          collector: lane.config,
          file,
          title,
          project: collectedTest.projectName,
          testId: spec.id,
          expectedStatus: collectedTest.expectedStatus,
          legacyTitleIds,
          // Never infer target coverage from a same-looking title. The
          // authoritative contract postdates several suites and some ids have
          // different semantics. A later domain audit may add explicit refs,
          // clauses, and a contract digest through reviewed collector logic.
          targetScenarioRefs: [],
          relationship:
            legacyTitleIds.length > 0 ? "collection-identity-only" : "harness-readiness",
        });
      }
    }
    for (const child of suite.suites ?? []) {
      visitSuite(child, titles);
    }
  };
  for (const suite of report.suites ?? []) {
    visitSuite(suite);
  }
  return cells;
}

export function collectTier2ExecutionManifest() {
  const executionCells = lanes.flatMap(listLane).sort((left, right) =>
    [left.lane, left.file, left.title, left.project, left.testId]
      .join("\0")
      .localeCompare([right.lane, right.file, right.title, right.project, right.testId].join("\0")),
  );
  return {
    schemaVersion: 1,
    targetManifest: "core-release-scenario-manifest.json",
    note:
      "Exact audited Tier-2 Playwright collection. This preservation ledger records executable reality, not target coverage. Legacy title ids are identity only; canonical target refs remain empty until a semantic domain audit records clauses and a contract digest.",
    executionCells,
  };
}

export function serializeTier2ExecutionManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main() {
  const mode = process.argv[2] ?? "--check";
  const serialized = serializeTier2ExecutionManifest(collectTier2ExecutionManifest());
  if (mode === "--write") {
    writeFileSync(executionManifestPath, serialized, { encoding: "utf8", mode: 0o644 });
    return;
  }
  if (mode !== "--check") {
    throw new Error(`unknown mode ${mode}; expected --check or --write`);
  }
  const checkedIn = readFileSync(executionManifestPath, "utf8");
  if (checkedIn !== serialized) {
    throw new Error(
      "Tier-2 collection drifted from core-release-execution-manifest.json. " +
        "Run `pnpm -C tests/intent run manifest:write`, audit the diff, and commit it with the test change.",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
