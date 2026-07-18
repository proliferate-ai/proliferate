import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const release = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-e2e.yml"), "utf8");
const selfhost = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-e2e-selfhost.yml"), "utf8");
const hardCancel = readFileSync(
  path.join(REPO_ROOT, ".github/workflows/release-e2e-hard-cancel-cleanup.yml"),
  "utf8",
);

function job(source: string, id: string): string {
  const start = source.indexOf(`  ${id}:`);
  assert.ok(start >= 0, `missing job ${id}`);
  const remainder = source.slice(start + id.length + 3);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  const end = nextJob?.index === undefined ? undefined : start + id.length + 3 + nextJob.index;
  return source.slice(start, end);
}

test("release qualification has stable independent concurrency groups by world", () => {
  const workflowHeader = release.slice(0, release.indexOf("\njobs:"));
  const selfhostHeader = selfhost.slice(0, selfhost.indexOf("\njobs:"));
  assert.doesNotMatch(workflowHeader, /^concurrency:/m, "one global group would serialize unrelated worlds");
  assert.doesNotMatch(selfhostHeader, /^concurrency:/m, "one global group would serialize unrelated worlds");

  assert.match(job(release, "release-e2e-local"), /group: release-e2e-local/);
  assert.match(job(release, "release-e2e-local-functional"), /group: release-e2e-local/);
  assert.match(job(release, "release-e2e-managed-cloud"), /group: release-e2e-managed-cloud/);
  assert.match(job(release, "release-e2e-selfhost-install"), /group: release-e2e-self-host/);
  assert.match(job(release, "qualification-tier2"), /group: release-e2e-tier2/);
  assert.match(job(selfhost, "artifact-chain"), /group: release-e2e-tier4/);
  assert.match(job(selfhost, "provisioning"), /group: release-e2e-self-host/);
  assert.match(job(release, "release-e2e-local"), /if: github\.event_name == 'schedule'/);
  assert.match(job(release, "release-e2e-local-functional"), /inputs\.manual_world == 'local'/);

  for (const source of [release, selfhost]) {
    assert.doesNotMatch(source, /cancel-in-progress: true/);
  }
});

test("manual dispatch can isolate one qualification world", () => {
  const workflowHeader = release.slice(0, release.indexOf("\njobs:"));
  assert.match(workflowHeader, /manual_world:/);
  for (const world of ["all", "local", "managed-cloud", "tier2", "staging"]) {
    assert.match(workflowHeader, new RegExp(`- ${world}`));
  }

  assert.match(job(release, "release-e2e-local-functional"), /inputs\.manual_world == 'local'/);
  assert.match(job(release, "release-e2e-managed-cloud"), /inputs\.manual_world == 'managed-cloud'/);
  assert.match(job(release, "qualification-tier2"), /inputs\.manual_world == 'tier2'/);
  assert.match(job(release, "release-e2e-staging"), /inputs\.manual_world == 'staging'/);
});

