import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ManagedCloudHandoffError,
  verifyManagedCloudHandoff,
} from "./verify-managed-cloud-handoff.js";
import {
  expectedVerdict,
  type CloudProvisionTurnEvidenceV1,
  type ManagedCloudFixtureSmokeEvidenceV1,
  type TestRunReportV4,
} from "../evidence/schema.js";
import { ALL_FINAL_STATUSES, type FinalTestStatus, type PlannedCellV1 } from "../runner/result.js";
import {
  markSharedTemplateAcquired,
  markSharedTemplateReleased,
  recordSharedTemplateIntent,
  type SharedTemplateCustodyIdentityV1,
} from "../worlds/managed-cloud/shared-template-custody.js";
import type { E2bTemplateReceipt } from "../worlds/managed-cloud/template.js";

const RUN_ID = "qlc-ci-123-1";
const SHARD_ID = "1";
const SOURCE_SHA = "a".repeat(40);
const INPUT_HASH = "b".repeat(64);
const TEMPLATE_ID = "tmpl_exact_1";
const BUILD_ID = "build_exact_1";
const TEMPLATE_ARTIFACT_ID = `e2b-template/proliferate-runtime-qual-${RUN_ID}`;
const CANDIDATE_API_ARTIFACT_ID = `candidate-api/mcq-${RUN_ID}-1.qualification.proliferate.com`;
const SMOKE_CELLS = [
  "callback-relay",
  "stripe-test-clock",
  "billing-threshold",
  "failure-injection",
  "cleanup-replay",
];

const CANDIDATE_BUILD = {
  artifacts: [
    { artifact_id: "server/linux/amd64", version: "0.3.40", sha256: "1".repeat(64) },
    {
      artifact_id: "anyharness/x86_64-unknown-linux-musl",
      version: "0.3.40",
      sha256: "2".repeat(64),
    },
  ],
};

function cloudEvidence(): CloudProvisionTurnEvidenceV1 {
  return {
    kind: "cloud_provision_turn",
    artifact_ids: [
      "server/linux/amd64",
      "anyharness/x86_64-unknown-linux-musl",
      TEMPLATE_ARTIFACT_ID,
      CANDIDATE_API_ARTIFACT_ID,
    ],
    server_version: "0.3.40",
    anyharness_version: "0.3.40",
    worker_version: "0.3.40",
    supervisor_version: "0.3.40",
    harness: "claude",
    model_id: "claude-haiku-4-5",
    template: { template_id: TEMPLATE_ID, build_id: BUILD_ID, input_hash: INPUT_HASH },
    sandbox_id_hash: "3".repeat(64),
    worker: { supervisor_is_parent: true, heartbeat_recent: true },
    covered_repo: {
      name: "proliferate-e2e/e2e-fixture",
      commit: "4".repeat(40),
      no_credential_in_remote: true,
    },
    isolation: {
      actor_b_denied: true,
      runtime_rejects_missing: true,
      runtime_rejects_actor_b: true,
    },
    litellm: {
      token_id_hash: "5".repeat(64),
      request_ids: ["req-1"],
      window_started_at: "2026-07-17T00:00:00.000Z",
      window_finished_at: "2026-07-17T00:00:01.000Z",
      prompt_tokens: 2,
      completion_tokens: 1,
      total_tokens: 3,
      spend_usd: 0.0001,
    },
    cleanup: {
      ledger_id_hash: "6".repeat(64),
      registered: 10,
      reconciled: 10,
      failed: 0,
      sandboxes_deleted: true,
      template_deleted: false,
      template_custody_transferred: true,
      dns_record_deleted: true,
      ec2_terminated: true,
      security_group_deleted: true,
      key_pair_deleted: true,
      virtual_key_deleted: true,
      litellm_subjects_deleted: true,
      local_paths_removed: true,
    },
  };
}

function smokeEvidence(cellName: string): ManagedCloudFixtureSmokeEvidenceV1 {
  const cleanupReplay = cellName === "cleanup-replay";
  return {
    kind: "managed_cloud_fixture_smoke",
    artifact_ids: [
      "server/linux/amd64",
      "anyharness/x86_64-unknown-linux-musl",
      TEMPLATE_ARTIFACT_ID,
      CANDIDATE_API_ARTIFACT_ID,
    ],
    world: {
      source_sha: SOURCE_SHA,
      server_digest: "1".repeat(64),
      e2b_template_id: TEMPLATE_ID,
      e2b_template_build_id: BUILD_ID,
      e2b_template_input_hash: INPUT_HASH,
    },
    cells: [{
      cell_id: `MANAGED-CLOUD-FIXTURE-SMOKE-1/sandbox/cell=${cellName}`,
      external_ids: ["cus_test_1"],
      observed_transition: "observed-transition",
      cleanup_entries: ["stripe_customer"],
    }],
    provider_sweeps: cleanupReplay
      ? ["aws", "e2b", "stripe", "process", "filesystem"].map((provider) => ({
          provider: provider as "aws" | "e2b" | "stripe" | "process" | "filesystem",
          remaining_owned_resources: 0,
        }))
      : [],
  };
}

