#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadCandidateBuildMapForReuse } from "./assemble-candidate-build-map.mjs";

export const PREFLIGHT_KIND = "proliferate.qualification-preflight";
export const PREFLIGHT_SCHEMA_VERSION = 1;
export const PREFLIGHT_DEADLINE_MS = 120_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA = /^[0-9a-f]{40}$/;
const WORLDS = new Set(["local", "managed-cloud", "self-host", "tier4"]);
const SECRET_NAMES = new Set([
  "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY",
  "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY",
  "RELEASE_E2E_BYOK_OPENAI_API_KEY",
  "RELEASE_E2E_BYOK_XAI_API_KEY",
  "RELEASE_E2E_INTEGRATION_API_KEY",
  "RELEASE_E2E_E2B_API_KEY",
  "RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY",
  "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET",
  "RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET",
  "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE",
  "RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE",
  "RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY",
  "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET",
  "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

const WORLD_REQUIREMENTS = {
  local: [
    ["AGENT_GATEWAY_LITELLM_BASE_URL", "https_url"],
    ["AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL", "https_url"],
    ["AGENT_GATEWAY_LITELLM_MASTER_KEY", "present"],
  ],
  "managed-cloud": [
    ["AGENT_GATEWAY_LITELLM_BASE_URL", "https_url"],
    ["AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL", "https_url"],
    ["AGENT_GATEWAY_LITELLM_MASTER_KEY", "present"],
    ["RELEASE_E2E_E2B_API_KEY", "present"],
    ["RELEASE_E2E_E2B_TEAM_ID", "safe_reference"],
    ["RELEASE_E2E_CLOUD_AWS_REGION", "aws_region"],
    ["RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID", "route53_zone"],
    ["RELEASE_E2E_CLOUD_GITHUB_APP_ID", "positive_integer"],
    ["RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID", "safe_reference"],
    ["RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID", "positive_integer"],
    ["RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY", "present"],
    ["RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET", "present"],
  ],
  "self-host": [
    ["RELEASE_E2E_SELFHOST_REGION", "aws_region"],
    ["RELEASE_E2E_SELFHOST_HOSTED_ZONE_ID", "route53_zone"],
  ],
  tier4: [],
};

const SELFHOST_SCENARIO_REQUIREMENTS = {
  "SELFHOST-INSTALL-1": [
    ["RELEASE_E2E_SELFHOST_INSTANCE_TYPE", "safe_reference"],
    ["RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY", "present"],
  ],
  "SELFHOST-QUAL-1": [
    ["RELEASE_E2E_SELFHOST_INSTANCE_TYPE", "safe_reference"],
    ["RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY", "present"],
  ],
  "SELFHOST-ISOLATION-1": [
    ["RELEASE_E2E_SELFHOST_INSTANCE_TYPE", "safe_reference"],
    ["RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY", "present"],
  ],
  "SELFHOST-CFN-1": [],
};

const SELFHOST_SCENARIO_CELLS = {
  "SELFHOST-INSTALL-1": ["SH-INSTALL-CLAIM", "SH-DESKTOP-OWNER", "SH-BASE-TURN", "SH-INVITEE"],
  "SELFHOST-QUAL-1": ["SH-GITHUB-AUTH", "SH-GATEWAY", "SH-CLOUD-ADDON"],
  "SELFHOST-ISOLATION-1": ["SH-SWITCH-ISOLATION"],
  "SELFHOST-CFN-1": ["SH-CFN-WRAPPER"],
};

// These are deterministic blockers only when the operator explicitly selects
// one SELFHOST-QUAL-1 cell. With the default all-cell selector, the scenario's
// existing per-cell red outcomes remain independent.
const SELFHOST_EXPLICIT_CELL_REQUIREMENTS = {
  "SH-GITHUB-AUTH": [
    ["RELEASE_E2E_SELFHOST_GITHUB_OAUTH_CLIENT_ID", "safe_reference"],
    ["RELEASE_E2E_SELFHOST_GITHUB_OAUTH_SECRET", "present"],
    ["RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_STATE", "present"],
    ["RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_STATE", "present"],
    ["RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_A_EMAIL", "email"],
    ["RELEASE_E2E_SELFHOST_GITHUB_IDENTITY_B_EMAIL", "email"],
  ],
  "SH-GATEWAY": [
    ["RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY", "present"],
    ["RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG", "safe_reference"],
  ],
  "SH-CLOUD-ADDON": [
    ["RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY", "present"],
    ["RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME", "safe_reference"],
    ["RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID", "positive_integer"],
    ["RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID", "safe_reference"],
    ["RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET", "present"],
    ["RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY", "present"],
  ],
  "SH-CFN-WRAPPER": [
    ["RELEASE_E2E_SELFHOST_CFN_BUCKET", "s3_bucket"],
    ["RELEASE_E2E_SELFHOST_CFN_IMAGE_REPO", "ghcr_repo"],
  ],
};

const LOCAL_SCENARIO_REQUIREMENTS = {
  "T3-AUTHROUTE-1": [
    ["RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY", "present"],
    ["RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY", "present"],
    ["RELEASE_E2E_BYOK_OPENAI_API_KEY", "present"],
    ["RELEASE_E2E_BYOK_XAI_API_KEY", "present"],
  ],
  "T3-INT-1": [
    ["RELEASE_E2E_INTEGRATION_NAMESPACE", "safe_reference"],
    ["RELEASE_E2E_INTEGRATION_API_KEY", "present"],
  ],
};

export function runQualificationPreflight(options, deps = {}) {
  const started = Date.now();
  const env = deps.env ?? process.env;
  const checks = [];
  const fail = (id, message) => checks.push({ id, status: "failed", message });
  const pass = (id, message) => checks.push({ id, status: "passed", message });

  if (!WORLDS.has(options.world)) {
    fail("world", "Selected world is unsupported.");
  } else {
    pass("world", `Selected world ${options.world} is supported.`);
  }
  validateIdentity(options, pass, fail);

  const scenarioIds = parseSelector(options.scenarios ?? "all", "scenario_selection", fail);
  const cellIds = parseSelector(options.cells ?? "all", "cell_selection", fail);
  const requirements = WORLD_REQUIREMENTS[options.world] ?? [];
  for (const [name, shape] of requirements) {
    validateEnv(name, shape, env, pass, fail);
  }
  if (options.world === "local") {
    const selected = scenarioIds === "all" ? Object.keys(LOCAL_SCENARIO_REQUIREMENTS) : scenarioIds;
    for (const scenario of selected) {
      for (const [name, shape] of LOCAL_SCENARIO_REQUIREMENTS[scenario] ?? []) {
        validateEnv(name, shape, env, pass, fail);
      }
    }
  }
  if (options.world === "self-host") {
    const selected = scenarioIds === "all" ? Object.keys(SELFHOST_SCENARIO_REQUIREMENTS) : scenarioIds;
    for (const scenario of selected) {
      if (!(scenario in SELFHOST_SCENARIO_REQUIREMENTS)) {
        fail("scenario_selection", `Scenario ${scenario} is not a supported self-host scenario.`);
      }
    }
    for (const scenario of selected) {
      for (const [name, shape] of SELFHOST_SCENARIO_REQUIREMENTS[scenario] ?? []) {
        validateEnv(name, shape, env, pass, fail);
      }
    }
    if (cellIds !== "all") {
      const allowedCells = new Set(selected.flatMap((scenario) => SELFHOST_SCENARIO_CELLS[scenario] ?? []));
      for (const cell of cellIds) {
        if (!allowedCells.has(cell)) {
          fail("cell_selection", `Cell ${cell} is not owned by the selected self-host scenarios.`);
          continue;
        }
        for (const [name, shape] of SELFHOST_EXPLICIT_CELL_REQUIREMENTS[cell] ?? []) {
          validateEnv(name, shape, env, pass, fail);
        }
      }
    } else if (selected.includes("SELFHOST-CFN-1")) {
      for (const [name, shape] of SELFHOST_EXPLICIT_CELL_REQUIREMENTS["SH-CFN-WRAPPER"]) {
        validateEnv(name, shape, env, pass, fail);
      }
    }
  }
  if (options.world === "managed-cloud" || options.world === "self-host") {
    validateAwsAuthorization(env, pass, fail);
  }

  let candidateBuild = null;
  if (options.artifactMode === "reuse") {
    try {
      const map = loadCandidateBuildMapForReuse({
        mapPath: options.candidateBuildMap,
        expectedSourceSha: options.sourceSha,
      });
      candidateBuild = safeCandidateEvidence(map);
      pass("artifact_cache", "Exact candidate map and every local artifact digest were verified.");
    } catch {
      fail("artifact_cache", "Exact candidate cache lookup failed closed.");
    }
  } else if (options.artifactMode === "build") {
    if (options.candidateBuildMap) {
      fail("artifact_cache", "Build mode cannot also claim a candidate cache hit.");
    } else {
      pass("artifact_cache", "No cache hit is claimed; one candidate build is required.");
    }
  } else if (options.artifactMode === "external") {
    if (options.world !== "tier4") {
      fail("artifact_cache", "External artifact mode is restricted to read-only Tier 4 validation.");
    } else if (!Array.isArray(scenarioIds) || scenarioIds.length !== 1 || scenarioIds[0] !== "T4-SH-2") {
      fail("artifact_cache", "External artifact mode currently requires the read-only T4-SH-2 scenario.");
    } else if (options.candidateBuildMap) {
      fail("artifact_cache", "External artifact mode cannot also claim a local candidate map.");
    } else {
      pass(
        "artifact_cache",
        "No local candidate build or reuse is claimed; the selected Tier 4 scenario validates published artifacts.",
      );
    }
  } else {
    fail("artifact_cache", "Artifact mode must be build, reuse, or external.");
  }

  const cleanupAuthorizationRevision = validateCleanupAuthorization(
    options,
    pass,
    fail,
    deps.resolveTrustedDefaultTip ?? resolveTrustedDefaultTip,
  );
  if (Date.now() - started >= PREFLIGHT_DEADLINE_MS) {
    fail("deadline", "Preflight exceeded its two-minute bounded deadline.");
  } else {
    pass("deadline", "Preflight completed within its two-minute bounded deadline.");
  }

  const verdict = checks.some((check) => check.status === "failed") ? "failed" : "passed";
  return {
    schema_version: PREFLIGHT_SCHEMA_VERSION,
    kind: PREFLIGHT_KIND,
    run: {
      run_id: safeReceiptString(options.runId),
      shard_id: safeReceiptString(options.shardId),
      attempt: Number.isInteger(options.attempt) ? options.attempt : null,
      source_sha: SHA.test(options.sourceSha ?? "") ? options.sourceSha : null,
    },
    world: WORLDS.has(options.world) ? options.world : null,
    selected_scenarios: scenarioIds,
    selected_cells: cellIds,
    artifact_mode: options.artifactMode ?? null,
    candidate_build: candidateBuild,
    cleanup_authorization_revision: cleanupAuthorizationRevision,
    checks,
    verdict,
    duration_ms: Date.now() - started,
  };
}

function validateIdentity(options, pass, fail) {
  if (!SAFE_ID.test(options.runId ?? "")) fail("run_identity", "Run id is malformed.");
  else if (!SAFE_ID.test(options.shardId ?? "")) fail("run_identity", "Shard id is malformed.");
  else if (!Number.isInteger(options.attempt) || options.attempt < 1) fail("run_identity", "Attempt must be positive.");
  else if (!SHA.test(options.sourceSha ?? "")) fail("run_identity", "Source SHA is malformed.");
  else pass("run_identity", "Run, shard, attempt, and exact source SHA are valid.");
}

function parseSelector(raw, checkId, fail) {
  if (raw === "all") return "all";
  const ids = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !SAFE_ID.test(id)) || new Set(ids).size !== ids.length) {
    const label = checkId === "cell_selection" ? "Cell" : "Scenario";
    fail(checkId, `${label} selector is empty, duplicated, or malformed.`);
    return [];
  }
  return ids.sort();
}