test("the manual local world builds and publishes once, then reuses exact candidates", () => {
  const local = job(release, "release-e2e-local-functional");
  assert.equal((local.match(/make qualification-local-workspace/g) ?? []).length, 1);
  assert.equal((local.match(/make qualification-local-functional/g) ?? []).length, 1);
  assert.match(local, /REUSE_CANDIDATES="\$candidate_dir"/);
  assert.match(local, /candidate-build\.json/);
  assert.match(local, /local-world-ports\.json/);
  assert.match(local, /\/artifacts\//);
  assert.doesNotMatch(release, /^  release-e2e-local-world-smoke:/m);
});

test("the manual local world reuses candidates only after a clean smoke exit", () => {
  const local = job(release, "release-e2e-local-functional");
  const smoke = local.indexOf("make qualification-local-workspace");
  const smokeResult = local.indexOf("BEHAVIOR=strict || smoke_rc=$?");
  const candidatePublication = local.indexOf('candidate_dir="${GITHUB_WORKSPACE}');
  const cleanSmokeGate = local.indexOf(
    'if [ "$smoke_rc" -ne 0 ]; then exit "$smoke_rc"; fi',
  );
  const functional = local.indexOf("make qualification-local-functional");
  const evidenceUpload = local.indexOf("- name: Upload V4 report and bounded diagnostic logs");
  const alwaysUpload = local.indexOf("if: always()", evidenceUpload);
  const candidateMapUpload = local.indexOf("candidate-build.json", evidenceUpload);

  assert.ok(smoke >= 0);
  assert.ok(smokeResult > smoke);
  assert.ok(candidatePublication > smokeResult);
  assert.ok(cleanSmokeGate > candidatePublication);
  assert.ok(functional > cleanSmokeGate);
  assert.ok(evidenceUpload > functional);
  assert.ok(alwaysUpload > evidenceUpload);
  assert.ok(candidateMapUpload > alwaysUpload);
});

test("the Tier 4 artifact-chain preflight describes read-only published artifacts", () => {
  const artifactChain = job(selfhost, "artifact-chain");
  const preflight = artifactChain.indexOf("qualification-preflight.mjs");
  const scenario = artifactChain.indexOf("make release-e2e");

  assert.ok(preflight >= 0);
  assert.ok(scenario > preflight);
  assert.match(artifactChain, /--world tier4/);
  assert.match(artifactChain, /--scenarios T4-SH-2/);
  assert.match(artifactChain, /--artifact-mode external/);
  assert.doesNotMatch(artifactChain, /--artifact-mode build/);
  assert.doesNotMatch(artifactChain, /--candidate-build-map/);
});

test("provider-backed jobs run shared preflight before build/provider setup", () => {
  const local = job(release, "release-e2e-local-functional");
  const selfHost = job(release, "release-e2e-selfhost-install");
  const managed = job(release, "release-e2e-managed-cloud");
  for (const [body, marker] of [
    [local, "--world local"],
    [selfHost, "--world self-host"],
    [managed, "--world managed-cloud"],
  ] as const) {
    assert.ok(body.indexOf(marker) >= 0);
    assert.ok(body.indexOf(marker) < body.indexOf("pnpm/action-setup"));
    assert.match(body, /qualification-preflight\.json/);
  }
  assert.ok(managed.indexOf("--world managed-cloud") < managed.indexOf("Install MUSL target"));
  assert.ok(selfHost.indexOf("--world self-host") < selfHost.indexOf("Configure AWS credentials"));
  assert.ok(managed.indexOf("Fetch the trusted default-branch cleanup authorization") < managed.indexOf("--world managed-cloud"));
  assert.match(managed, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(managed, /--cleanup-attestation-default-branch/);
  assert.match(managed, /--cleanup-attestation-repository/);
  for (const name of [
    "RELEASE_E2E_SELFHOST_REGION",
    "RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID",
    "RELEASE_E2E_SELFHOST_INSTANCE_TYPE",
    "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
    "RELEASE_E2E_SELFHOST_CFN_BUCKET",
    "RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO",
    "SELFHOST_CELLS_INPUT",
  ]) {
    assert.match(selfHost, new RegExp(`${name}:`), `self-host preflight must receive ${name}`);
  }
  for (const name of [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_E2B_TEAM_ID",
    "RELEASE_E2E_CLOUD_AWS_REGION",
    "RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]) {
    assert.match(managed, new RegExp(`${name}:`), `managed preflight must receive ${name}`);
  }
});

test("supported cancellation keeps local receipts and hard cancellation keeps the trusted managed reaper", () => {
  for (const id of ["release-e2e-local-functional", "release-e2e-selfhost-install", "release-e2e-managed-cloud"]) {
    const body = job(release, id);
    assert.match(body, /if: always\(\)/);
    assert.match(body, /cancellation-finalization\.json/);
  }
  assert.match(hardCancel, /workflow_run:\s*\n\s*workflows: \["Release E2E \(tier 3\)"\]/);
  assert.match(hardCancel, /Reconcile exact run-owned managed-cloud AWS resources/);
  assert.match(hardCancel, /Reconcile exact run-owned E2B, Stripe, and LiteLLM resources/);
  assert.doesNotMatch(hardCancel, /workflow_dispatch/);
});
