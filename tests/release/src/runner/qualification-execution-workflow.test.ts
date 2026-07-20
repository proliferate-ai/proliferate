import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const release = readFileSync(path.join(REPO_ROOT, ".github/workflows/release-e2e.yml"), "utf8");
const makefile = readFileSync(path.join(REPO_ROOT, "Makefile"), "utf8");
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

function makeTarget(name: string): string {
  const startMatch = new RegExp(`^${name}:\\s*$`, "m").exec(makefile);
  assert.ok(startMatch?.index !== undefined, `missing Make target ${name}`);
  const start = startMatch.index;
  const remainder = makefile.slice(start + startMatch[0].length);
  const nextTarget = /^[-A-Za-z0-9_.]+:\s*$/m.exec(remainder);
  const end = nextTarget?.index === undefined
    ? undefined
    : start + startMatch[0].length + nextTarget.index;
  return makefile.slice(start, end);
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

test("a self-host dispatch cannot launch unrelated release worlds", () => {
  assert.match(
    job(release, "release-e2e-selfhost-install"),
    /if: github\.event_name == 'workflow_dispatch' && inputs\.selfhost/,
  );
  for (const id of ["qualification-tier2", "release-e2e-local-functional", "release-e2e-managed-cloud"]) {
    assert.match(
      job(release, id),
      /github\.event_name == 'workflow_dispatch' &&\s+!inputs\.selfhost &&/,
      `${id} must stay out of a self-host-only dispatch`,
    );
  }
  assert.match(
    job(release, "release-e2e-staging"),
    /github\.event_name == 'schedule' \|\|\s+\(github\.event_name == 'workflow_dispatch' &&\s+!inputs\.selfhost &&/,
    "release-e2e-staging must stay out of a self-host-only dispatch while retaining its schedule",
  );
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

test("the manual local world preserves the typed agent selector through preflight and execution", () => {
  const local = job(release, "release-e2e-local-functional");
  const preflight = local.slice(0, local.indexOf("pnpm/action-setup"));
  const execution = local.slice(local.indexOf("Build once, run the smoke"));

  assert.match(preflight, /AGENTS_INPUT: \$\{\{ inputs\.agents \}\}/);
  assert.match(preflight, /--agents "\$\{AGENTS_INPUT\}"/);
  assert.match(preflight, /BEHAVIOR_INPUT: \$\{\{ inputs\.local_functional_behavior \}\}/);
  assert.match(preflight, /--behavior "\$\{BEHAVIOR_INPUT\}"/);
  assert.match(execution, /AGENTS: \$\{\{ inputs\.agents \}\}/);
  assert.match(execution, /BEHAVIOR: \$\{\{ inputs\.local_functional_behavior \}\}/);
  assert.doesNotMatch(local, /github\.event\.inputs\.agents \|\|/);
});

test("the real Local Make entrypoints pass matching selectors through their mandatory preflights", () => {
  const smokeTarget = makeTarget("qualification-local-workspace");
  const functionalTarget = makeTarget("qualification-local-functional");
  assert.equal((smokeTarget.match(/--agents claude --behavior "\$\(BEHAVIOR\)"/g) ?? []).length, 2);
  assert.equal((functionalTarget.match(/--agents "\$\(AGENTS\)" --behavior "\$\(BEHAVIOR\)"/g) ?? []).length, 2);

  const dir = mkdtempSync(path.join(os.tmpdir(), "qualification-local-make-selectors-"));
  try {
    const nodeShim = path.join(dir, "node");
    const pnpmShim = path.join(dir, "pnpm");
    writeFileSync(
      nodeShim,
      [
        "#!/bin/sh",
        'if [ "$1" = "scripts/ci-cd/build-local-qualification-candidates.mjs" ]; then',
        "  printf '%s\\n' '{\"candidate_build_map\":\"/tmp/fake-local-candidate-build.json\"}'",
        "  exit 0",
        "fi",
        'exec "$REAL_NODE" "$@"',
        "",
      ].join("\n"),
    );
    writeFileSync(pnpmShim, "#!/bin/sh\nexit 0\n");
    chmodSync(nodeShim, 0o755);
    chmodSync(pnpmShim, 0o755);

    const baseDir = path.join(dir, "output");
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      REAL_NODE: process.execPath,
      GITHUB_ACTIONS: "true",
      AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.qualification.invalid",
      AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://gateway.qualification.invalid",
      AGENT_GATEWAY_LITELLM_MASTER_KEY: "test-master-secret",
      RELEASE_E2E_INTEGRATION_NAMESPACE: "exa",
      RELEASE_E2E_INTEGRATION_API_KEY: "test-integration-secret",
    };
    const smoke = spawnSync(
      "make",
      [
        "qualification-local-workspace",
        "PROFILE=selector-smoke",
        "BEHAVIOR=strict",
        `QUALIFICATION_LOCAL_WORLD_BASE_DIR=${baseDir}`,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env },
    );
    assert.equal(smoke.status, 0, `${smoke.stdout}\n${smoke.stderr}`);
    const smokeReceipt = JSON.parse(
      readFileSync(path.join(baseDir, "ql-selector-smoke", "1", "preflight", "qualification-preflight.json"), "utf8"),
    );
    assert.equal(smokeReceipt.verdict, "passed");
    assert.equal(smokeReceipt.behavior, "strict");
    assert.deepEqual(smokeReceipt.selected_scenarios, ["LOCAL-WORLD-SMOKE-1"]);
    assert.deepEqual(smokeReceipt.selected_agents, ["claude"]);

    const functional = spawnSync(
      "make",
      [
        "qualification-local-functional",
        "PROFILE=selector-functional",
        "BEHAVIOR=strict",
        "AGENTS=claude,codex,grok,opencode",
        "SCENARIOS=T3-CHAT-1,T3-CFG-1,T3-INT-1",
        `QUALIFICATION_LOCAL_WORLD_BASE_DIR=${baseDir}`,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env },
    );
    assert.equal(functional.status, 0, `${functional.stdout}\n${functional.stderr}`);
    const functionalReceipt = JSON.parse(
      readFileSync(path.join(baseDir, "qlf-selector-functional", "1", "preflight", "qualification-preflight.json"), "utf8"),
    );
    assert.equal(functionalReceipt.verdict, "passed");
    assert.equal(functionalReceipt.behavior, "strict");
    assert.deepEqual(functionalReceipt.selected_scenarios, ["T3-CFG-1", "T3-CHAT-1", "T3-INT-1"]);
    assert.deepEqual(functionalReceipt.selected_agents, ["claude", "codex", "grok", "opencode"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("the managed-cloud derivative world refreshes trusted cleanup authority after CP1", () => {
  const managed = job(release, "release-e2e-managed-cloud");
  const cp1 = managed.indexOf("Build candidates and run CLOUD-PROVISION-1 (strict)");
  const refresh = managed.indexOf("Refresh trusted default-branch cleanup authorization before fixture smoke");
  const fixtureSmoke = managed.indexOf("Reuse candidates and run MANAGED-CLOUD-FIXTURE-SMOKE-1 (strict)");

  assert.ok(cp1 >= 0);
  assert.ok(refresh > cp1);
  assert.ok(fixtureSmoke > refresh);
  assert.equal((managed.match(/path: \.qualification-trusted-default/g) ?? []).length, 2);
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

test("the self-host execution step authenticates run-scoped GHCR cleanup without argv exposure", () => {
  const selfHost = job(release, "release-e2e-selfhost-install");
  const executionStart = selfHost.indexOf(
    "- name: Run the selected self-host scenarios and cleanup (strict, credential-bounded)",
  );
  const executionEnd = selfHost.indexOf(
    "- name: Upload V4 report and bounded diagnostic logs",
    executionStart,
  );
  assert.ok(executionStart >= 0 && executionEnd > executionStart, "self-host execution step boundary missing");
  const executionStep = selfHost.slice(executionStart, executionEnd);

  assert.match(executionStep, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(
    executionStep,
    /(?:make qualification-selfhost|gh api)[^\n]*GH_TOKEN/,
    "the token must be inherited from the step environment, never placed on argv",
  );
});

test("the self-host job finishes long local builds before AWS and bounds provider cleanup below the session", () => {
  const selfHost = job(release, "release-e2e-selfhost-install");
  const crossInstall = selfHost.indexOf("Install cross for exact arm64 self-host runtime");
  const dependencies = selfHost.indexOf("Install workspace dependencies");
  const candidateBuild = selfHost.indexOf("Validate inputs and build exact self-host candidates before AWS credentials");
  const ghcrLogin = selfHost.indexOf("Log in to GHCR (SELFHOST-CFN-1 candidate image push)");
  const aws = selfHost.indexOf("Configure AWS credentials");
  const provider = selfHost.indexOf("Run the selected self-host scenarios and cleanup (strict, credential-bounded)");
  assert.ok(crossInstall >= 0 && crossInstall < dependencies);
  assert.ok(dependencies < candidateBuild && candidateBuild < ghcrLogin);
  assert.ok(ghcrLogin < aws && aws < provider);
  assert.match(selfHost, /if: inputs\.selfhost_candidate_platform == 'linux\/arm64'/);
  assert.match(selfHost, /cargo install cross --git https:\/\/github\.com\/cross-rs\/cross --locked/);
  assert.match(selfHost, /timeout-minutes: 150/);
  assert.match(selfHost.slice(candidateBuild, ghcrLogin), /QUALIFICATION_SELFHOST_PHASE=build/);
  assert.match(selfHost.slice(provider), /QUALIFICATION_SELFHOST_PHASE=run/);

  const roleSeconds = Number(/role-duration-seconds: (\d+)/.exec(selfHost)?.[1]);
  const providerMinutes = Number(/timeout-minutes: (\d+)/.exec(selfHost.slice(provider))?.[1]);
  assert.equal(roleSeconds, 7200);
  assert.equal(providerMinutes, 110);
  assert.ok(providerMinutes * 60 < roleSeconds, "provider execution+cleanup must expire before AWS credentials");
  assert.doesNotMatch(
    selfHost.slice(aws, provider),
    /pnpm install|cargo install cross|build-selfhost-qualification-candidates|QUALIFICATION_SELFHOST_PHASE=build/,
    "no long local build may consume the AWS credential window",
  );
});

test("the self-host Make split revalidates the exact candidate map before the provider phase", () => {
  const start = makefile.indexOf("qualification-selfhost:");
  const end = makefile.indexOf("\n# \"Prove One Real Managed-Cloud Workspace\"", start);
  assert.ok(start >= 0 && end > start);
  const target = makefile.slice(start, end);
  assert.match(makefile, /QUALIFICATION_SELFHOST_PHASE \?= all/);
  assert.match(target, /all\|build\|run/);
  assert.match(target, /candidate_map="\$\$run_dir\/candidate-build\.json"/);
  assert.match(target, /--artifact-mode reuse/);
  assert.match(target, /--candidate-build-map "\$\$candidate_map"/);
  assert.match(target, /if \[ "\$\$phase" = "build" \]; then exit 0; fi/);
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

// The self-host cell selector's literal "all" must mean "no cell filter" — the
// same contract qualification-preflight.mjs's parseSelector applies (and the
// preflight step in this very job defaults to `--cells all`). Run 29630600180
// failed closed in 49s on `selfhost_cells=all`; these tests EXECUTE the job's
// real validator shell (everything before the make invocation) so the workflow
// and runner contracts cannot drift apart silently again.
function selfHostValidatorScript(): string {
  const body = job(release, "release-e2e-selfhost-install");
  const runStart = body.indexOf("set -euo pipefail");
  const runEnd = body.indexOf("make qualification-selfhost");
  assert.ok(runStart >= 0 && runEnd > runStart, "self-host validator shell not found");
  return body
    .slice(runStart, runEnd)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function runSelfHostValidator(env: Record<string, string>): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const script = `${selfHostValidatorScript()}\nprintf 'CELLS_ARG=%s\\n' "$cells_arg"\n`;
  const result = spawnSync("bash", ["-c", script], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('self-host cell selector treats literal "all" as no cell filter (runner/preflight contract)', () => {
  for (const value of ["all", " all "]) {
    const run = runSelfHostValidator({ SELFHOST_CELLS_INPUT: value });
    assert.equal(run.status, 0, `selfhost_cells=${JSON.stringify(value)} must not fail closed: ${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /CELLS_ARG=\n/, "literal all must normalize to an empty (unfiltered) cell selector");
  }
});

test("self-host cell selector still fails closed on unknown cells and keeps real filters", () => {
  const unknown = runSelfHostValidator({ SELFHOST_CELLS_INPUT: "SH-NOT-A-CELL" });
  assert.equal(unknown.status, 2, "unknown cells must fail closed");
  const blank = runSelfHostValidator({ SELFHOST_CELLS_INPUT: " , ," });
  assert.equal(blank.status, 2, "explicit-but-empty selector must fail closed (PR7-CONTROL-005)");
  const gateway = runSelfHostValidator({ SELFHOST_CELLS_INPUT: "SH-GATEWAY" });
  assert.equal(gateway.status, 0);
  assert.match(gateway.stdout, /CELLS_ARG=SH-GATEWAY\n/);
});