function validateEnv(name, shape, env, pass, fail) {
  const value = env[name]?.trim();
  const id = `env:${name}`;
  if (!value) {
    fail(id, `${name} is missing.`);
    return;
  }
  let valid = true;
  if (shape === "https_url") {
    try {
      const url = new URL(value);
      valid = url.protocol === "https:" && !url.username && !url.password && url.hostname.length > 0;
    } catch {
      valid = false;
    }
  } else if (shape === "safe_reference") valid = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(value);
  else if (shape === "aws_region") valid = /^[a-z]{2}-[a-z]+-\d$/.test(value);
  else if (shape === "route53_zone") valid = /^Z[A-Z0-9]{1,63}$/.test(value);
  else if (shape === "positive_integer") valid = /^[1-9][0-9]*$/.test(value);
  else if (shape === "email") valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  else if (shape === "s3_bucket") valid = /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value);
  else if (shape === "ghcr_repo") valid = /^ghcr\.io\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value);
  if (!valid) {
    fail(id, `${name} has an invalid ${shape} shape.`);
    return;
  }
  pass(id, `${name} is present${SECRET_NAMES.has(name) ? " and redacted" : " with valid shape"}.`);
}

function validateAwsAuthorization(env, pass, fail) {
  const hasAccessKey = Boolean(env.AWS_ACCESS_KEY_ID?.trim());
  const hasSecretKey = Boolean(env.AWS_SECRET_ACCESS_KEY?.trim());
  const hasProfile = Boolean(env.AWS_PROFILE?.trim());
  const hasWebIdentity = Boolean(env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim());
  const hasRole = Boolean(env.AWS_ROLE_ARN?.trim());
  const hasPlannedActionsOidc =
    env.GITHUB_ACTIONS === "true" &&
    Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim()) &&
    Boolean(env.RELEASE_E2E_AWS_ROLE_ARN?.trim());
  let posture = null;
  if (hasAccessKey && hasSecretKey) posture = "access-key-pair";
  else if (hasProfile) posture = "profile";
  else if (hasWebIdentity && hasRole) posture = "web-identity-role";
  else if (hasPlannedActionsOidc) posture = "planned-actions-oidc-role";
  if (!posture) {
    fail("aws_authorization", "No complete supported AWS authorization posture is present.");
    return;
  }
  pass("aws_authorization", `AWS authorization posture ${posture} is present; values are not recorded.`);
}