function plannedCell(scenarioId: string, dimensions: Record<string, string>): PlannedCellV1 {
  const dimensionSegment = Object.entries(dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return {
    cell_id: `${scenarioId}/sandbox/${dimensionSegment}`,
    scenario_id: scenarioId,
    registry_flow_ref: `specs#${scenarioId}`,
    runtime_lane: "sandbox",
    dimensions,
    required_env: [],
  };
}

function report(
  cells: PlannedCellV1[],
  evidence: Array<CloudProvisionTurnEvidenceV1 | ManagedCloudFixtureSmokeEvidenceV1>,
): TestRunReportV4 {
  const byStatus = Object.fromEntries(ALL_FINAL_STATUSES.map((status) => [status, 0])) as Record<
    FinalTestStatus,
    number
  >;
  byStatus.green = cells.length;
  const report: TestRunReportV4 = {
    schema_version: 4,
    kind: "proliferate.test-run",
    candidate_build: structuredClone(CANDIDATE_BUILD),
    run: {
      run_id: RUN_ID,
      shard_id: SHARD_ID,
      attempt: 1,
      source_sha: SOURCE_SHA,
      origin: { kind: "github_actions", github_run_id: "123", github_job: "managed-cloud" },
      behavior: "strict",
      execution: "real",
      started_at: "2026-07-17T00:00:00.000Z",
      finished_at: "2026-07-17T00:01:00.000Z",
    },
    inputs: { target_lane: "cloud", desktop: "web", agents: ["claude"], scenarios: "all" },
    selected_cells: structuredClone(cells),
    results: cells.map((cell, index) => ({
      cell_id: cell.cell_id,
      scenario_id: cell.scenario_id,
      registry_flow_ref: cell.registry_flow_ref,
      runtime_lane: cell.runtime_lane,
      dimensions: { ...cell.dimensions },
      status: "green",
      started_at: "2026-07-17T00:00:01.000Z",
      finished_at: "2026-07-17T00:00:59.000Z",
      duration_ms: 58_000,
      reason: null,
      plan_steps: [],
      evidence: evidence[index]!,
    })),
    summary: {
      selected: cells.length,
      finalized: cells.length,
      by_status: byStatus,
      integrity_errors: [],
      runner_errors: [],
      intended_exit_code: 0,
    },
    verdict: { status: "selected_cells_passed", scope: "selected_cells", completeness: "partial", reasons: [] },
  };
  const verdict = expectedVerdict(report);
  report.verdict.status = verdict.status;
  report.verdict.reasons = verdict.reasons;
  report.summary.intended_exit_code = verdict.intendedExitCode;
  return report;
}

function cp1Report(): TestRunReportV4 {
  return report([plannedCell("CLOUD-PROVISION-1", { harness: "claude" })], [cloudEvidence()]);
}

function smokeReport(cells = SMOKE_CELLS): TestRunReportV4 {
  return report(
    cells.map((cell) => plannedCell("MANAGED-CLOUD-FIXTURE-SMOKE-1", { cell })),
    cells.map(smokeEvidence),
  );
}

const CUSTODY_IDENTITY: SharedTemplateCustodyIdentityV1 = {
  runId: RUN_ID,
  shardId: SHARD_ID,
  sourceSha: SOURCE_SHA,
  templateName: `proliferate-runtime-qual-${RUN_ID}`,
  inputHash: INPUT_HASH,
};

const TEMPLATE_RECEIPT: E2bTemplateReceipt = {
  artifact_id: TEMPLATE_ARTIFACT_ID,
  templateId: TEMPLATE_ID,
  buildId: BUILD_ID,
  inputHash: INPUT_HASH,
  bakedInputs: [{ destination: "/home/user/.local/bin/anyharness", sha256: "7".repeat(64) }],
};

async function withFixture(
  callback: (paths: { cp1Report: string; smokeReport: string; custody: string }) => Promise<void>,
  options: {
    cp1?: TestRunReportV4;
    smoke?: TestRunReportV4;
    releaseCustody?: boolean;
    receipt?: E2bTemplateReceipt;
  } = {},
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "managed-handoff-"));
  const paths = {
    cp1Report: path.join(directory, "cp1.json"),
    smokeReport: path.join(directory, "smoke.json"),
    custody: path.join(directory, "custody.json"),
  };
  try {
    await writeFile(paths.cp1Report, JSON.stringify(options.cp1 ?? cp1Report()));
    await writeFile(paths.smokeReport, JSON.stringify(options.smoke ?? smokeReport()));
    await recordSharedTemplateIntent(paths.custody, CUSTODY_IDENTITY);
    const receipt = options.receipt ?? TEMPLATE_RECEIPT;
    await markSharedTemplateAcquired(paths.custody, CUSTODY_IDENTITY, receipt);
    if (options.releaseCustody !== false) {
      await markSharedTemplateReleased(paths.custody, CUSTODY_IDENTITY, receipt);
    }
    await callback(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectCode(
  code: ManagedCloudHandoffError["code"],
  options: Parameters<typeof withFixture>[1],
): Promise<void> {
  await withFixture(async (paths) => {
    await assert.rejects(
      () => verifyManagedCloudHandoff(paths),
      (error: unknown) => error instanceof ManagedCloudHandoffError && error.code === code,
    );
  }, options);
}

test("verifies one exact CP1 to fixture-smoke handoff without returning raw identity", async () => {
  await withFixture(async (paths) => {
    assert.deepEqual(await verifyManagedCloudHandoff(paths), {
      kind: "proliferate.managed-cloud-handoff-verification",
      status: "verified",
    });
  });
});

test("rejects candidate artifact-set drift between the sequential reports", async () => {
  const smoke = smokeReport();
  smoke.candidate_build!.artifacts[0]!.sha256 = "8".repeat(64);
  await expectCode("candidate_mismatch", { smoke });
});

test("rejects smoke server-digest drift from the exact candidate server", async () => {
  const smoke = smokeReport();
  const evidence = smoke.results[0]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
  evidence.world.server_digest = "8".repeat(64);
  await expectCode("candidate_mismatch", { smoke });
});

test("rejects missing, duplicate, or unexpected evidence artifact identities", async () => {
  for (const mutate of [
    (ids: string[]) => ids.splice(ids.indexOf("server/linux/amd64"), 1),
    (ids: string[]) => ids.push("server/linux/amd64"),
    (ids: string[]) => ids.push("unexpected/runtime"),
  ]) {
    const smoke = smokeReport();
    const evidence = smoke.results[0]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
    mutate(evidence.artifact_ids);
    await expectCode("candidate_mismatch", { smoke });
  }

  const cp1 = cp1Report();
  const cp1Evidence = cp1.results[0]!.evidence as CloudProvisionTurnEvidenceV1;
  cp1Evidence.artifact_ids = cp1Evidence.artifact_ids.filter(
    (artifactId) => artifactId !== "anyharness/x86_64-unknown-linux-musl",
  );
  await expectCode("candidate_mismatch", { cp1 });
});

test("rejects dynamic artifact drift between CP1, smoke, and custody", async () => {
  const smoke = smokeReport();
  const evidence = smoke.results[0]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
  evidence.artifact_ids = evidence.artifact_ids.map((artifactId) =>
    artifactId === CANDIDATE_API_ARTIFACT_ID ? "candidate-api/another-run.example.com" : artifactId,
  );
  await expectCode("candidate_mismatch", { smoke });

  const cp1 = cp1Report();
  const smokeWithMatchingDrift = smokeReport();
  for (const report of [cp1, smokeWithMatchingDrift]) {
    for (const result of report.results) {
      const cellEvidence = result.evidence as
        | CloudProvisionTurnEvidenceV1
        | ManagedCloudFixtureSmokeEvidenceV1;
      cellEvidence.artifact_ids = cellEvidence.artifact_ids.map((artifactId) =>
        artifactId === TEMPLATE_ARTIFACT_ID ? "e2b-template/another-run" : artifactId,
      );
    }
  }
  await expectCode("template_mismatch", { cp1, smoke: smokeWithMatchingDrift });
});

test("rejects a different run, shard, or source identity", async () => {
  for (const [field, value] of [
    ["run_id", "another-run"],
    ["shard_id", "2"],
    ["source_sha", "9".repeat(40)],
  ] as const) {
    const smoke = smokeReport();
    smoke.run[field] = value;
    await expectCode("identity_mismatch", { smoke });
  }
});

test("requires CP1 to transfer rather than delete the shared template", async () => {
  const cp1 = cp1Report();
  const evidence = cp1.results[0]!.evidence as CloudProvisionTurnEvidenceV1;
  evidence.cleanup.template_deleted = true;
  evidence.cleanup.template_custody_transferred = false;
  await expectCode("cp1_contract_mismatch", { cp1 });
});

test("rejects template id, build, or input-hash drift in any smoke cell", async () => {
  for (const [field, value] of [
    ["e2b_template_id", "tmpl_other"],
    ["e2b_template_build_id", "build_other"],
    ["e2b_template_input_hash", "8".repeat(64)],
  ] as const) {
    const smoke = smokeReport();
    const evidence = smoke.results[2]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
    evidence.world[field] = value;
    await expectCode("template_mismatch", { smoke });
  }
});

test("requires all five fixture cells including cleanup replay", async () => {
  await expectCode("smoke_contract_mismatch", {
    smoke: smokeReport(SMOKE_CELLS.filter((cell) => cell !== "cleanup-replay")),
  });
});

test("rejects a smoke result whose evidence names another cell", async () => {
  const smoke = smokeReport();
  const evidence = smoke.results[0]!.evidence as ManagedCloudFixtureSmokeEvidenceV1;
  evidence.cells[0]!.cell_id = smoke.results[1]!.cell_id;
  await expectCode("smoke_contract_mismatch", { smoke });
});

test("rejects a released custody receipt for another immutable build", async () => {
  await expectCode("template_mismatch", {
    receipt: { ...TEMPLATE_RECEIPT, buildId: "build_other" },
  });
});

test("requires custody to be released with the exact acquired receipt", async () => {
  await expectCode("invalid_custody", { releaseCustody: false });
});
