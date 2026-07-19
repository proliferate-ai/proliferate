import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateReportV4,
  type CloudProvisionTurnEvidenceV1,
  type ManagedCloudFixtureSmokeEvidenceV1,
  type TestRunReportV4,
} from "../evidence/schema.js";
import {
  loadSharedTemplateCustody,
  type SharedTemplateReleasedCustodyV1,
} from "../worlds/managed-cloud/shared-template-custody.js";

const CP1_SCENARIO = "CLOUD-PROVISION-1";
const SMOKE_SCENARIO = "MANAGED-CLOUD-FIXTURE-SMOKE-1";
const REQUIRED_SMOKE_CELLS = new Set([
  "callback-relay",
  "stripe-test-clock",
  "billing-threshold",
  "failure-injection",
  "cleanup-replay",
]);

export type ManagedCloudHandoffFailureCode =
  | "invalid_invocation"
  | "invalid_cp1_report"
  | "invalid_smoke_report"
  | "invalid_custody"
  | "identity_mismatch"
  | "candidate_mismatch"
  | "cp1_contract_mismatch"
  | "smoke_contract_mismatch"
  | "template_mismatch";

export class ManagedCloudHandoffError extends Error {
  constructor(
    readonly code: ManagedCloudHandoffFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ManagedCloudHandoffError";
  }
}

export interface VerifyManagedCloudHandoffPaths {
  cp1Report: string;
  smokeReport: string;
  custody: string;
}

export interface ManagedCloudHandoffStatus {
  kind: "proliferate.managed-cloud-handoff-verification";
  status: "verified";
}

interface TemplateIdentity {
  artifactId: string;
  candidateApiArtifactId: string;
  templateId: string;
  buildId: string;
  inputHash: string;
}

/**
 * Verifies the parent-run handoff after both strict managed-cloud commands
 * have exited. It consumes only persisted V4 reports and the 0600 custody
 * journal; it performs no provider calls and emits no raw evidence identity.
 */
export async function verifyManagedCloudHandoff(
  paths: VerifyManagedCloudHandoffPaths,
): Promise<ManagedCloudHandoffStatus> {
  const cp1 = await loadReport(paths.cp1Report, "invalid_cp1_report");
  const smoke = await loadReport(paths.smokeReport, "invalid_smoke_report");
  const custody = await loadReleasedCustody(paths.custody);

  requireStrictGreen(cp1, "cp1_contract_mismatch");
  requireStrictGreen(smoke, "smoke_contract_mismatch");
  requireSharedIdentity(cp1, smoke, custody);
  requireSameCandidate(cp1, smoke);

  const template = requireCp1Template(cp1);
  requireSmokeContract(smoke, template);
  requireCustodyTemplate(custody, template);

  return { kind: "proliferate.managed-cloud-handoff-verification", status: "verified" };
}

async function loadReport(
  filePath: string,
  code: "invalid_cp1_report" | "invalid_smoke_report",
): Promise<TestRunReportV4> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as TestRunReportV4;
    validateReportV4(parsed);
    return parsed;
  } catch {
    throw new ManagedCloudHandoffError(code, "The selected report is not a valid V4 qualification report.");
  }
}

async function loadReleasedCustody(filePath: string): Promise<SharedTemplateReleasedCustodyV1> {
  try {
    const custody = await loadSharedTemplateCustody(filePath);
    if (custody.state !== "released" || custody.receipt === null) {
      throw new Error("not released with a receipt");
    }
    return custody;
  } catch {
    throw new ManagedCloudHandoffError(
      "invalid_custody",
      "Shared-template custody is not a valid released receipt.",
    );
  }
}

function requireStrictGreen(
  report: TestRunReportV4,
  code: "cp1_contract_mismatch" | "smoke_contract_mismatch",
): void {
  if (
    report.run.behavior !== "strict" ||
    report.run.execution !== "real" ||
    report.results.length === 0 ||
    report.results.some((result) => result.status !== "green")
  ) {
    throw new ManagedCloudHandoffError(code, "The report is not a real strict run with every selected cell green.");
  }
}

function requireSharedIdentity(
  cp1: TestRunReportV4,
  smoke: TestRunReportV4,
  custody: SharedTemplateReleasedCustodyV1,
): void {
  const matches =
    cp1.run.run_id === smoke.run.run_id &&
    cp1.run.shard_id === smoke.run.shard_id &&
    cp1.run.source_sha === smoke.run.source_sha &&
    cp1.run.run_id === custody.run_id &&
    cp1.run.shard_id === custody.shard_id &&
    cp1.run.source_sha === custody.source_sha;
  if (!matches) {
    throw new ManagedCloudHandoffError(
      "identity_mismatch",
      "The two reports and custody journal do not share one run, shard, and source SHA.",
    );
  }
}