function validateCleanupAuthorization(options, pass, fail, resolveDefaultTip) {
  if (options.world !== "managed-cloud") {
    pass("cleanup_authorization", "The selected world uses the runner-owned identity-bound cleanup ledger and finalizer.");
    return null;
  }
  try {
    const repository = path.resolve(options.cleanupAttestationRepository);
    const attestationPath = path.resolve(options.cleanupAttestations);
    const relativePath = path.relative(repository, attestationPath).split(path.sep).join("/");
    if (!relativePath || relativePath.startsWith("../") || !/^[A-Za-z0-9._/-]+$/.test(relativePath)) {
      throw new Error("attestation path is outside the trusted repository");
    }
    const git = (args, maxBuffer = 64 * 1024) =>
      execFileSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const revision = git(["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!SHA.test(revision)) throw new Error("trusted revision is malformed");
    const remote = git(["remote", "get-url", "origin"]);
    if (!isCanonicalRepositoryRemote(remote)) throw new Error("trusted repository remote is not canonical");
    const defaultBranch = options.cleanupAttestationDefaultBranch;
    if (
      typeof defaultBranch !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(defaultBranch) ||
      defaultBranch.includes("..") ||
      defaultBranch.endsWith("/")
    ) {
      throw new Error("trusted default branch is malformed");
    }
    if (resolveDefaultTip(repository, defaultBranch) !== revision) {
      throw new Error("trusted checkout is not the remote default-branch tip");
    }
    const raw = JSON.parse(git(["show", `${revision}:${relativePath}`], 1024 * 1024));
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(["kind", "schema_version", "source_shas"]) ||
      raw.kind !== "managed_cloud_litellm_attribution_attestations" ||
      raw.schema_version !== 1 ||
      !Array.isArray(raw.source_shas) ||
      raw.source_shas.some((sha) => !SHA.test(sha)) ||
      new Set(raw.source_shas).size !== raw.source_shas.length ||
      !raw.source_shas.includes(options.sourceSha)
    ) {
      throw new Error("candidate source is not attested");
    }
    pass("cleanup_authorization", "Trusted default-branch cleanup authorization contains the exact source SHA.");
    return revision;
  } catch {
    fail("cleanup_authorization", "Trusted default-branch cleanup authorization is absent, unproven, or does not contain the exact source SHA.");
    return null;
  }
}

function resolveTrustedDefaultTip(repository, defaultBranch) {
  const ref = `refs/heads/${defaultBranch}`;
  const output = execFileSync("git", ["-C", repository, "ls-remote", "--heads", "origin", ref], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const match = /^([0-9a-f]{40})\trefs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.exec(output);
  if (!match || output.split("\n").length !== 1) throw new Error("remote default branch did not resolve exactly once");
  return match[1];
}

function isCanonicalRepositoryRemote(remote) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:)proliferate-ai\/proliferate(?:\.git)?$/.test(remote);
}

