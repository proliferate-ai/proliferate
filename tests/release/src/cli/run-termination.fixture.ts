import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bootBillingStackWithLitellmFake } from "../../../intent/stack/billing-usage-import.ts";
import { startLitellmManagementFake } from "../../../intent/fakes/litellm-management/server.ts";
import { writeReportV4 } from "../evidence/write.js";
import { executeSelectedCells } from "../runner/execute.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import type { MatrixScenarioDefinition } from "../scenarios/types.js";
import { runReleaseCommand, type CommandDeps } from "./command.js";

const SOURCE_SHA = "a".repeat(40);
const IDENTITY: RunIdentityV1 = {
  run_id: "termination-regression",
  shard_id: "local-0",
  attempt: 1,
  source_sha: SOURCE_SHA,
  origin: { kind: "local", github_run_id: null, github_job: null },
};

const FAILED_BOOT_SCENARIO: MatrixScenarioDefinition = {
  id: "T2-FAILED-BOOT",
  kind: "matrix",
  title: "failed Tier-2 boot cleanup",
  registryFlowRef: "tests/release#failed-boot-cleanup",
  lanes: ["local"],
  requiredEnv: [],
  sourceBacked: true,
  expandCells: () => [{ dimensions: { case: "failed-boot" } }],
  planCell: () => [],
  runCells: async () => {
    await bootBillingStackWithLitellmFake({
      startFake: startLitellmManagementFake,
      bootStack: async () => {
        throw new Error("intentional billing boot failure");
      },
    });
    throw new Error("failed boot unexpectedly returned");
  },
};

async function main(): Promise<number> {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "release-runner-termination-"));
  const deps: CommandDeps = {
    resolveIdentity: async () => IDENTITY,
    selectScenarios: () => [FAILED_BOOT_SCENARIO],
    loadBuildMap: async () => {
      throw new Error("candidate map is not used by this source-backed fixture");
    },
    loadLocalWorldPorts: async () => null,
    seedLocalDurableUser: async () => undefined,
    pushLocalGatewayAuth: async () => undefined,
    printEnvManifestReport: () => undefined,
    execute: executeSelectedCells,
    write: (dir, report) => writeReportV4(dir, report, []),
    fileIssues: async () => [],
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  };

  try {
    return await runReleaseCommand(
      [
        "--behavior",
        "diagnostic",
        "--source-candidate",
        "--output-dir",
        outputDir,
      ],
      deps,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