/** Canonical digest of the bounded candidate identity persisted in V4. */
export function candidateArtifactSetDigest(report: TestRunReportV4): string {
  if (report.candidate_build === null) {
    throw new ManagedCloudHandoffError("candidate_mismatch", "A handoff report has no candidate identity.");
  }
  const artifacts = report.candidate_build.artifacts
    .map((artifact) => ({
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      sha256: artifact.sha256,
    }))
    .sort((left, right) =>
      left.artifact_id < right.artifact_id ? -1 : left.artifact_id > right.artifact_id ? 1 : 0,
    );
  return createHash("sha256").update(JSON.stringify(artifacts)).digest("hex");
}

function requireSameCandidate(cp1: TestRunReportV4, smoke: TestRunReportV4): void {
  if (candidateArtifactSetDigest(cp1) !== candidateArtifactSetDigest(smoke)) {
    throw new ManagedCloudHandoffError(
      "candidate_mismatch",
      "The smoke did not reuse the exact CP1 candidate artifact set.",
    );
  }
}

function requireCp1Template(report: TestRunReportV4): TemplateIdentity {
  if (report.results.length !== 1 || report.results[0]?.scenario_id !== CP1_SCENARIO) {
    throw new ManagedCloudHandoffError(
      "cp1_contract_mismatch",
      "The producer report is not exactly one CLOUD-PROVISION-1 cell.",
    );
  }
  const evidence = report.results[0].evidence;
  if (evidence?.kind !== "cloud_provision_turn") {
    throw new ManagedCloudHandoffError(
      "cp1_contract_mismatch",
      "The CP1 result does not carry cloud-provision evidence.",
    );
  }
  requireTransferredCleanup(evidence);
  const dynamicArtifacts = requireEvidenceArtifactBinding(report, evidence.artifact_ids);
  return {
    artifactId: dynamicArtifacts.templateArtifactId,
    candidateApiArtifactId: dynamicArtifacts.candidateApiArtifactId,
    templateId: evidence.template.template_id,
    buildId: evidence.template.build_id,
    inputHash: evidence.template.input_hash,
  };
}

function requireTransferredCleanup(evidence: CloudProvisionTurnEvidenceV1): void {
  if (evidence.cleanup.template_custody_transferred !== true || evidence.cleanup.template_deleted !== false) {
    throw new ManagedCloudHandoffError(
      "cp1_contract_mismatch",
      "CP1 did not preserve the template through an exclusive durable custody transfer.",
    );
  }
}

function requireSmokeContract(report: TestRunReportV4, template: TemplateIdentity): void {
  if (report.results.length !== REQUIRED_SMOKE_CELLS.size) {
    throw new ManagedCloudHandoffError(
      "smoke_contract_mismatch",
      "The fixture-smoke report does not contain the complete five-cell matrix.",
    );
  }
  const observed = new Set<string>();
  for (const result of report.results) {
    const cell = result.dimensions.cell;
    const evidence = result.evidence;
    if (
      result.scenario_id !== SMOKE_SCENARIO ||
      typeof cell !== "string" ||
      !REQUIRED_SMOKE_CELLS.has(cell) ||
      evidence?.kind !== "managed_cloud_fixture_smoke" ||
      evidence.cells[0]?.cell_id !== result.cell_id
    ) {
      throw new ManagedCloudHandoffError(
        "smoke_contract_mismatch",
        "The fixture-smoke report contains an unexpected or unevidenced cell.",
      );
    }
    observed.add(cell);
    requireSmokeTemplate(evidence, template, report.run.source_sha);
    const dynamicArtifacts = requireEvidenceArtifactBinding(
      report,
      evidence.artifact_ids,
      evidence.world.server_digest,
    );
    if (
      dynamicArtifacts.templateArtifactId !== template.artifactId ||
      dynamicArtifacts.candidateApiArtifactId !== template.candidateApiArtifactId
    ) {
      throw new ManagedCloudHandoffError(
        "candidate_mismatch",
        "A fixture-smoke cell does not name the exact CP1 dynamic artifact identities.",
      );
    }
  }
  if (observed.size !== REQUIRED_SMOKE_CELLS.size || !observed.has("cleanup-replay")) {
    throw new ManagedCloudHandoffError(
      "smoke_contract_mismatch",
      "The fixture-smoke report is missing a required independently green cell.",
    );
  }
}