function safeCandidateEvidence(map) {
  const artifacts = map.artifacts
    .map(({ artifact_id, version, sha256 }) => ({ artifact_id, version, sha256 }))
    .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
  const contentIdentity = createHash("sha256")
    .update(JSON.stringify({ source_sha: map.source_sha, artifacts }))
    .digest("hex");
  return { content_identity: contentIdentity, artifacts };
}

function safeReceiptString(value) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function parseArgs(argv) {
  const options = {};
  const mappings = new Map([
    ["--world", "world"],
    ["--source-sha", "sourceSha"],
    ["--run-id", "runId"],
    ["--shard-id", "shardId"],
    ["--attempt", "attempt"],
    ["--scenarios", "scenarios"],
    ["--cells", "cells"],
    ["--artifact-mode", "artifactMode"],
    ["--candidate-build-map", "candidateBuildMap"],
    ["--cleanup-attestations", "cleanupAttestations"],
    ["--cleanup-attestation-repository", "cleanupAttestationRepository"],
    ["--cleanup-attestation-default-branch", "cleanupAttestationDefaultBranch"],
    ["--output", "output"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = mappings.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || options[key] !== undefined) throw new Error("Invalid or duplicate preflight argument.");
    options[key] = key === "attempt" ? Number(value) : value;
  }
  if (!options.output) throw new Error("--output is required.");
  return options;
}

export function writePreflightReceipt(outputPath, receipt) {
  const resolved = path.resolve(outputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, resolved);
}

function main() {
  let options;
  let receipt;
  try {
    options = parseArgs(process.argv.slice(2));
    receipt = runQualificationPreflight(options);
  } catch (error) {
    const outputIndex = process.argv.indexOf("--output");
    const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
    if (!output) throw error;
    receipt = {
      schema_version: PREFLIGHT_SCHEMA_VERSION,
      kind: PREFLIGHT_KIND,
      run: { run_id: null, shard_id: null, attempt: null, source_sha: null },
      world: null,
      selected_scenarios: [],
      selected_cells: [],
      artifact_mode: null,
      candidate_build: null,
      cleanup_authorization_revision: null,
      checks: [{ id: "invocation", status: "failed", message: "Preflight invocation is invalid." }],
      verdict: "failed",
      duration_ms: 0,
    };
    options = { output };
  }
  writePreflightReceipt(options.output, receipt);
  process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, evidence: path.resolve(options.output) })}\n`);
  if (receipt.verdict !== "passed") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    console.error("qualification preflight failed before a receipt path was available");
    process.exitCode = 2;
  }
}
