import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { assembleCandidateBuildMapFromArtifacts } from "./assemble-candidate-build-map.mjs";
import { PREFLIGHT_DEADLINE_MS, runQualificationPreflight, writePreflightReceipt } from "./qualification-preflight.mjs";

const SHA = "a".repeat(40);
const BASE = {
  world: "local",
  sourceSha: SHA,
  runId: "ql-test",
  shardId: "1",
  attempt: 1,
  scenarios: "LOCAL-WORLD-SMOKE-1",
  agents: "claude",
  behavior: "strict",
  artifactMode: "build",
};
const LOCAL_ENV = {
  AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.qualification.invalid",
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://gateway.qualification.invalid",
  AGENT_GATEWAY_LITELLM_MASTER_KEY: "super-secret-master-value",
};
const TEST_TLS_MATERIAL = JSON.parse(
  readFileSync(
    new URL("../../tests/release/fixtures/qualification-tls-test-material.json", import.meta.url),
    "utf8",
  ),
);
const TEST_TLS_ENV = {
  RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64: TEST_TLS_MATERIAL.certificateBase64,
  RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64: TEST_TLS_MATERIAL.privateKeyBase64,
};

test("invalid preflight fails before any caller can enter build or provider seams", () => {
  let built = false;
  let mutatedProvider = false;
  const receipt = runQualificationPreflight(BASE, { env: {} });
  if (receipt.verdict === "passed") {
    built = true;
    mutatedProvider = true;
  }
  assert.equal(receipt.verdict, "failed");
  assert.equal(built, false);
  assert.equal(mutatedProvider, false);
  assert.ok(receipt.duration_ms < PREFLIGHT_DEADLINE_MS);
  assert.match(JSON.stringify(receipt), /AGENT_GATEWAY_LITELLM_MASTER_KEY is missing/);
});

test("secret values never enter passed or failed machine-readable evidence", () => {
  const passed = runQualificationPreflight(BASE, { env: LOCAL_ENV });
  const invalid = runQualificationPreflight(BASE, {
    env: { ...LOCAL_ENV, AGENT_GATEWAY_LITELLM_BASE_URL: "https://user:super-secret-url@invalid.example" },
  });
  assert.equal(passed.verdict, "passed");
  assert.equal(invalid.verdict, "failed");
  for (const receipt of [passed, invalid]) {
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /super-secret-master-value/);
    assert.doesNotMatch(serialized, /super-secret-url/);
  }
});

test("strict local preflight binds an explicit four-agent selector before spend", () => {
  const receipt = runQualificationPreflight(
    {
      ...BASE,
      scenarios: "T3-CHAT-1,T3-CFG-1,T3-INT-1",
      agents: "claude,codex,grok,opencode",
    },
    {
      env: {
        ...LOCAL_ENV,
        RELEASE_E2E_INTEGRATION_NAMESPACE: "exa",
        RELEASE_E2E_INTEGRATION_API_KEY: "integration-secret",
      },
    },
  );
  assert.equal(receipt.verdict, "passed");
  assert.equal(receipt.behavior, "strict");
  assert.deepEqual(receipt.selected_agents, ["claude", "codex", "grok", "opencode"]);
  assert.ok(
    receipt.checks.some(
      (check) => check.id === "agent_catalog" && check.status === "passed" && /4 explicit/.test(check.message),
    ),
  );
});

test("strict local preflight rejects missing, malformed, and unknown selectors before spend", () => {
  const invalid = [
    [{ ...BASE, agents: undefined }, "agent_selection"],
    [{ ...BASE, scenarios: undefined }, "scenario_selection"],
    [{ ...BASE, agents: "claude,claude" }, "agent_selection"],
    [{ ...BASE, agents: "claude,not-a-shipped-agent" }, "agent_catalog"],
  ];
  for (const [options, failedCheckId] of invalid) {
    const receipt = runQualificationPreflight(options, { env: LOCAL_ENV });
    assert.equal(receipt.verdict, "failed");
    assert.ok(receipt.checks.some((check) => check.id === failedCheckId && check.status === "failed"));
  }
});