/**
 * Binds one cell's evidence artifact list to the candidate map. The six
 * candidate artifacts must appear exactly once; the only permitted dynamic
 * additions are the one run-built E2B template and one deployed candidate API.
 */
function requireEvidenceArtifactBinding(
  report: TestRunReportV4,
  artifactIds: readonly string[],
  serverDigest?: string,
): { templateArtifactId: string; candidateApiArtifactId: string } {
  if (report.candidate_build === null) {
    throw new ManagedCloudHandoffError("candidate_mismatch", "A handoff report has no candidate identity.");
  }
  const candidateIds = report.candidate_build.artifacts.map((artifact) => artifact.artifact_id);
  const observed = new Set(artifactIds);
  if (
    observed.size !== artifactIds.length ||
    candidateIds.some((artifactId) => !observed.has(artifactId))
  ) {
    throw new ManagedCloudHandoffError(
      "candidate_mismatch",
      "Cloud evidence does not contain every exact candidate artifact exactly once.",
    );
  }
  const dynamicIds = artifactIds.filter((artifactId) => !candidateIds.includes(artifactId));
  const templateIds = dynamicIds.filter((artifactId) => artifactId.startsWith("e2b-template/"));
  const candidateApiIds = dynamicIds.filter((artifactId) => artifactId.startsWith("candidate-api/"));
  if (
    dynamicIds.length !== 2 ||
    templateIds.length !== 1 ||
    candidateApiIds.length !== 1
  ) {
    throw new ManagedCloudHandoffError(
      "candidate_mismatch",
      "Cloud evidence has missing or unexpected dynamic artifact identities.",
    );
  }
  if (serverDigest !== undefined) {
    const server = report.candidate_build.artifacts.find(
      (artifact) => artifact.artifact_id === "server/linux/amd64",
    );
    if (!server || server.sha256 !== serverDigest) {
      throw new ManagedCloudHandoffError(
        "candidate_mismatch",
        "Fixture-smoke server digest does not match the exact candidate server artifact.",
      );
    }
  }
  return {
    templateArtifactId: templateIds[0]!,
    candidateApiArtifactId: candidateApiIds[0]!,
  };
}

function requireSmokeTemplate(
  evidence: ManagedCloudFixtureSmokeEvidenceV1,
  template: TemplateIdentity,
  sourceSha: string,
): void {
  if (
    evidence.world.source_sha !== sourceSha ||
    evidence.world.e2b_template_id !== template.templateId ||
    evidence.world.e2b_template_build_id !== template.buildId ||
    evidence.world.e2b_template_input_hash !== template.inputHash
  ) {
    throw new ManagedCloudHandoffError(
      "template_mismatch",
      "A fixture-smoke cell does not name the exact CP1 template identity.",
    );
  }
}

function requireCustodyTemplate(custody: SharedTemplateReleasedCustodyV1, template: TemplateIdentity): void {
  if (
    !custody.receipt ||
    custody.receipt.artifact_id !== template.artifactId ||
    custody.input_hash !== template.inputHash ||
    custody.receipt.inputHash !== template.inputHash ||
    custody.receipt.templateId !== template.templateId ||
    custody.receipt.buildId !== template.buildId
  ) {
    throw new ManagedCloudHandoffError(
      "template_mismatch",
      "The released custody receipt does not bind the exact CP1 template identity.",
    );
  }
}

function parseArgs(argv: string[]): VerifyManagedCloudHandoffPaths {
  const values = new Map<string, string>();
  const allowed = new Set(["--cp1-report", "--smoke-report", "--custody"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !allowed.has(flag) || !value || value.startsWith("--") || values.has(flag)) {
      throw new ManagedCloudHandoffError(
        "invalid_invocation",
        "Usage: verify-managed-cloud-handoff --cp1-report <path> --smoke-report <path> --custody <path>",
      );
    }
    values.set(flag, value);
  }
  if (values.size !== allowed.size) {
    throw new ManagedCloudHandoffError(
      "invalid_invocation",
      "Usage: verify-managed-cloud-handoff --cp1-report <path> --smoke-report <path> --custody <path>",
    );
  }
  return {
    cp1Report: values.get("--cp1-report")!,
    smokeReport: values.get("--smoke-report")!,
    custody: values.get("--custody")!,
  };
}

async function main(): Promise<void> {
  const status = await verifyManagedCloudHandoff(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(status));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const code = error instanceof ManagedCloudHandoffError ? error.code : "invalid_invocation";
    console.error(JSON.stringify({
      kind: "proliferate.managed-cloud-handoff-verification",
      status: "invalid",
      reason_code: code,
    }));
    process.exit(2);
  });
}