test("exact candidate map reuse preserves hashes and rejects a changed source identity", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qualification-preflight-cache-"));
  try {
    const artifact = path.join(dir, "anyharness");
    writeFileSync(artifact, "exact candidate bytes");
    const map = assembleCandidateBuildMapFromArtifacts({
      sourceSha: SHA,
      defaultVersion: "1.2.3",
      artifacts: [{ artifactId: "anyharness/x86_64-unknown-linux-gnu", path: artifact }],
    });
    const mapPath = path.join(dir, "candidate-build.json");
    writeFileSync(mapPath, `${JSON.stringify(map)}\n`);

    const hit = runQualificationPreflight(
      { ...BASE, artifactMode: "reuse", candidateBuildMap: mapPath },
      { env: LOCAL_ENV },
    );
    assert.equal(hit.verdict, "passed");
    assert.deepEqual(hit.candidate_build.artifacts, [
      {
        artifact_id: "anyharness/x86_64-unknown-linux-gnu",
        version: "1.2.3",
        sha256: map.artifacts[0].sha256,
      },
    ]);
    assert.match(hit.candidate_build.content_identity, /^[0-9a-f]{64}$/);

    const miss = runQualificationPreflight(
      { ...BASE, sourceSha: "b".repeat(40), artifactMode: "reuse", candidateBuildMap: mapPath },
      { env: LOCAL_ENV },
    );
    assert.equal(miss.verdict, "failed");
    assert.equal(miss.candidate_build, null);
    assert.ok(miss.checks.some((check) => check.id === "artifact_cache" && check.status === "failed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Tier 4 external mode claims no candidate build or local reuse", () => {
  const receipt = runQualificationPreflight(
    {
      ...BASE,
      world: "tier4",
      runId: "qt4-test",
      shardId: "artifact-chain",
      scenarios: "T4-SH-2",
      artifactMode: "external",
    },
    { env: {} },
  );

  assert.equal(receipt.verdict, "passed");
  assert.equal(receipt.artifact_mode, "external");
  assert.equal(receipt.candidate_build, null);
  const artifactCheck = receipt.checks.find((check) => check.id === "artifact_cache");
  assert.equal(artifactCheck?.status, "passed");
  assert.match(artifactCheck?.message ?? "", /No local candidate build or reuse is claimed/);
  assert.doesNotMatch(JSON.stringify(receipt), /one candidate build is required/);

  assert.equal(
    runQualificationPreflight({ ...BASE, artifactMode: "external" }, { env: LOCAL_ENV }).verdict,
    "failed",
    "external mode cannot bypass a world that owns local candidate preparation",
  );
  assert.equal(
    runQualificationPreflight(
      { ...BASE, world: "tier4", runId: "qt4-other", scenarios: "T4-RUNTIME-1", artifactMode: "external" },
      { env: {} },
    ).verdict,
    "failed",
    "external mode is bounded to the read-only scenario that validates published artifacts",
  );
  assert.equal(
    runQualificationPreflight(
      {
        ...BASE,
        world: "tier4",
        runId: "qt4-map",
        scenarios: "T4-SH-2",
        artifactMode: "external",
        candidateBuildMap: "/tmp/false-local-map.json",
      },
      { env: {} },
    ).verdict,
    "failed",
    "external mode cannot claim a local candidate-map identity",
  );
});

test("managed-cloud preflight requires exact trusted-revision cleanup authorization and a complete AWS posture", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qualification-preflight-attest-"));
  try {
    const attestation = path.join(dir, "attestations.json");
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
    git("init");
    git("config", "user.email", "qualification@example.invalid");
    git("config", "user.name", "Qualification Test");
    git("remote", "add", "origin", "https://github.com/proliferate-ai/proliferate.git");
    writeFileSync(
      attestation,
      `${JSON.stringify({ kind: "managed_cloud_litellm_attribution_attestations", schema_version: 1, source_shas: [SHA] })}\n`,
    );
    git("add", "attestations.json");
    git("commit", "-m", "trusted attestation fixture");
    const env = {
      ...TEST_TLS_ENV,
      AGENT_GATEWAY_LITELLM_BASE_URL: "https://admin.qualification.invalid",
      AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "https://gateway.qualification.invalid",
      AGENT_GATEWAY_LITELLM_MASTER_KEY: "master-secret",
      RELEASE_E2E_E2B_API_KEY: "e2b-secret",
      RELEASE_E2E_E2B_TEAM_ID: "team_qualification",
      RELEASE_E2E_CLOUD_AWS_REGION: "us-west-2",
      RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID: "Z123456789",
      RELEASE_E2E_CLOUD_GITHUB_APP_ID: "123",
      RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID: "Iv1.qualification",
      RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID: "456",
      RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY: "private-key-secret",
      RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET: "client-secret",
      AWS_ACCESS_KEY_ID: "access-secret",
      AWS_SECRET_ACCESS_KEY: "access-secret-pair",
    };
    const options = {
      ...BASE,
      world: "managed-cloud",
      runId: "qlc-ci-123-1",
      scenarios: "CLOUD-PROVISION-1",
      cleanupAttestations: attestation,
      cleanupAttestationRepository: dir,
      cleanupAttestationDefaultBranch: "main",
    };
    const trustedRevision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const deps = { env, resolveTrustedDefaultTip: () => trustedRevision };
    const authorized = runQualificationPreflight(options, deps);
    assert.equal(authorized.verdict, "passed");
    assert.match(authorized.cleanup_authorization_revision, /^[0-9a-f]{40}$/);

    writeFileSync(attestation, `${JSON.stringify({ kind: "candidate-authored", source_shas: [SHA] })}\n`);
    const workingTreeTamper = runQualificationPreflight(options, deps);
    assert.equal(workingTreeTamper.verdict, "passed", "preflight reads committed trusted bytes, not working-tree bytes");

    const untrusted = mkdtempSync(path.join(os.tmpdir(), "qualification-preflight-untrusted-"));
    try {
      execFileSync("git", ["-C", untrusted, "init"], { stdio: "ignore" });
      execFileSync("git", ["-C", untrusted, "config", "user.email", "qualification@example.invalid"]);
      execFileSync("git", ["-C", untrusted, "config", "user.name", "Qualification Test"]);
      execFileSync("git", ["-C", untrusted, "remote", "add", "origin", "https://example.invalid/fork.git"]);
      writeFileSync(path.join(untrusted, "attestations.json"), readFileSync(attestation));
      execFileSync("git", ["-C", untrusted, "add", "attestations.json"]);
      execFileSync("git", ["-C", untrusted, "commit", "-m", "untrusted"]);
      assert.equal(
        runQualificationPreflight(
          { ...options, cleanupAttestations: path.join(untrusted, "attestations.json"), cleanupAttestationRepository: untrusted },
          deps,
        ).verdict,
        "failed",
      );
    } finally {
      rmSync(untrusted, { recursive: true, force: true });
    }
    const nonDefault = runQualificationPreflight(options, {
      env,
      resolveTrustedDefaultTip: () => "b".repeat(40),
    });
    assert.equal(nonDefault.verdict, "failed", "canonical-origin non-default commits cannot self-authorize");
    const serialized = JSON.stringify(authorized);
    for (const secret of ["master-secret", "e2b-secret", "private-key-secret", "client-secret", "access-secret", "access-secret-pair"]) {
      assert.doesNotMatch(serialized, new RegExp(secret));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("self-host preflight scopes BYOK and instance requirements to selected scenarios", () => {
  const base = {
    ...BASE,
    world: "self-host",
    runId: "qs-test",
    scenarios: "SELFHOST-CFN-1",
  };
  const env = {
    RELEASE_E2E_SELFHOST_REGION: "us-west-2",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123456789",
    RELEASE_E2E_SELFHOST_CFN_BUCKET: "qualification-artifacts",
    RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO: "ghcr.io/proliferate-ai/qualification",
    AWS_PROFILE: "qualification",
  };
  const cfnOnly = runQualificationPreflight(base, { env });
  assert.equal(cfnOnly.verdict, "passed");
  assert.doesNotMatch(JSON.stringify(cfnOnly), /RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY/);
  assert.doesNotMatch(JSON.stringify(cfnOnly), /RELEASE_E2E_SELFHOST_INSTANCE_TYPE/);
  assert.equal(
    runQualificationPreflight(base, { env: { ...env, RELEASE_E2E_SELFHOST_CFN_BUCKET: "" } }).verdict,
    "failed",
  );

  const install = runQualificationPreflight({ ...base, scenarios: "SELFHOST-INSTALL-1" }, { env });
  assert.equal(install.verdict, "failed");
  assert.match(JSON.stringify(install), /RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY is missing/);
  assert.match(JSON.stringify(install), /RELEASE_E2E_SELFHOST_INSTANCE_TYPE is missing/);
  assert.match(JSON.stringify(install), /RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64 is missing/);
});

test("self-host preflight rejects unknown scenario and cell selectors", () => {
  const env = {
    RELEASE_E2E_SELFHOST_REGION: "us-west-2",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123456789",
    AWS_PROFILE: "qualification",
  };
  const options = { ...BASE, world: "self-host", runId: "qs-select" };
  assert.equal(runQualificationPreflight({ ...options, scenarios: "UNKNOWN-1" }, { env }).verdict, "failed");
  assert.equal(
    runQualificationPreflight({ ...options, scenarios: "SELFHOST-QUAL-1", cells: "SH-CFN-WRAPPER" }, { env }).verdict,
    "failed",
  );
});

test("AWS preflight rejects partial keys and accepts planned Actions OIDC", () => {
  const options = { ...BASE, world: "self-host", runId: "qs-oidc", scenarios: "SELFHOST-CFN-1" };
  const world = {
    RELEASE_E2E_SELFHOST_REGION: "us-west-2",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123456789",
    RELEASE_E2E_SELFHOST_CFN_BUCKET: "qualification-artifacts",
    RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO: "ghcr.io/proliferate-ai/qualification",
  };
  assert.equal(runQualificationPreflight(options, { env: { ...world, AWS_ACCESS_KEY_ID: "partial" } }).verdict, "failed");
  assert.equal(
    runQualificationPreflight(options, {
      env: {
        ...world,
        GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.invalid/token",
        RELEASE_E2E_AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/qualification",
      },
    }).verdict,
    "passed",
  );
});

test("self-host optional cell inputs fail early only for an explicit selected cell", () => {
  const options = { ...BASE, world: "self-host", runId: "qs-qual", scenarios: "SELFHOST-QUAL-1" };
  const env = {
    ...TEST_TLS_ENV,
    RELEASE_E2E_SELFHOST_REGION: "us-west-2",
    RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID: "Z123456789",
    RELEASE_E2E_SELFHOST_INSTANCE_TYPE: "t3.small",
    RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY: "byok-a",
    AWS_PROFILE: "qualification",
  };
  assert.equal(runQualificationPreflight(options, { env }).verdict, "passed", "all cells preserve independent red outcomes");
  const selected = { ...options, cells: "SH-GATEWAY" };
  assert.equal(runQualificationPreflight(selected, { env }).verdict, "failed");
  assert.equal(
    runQualificationPreflight(selected, {
      env: {
        ...env,
        RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY: "byok-b",
        RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG: "v1.2.3",
      },
    }).verdict,
    "passed",
  );
});

test("receipt writes atomically with mode-safe bounded content", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qualification-preflight-write-"));
  try {
    const output = path.join(dir, "evidence", "preflight.json");
    const receipt = runQualificationPreflight(BASE, { env: LOCAL_ENV });
    writePreflightReceipt(output, receipt);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), receipt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
