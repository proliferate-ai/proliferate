#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REQUIRED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.upcoming",
];

function flag(name) {
  return process.argv.includes(name);
}

function env(name) {
  return process.env[name] || "";
}

function truthy(name) {
  return /^(1|true|yes|on)$/i.test(env(name));
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function hostLooksPublic(rawUrl) {
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    return !(
      host.endsWith(".local")
      || host.endsWith(".internal")
      || host.endsWith(".amazonaws.com") && host.includes(".local")
    );
  } catch {
    return true;
  }
}

function imagePinned(image) {
  return image.includes("@sha256:");
}

function imageDigest(image) {
  const index = image.indexOf("@sha256:");
  return index === -1 ? "" : image.slice(index + 1);
}

function readJsonArtifact(ref) {
  let path = ref;
  if (ref.startsWith("file://")) {
    try {
      path = fileURLToPath(ref);
    } catch {
      fail(`BYOK proof artifact ref is not a valid file URL: ${ref}`);
      return null;
    }
  }
  if (!existsSync(path)) {
    fail(
      "BYOK proof artifact must be a readable local JSON file for readiness checks. "
        + `Got: ${ref}`,
    );
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("BYOK proof artifact JSON must be an object.");
      return null;
    }
    return parsed;
  } catch (error) {
    fail(`BYOK proof artifact could not be parsed as JSON: ${error.message}`);
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function proofFlagEnabled(flags, name) {
  if (!flags) return false;
  if (Array.isArray(flags)) {
    return flags.includes(`${name}=true`) || flags.includes(name);
  }
  if (typeof flags === "string") {
    return flags.split(/[,\n]/).map((item) => item.trim()).includes(`${name}=true`);
  }
  if (typeof flags === "object") {
    return /^(1|true|yes|on)$/i.test(String(flags[name] || ""));
  }
  return false;
}

function proofResultPassed(results, name) {
  const result = results && typeof results === "object" ? results[name] : undefined;
  if (result === true) return true;
  if (typeof result === "string") return /^(pass|passed|ok)$/i.test(result);
  if (result && typeof result === "object") {
    return result.passed === true || /^(pass|passed|ok)$/i.test(String(result.status || ""));
  }
  return false;
}

function scriptSha256(relativePath) {
  try {
    return createHash("sha256").update(readFileSync(relativePath)).digest("hex");
  } catch {
    return "";
  }
}

function validateByokProofArtifact() {
  const ref = env("AGENT_GATEWAY_LITELLM_ISOLATION_PROOF_REF");
  if (!ref) {
    fail("BYOK is enabled but AGENT_GATEWAY_LITELLM_ISOLATION_PROOF_REF is missing.");
    return;
  }
  const artifact = readJsonArtifact(ref);
  if (!artifact) return;

  for (const field of [
    "environment",
    "generatedAt",
    "expiresAt",
    "litellmImageDigest",
    "litellmVersion",
    "topology",
    "litellmConfigFingerprint",
    "credentialRoutingConfigFlags",
    "proofScriptSha",
    "testMatrixResults",
    "signer",
    "approver",
  ]) {
    if (artifact[field] === undefined || artifact[field] === null || artifact[field] === "") {
      fail(`BYOK proof artifact is missing required field ${field}.`);
    }
  }
  if (!artifact.taskDefinitionArn && !artifact.serviceIdentity) {
    fail("BYOK proof artifact must include taskDefinitionArn or serviceIdentity.");
  }

  const expiresAt = Date.parse(String(artifact.expiresAt || ""));
  if (!Number.isFinite(expiresAt)) {
    fail("BYOK proof artifact expiresAt is not a valid timestamp.");
  } else if (expiresAt <= Date.now()) {
    fail("BYOK proof artifact is expired.");
  }

  if (env("PROLIFERATE_ENVIRONMENT") && artifact.environment !== env("PROLIFERATE_ENVIRONMENT")) {
    fail(
      "BYOK proof artifact environment does not match PROLIFERATE_ENVIRONMENT "
        + `(${artifact.environment} != ${env("PROLIFERATE_ENVIRONMENT")}).`,
    );
  }

  const configuredImage = env("LITELLM_IMAGE");
  const configuredDigest = configuredImage ? imageDigest(configuredImage) : "";
  if (configuredDigest && artifact.litellmImageDigest !== configuredDigest) {
    fail("BYOK proof artifact LiteLLM image digest does not match LITELLM_IMAGE.");
  }

  const topology = env("AGENT_GATEWAY_LITELLM_TOPOLOGY") || "oss_shared";
  if (artifact.topology !== topology) {
    fail("BYOK proof artifact topology does not match AGENT_GATEWAY_LITELLM_TOPOLOGY.");
  }
  if (
    env("AGENT_GATEWAY_LITELLM_CONFIG_FINGERPRINT")
    && artifact.litellmConfigFingerprint !== env("AGENT_GATEWAY_LITELLM_CONFIG_FINGERPRINT")
  ) {
    fail("BYOK proof artifact config fingerprint does not match deployment env.");
  }
  if (
    topology === "enterprise_shared"
    && !proofFlagEnabled(
      artifact.credentialRoutingConfigFlags,
      "LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES",
    )
  ) {
    fail(
      "enterprise_shared BYOK proof artifact does not prove "
        + "LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true.",
    );
  }

  const currentProofScriptSha = scriptSha256("scripts/agent-gateway-live-proof.py");
  if (currentProofScriptSha && artifact.proofScriptSha !== currentProofScriptSha) {
    fail("BYOK proof artifact was generated with a different live proof script.");
  }

  if (!nonEmptyString(artifact.signer)) {
    fail("BYOK proof artifact is unsigned.");
  }
  if (!nonEmptyString(artifact.approver)) {
    fail("BYOK proof artifact is unapproved.");
  }

  const requiredProofs = ["managedCredits", "routeIsolation"];
  if (truthy("AGENT_GATEWAY_ANTHROPIC_BYOK_ENABLED")) requiredProofs.push("byokAnthropic");
  if (truthy("AGENT_GATEWAY_OPENAI_BYOK_ENABLED")) requiredProofs.push("byokOpenai");
  if (truthy("AGENT_GATEWAY_BEDROCK_BYOK_ENABLED")) requiredProofs.push("byokBedrock");
  if (truthy("AGENT_GATEWAY_OPENAI_COMPATIBLE_BYOK_ENABLED")) {
    requiredProofs.push("byokOpenaiCompatible");
  }
  for (const proofName of requiredProofs) {
    if (!proofResultPassed(artifact.testMatrixResults, proofName)) {
      fail(`BYOK proof artifact is missing passing testMatrixResults.${proofName}.`);
    }
  }
}

function checkEnvSurface() {
  if (truthy("AGENT_GATEWAY_ENABLED") && !env("AGENT_GATEWAY_PUBLIC_BASE_URL")) {
    fail("AGENT_GATEWAY_ENABLED is true but AGENT_GATEWAY_PUBLIC_BASE_URL is missing.");
  }
  if (truthy("PRO_BILLING_ENABLED")) {
    for (const name of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRO_MONTHLY_PRICE_ID",
      "STRIPE_MANAGED_CLOUD_OVERAGE_PRICE_ID",
      "STRIPE_MANAGED_CLOUD_OVERAGE_METER_ID",
    ]) {
      if (!env(name)) fail(`PRO_BILLING_ENABLED is true but ${name} is missing.`);
    }
  }
  if (truthy("AGENT_GATEWAY_USER_FREE_CREDIT_ENABLED")) {
    const amount = Number(env("AGENT_GATEWAY_USER_FREE_CREDIT_USD") || "0");
    if (!(amount > 0)) fail("User free LLM credits are enabled but budget is zero.");
  }
  if (truthy("AGENT_GATEWAY_BYOK_ENABLED")) {
    const topology = env("AGENT_GATEWAY_LITELLM_TOPOLOGY") || "oss_shared";
    if (topology === "oss_shared") fail("BYOK is enabled with oss_shared topology.");
    if (topology === "isolated_router") {
      fail("isolated_router BYOK is not runtime-supported by this release; use enterprise_shared or keep BYOK disabled.");
    }
    if (!truthy("AGENT_GATEWAY_PROVIDER_LIVE_VALIDATION_ENABLED")) {
      fail("BYOK is enabled but AGENT_GATEWAY_PROVIDER_LIVE_VALIDATION_ENABLED is not true.");
    }
    if (!truthy("AGENT_GATEWAY_LITELLM_CUSTOMER_SECRET_ISOLATION_VERIFIED")) {
      fail("BYOK is enabled but route isolation is not verified.");
    }
    validateByokProofArtifact();
    if (hostLooksPublic(env("AGENT_GATEWAY_LITELLM_BASE_URL"))) {
      fail("BYOK is enabled but AGENT_GATEWAY_LITELLM_BASE_URL appears public.");
    }
    const image = env("LITELLM_IMAGE");
    if (image && !imagePinned(image)) fail("BYOK is enabled but LITELLM_IMAGE is not digest-pinned.");
    if (topology === "enterprise_shared" && !truthy("LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES")) {
      fail("enterprise_shared BYOK requires LITELLM_ENABLE_MODEL_CONFIG_CREDENTIAL_OVERRIDES=true.");
    }
  } else if (env("LITELLM_IMAGE") && !imagePinned(env("LITELLM_IMAGE"))) {
    warn("LITELLM_IMAGE is not digest-pinned; keep BYOK disabled until it is pinned.");
  }
}

function checkStripeWebhookEvents() {
  const configured = (env("STRIPE_WEBHOOK_EVENTS") || env("STRIPE_SNAPSHOT_EVENTS"))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    warn("STRIPE_WEBHOOK_EVENTS/STRIPE_SNAPSHOT_EVENTS is not set; skipping local event-set check.");
    return;
  }
  for (const eventName of REQUIRED_STRIPE_EVENTS) {
    if (!configured.includes(eventName)) {
      fail(`Stripe webhook event set is missing ${eventName}.`);
    }
  }
}

function checkAwsInventory() {
  if (!flag("--aws")) return;
  try {
    execFileSync("aws", ["sts", "get-caller-identity"], { stdio: "ignore" });
  } catch {
    fail("AWS CLI identity check failed. Run aws sts get-caller-identity first.");
  }
  const cluster = env("PROLIFERATE_ECS_CLUSTER");
  const litellmService = env("PROLIFERATE_LITELLM_ECS_SERVICE");
  if (!cluster || !litellmService) {
    warn(
      "--aws was provided but PROLIFERATE_ECS_CLUSTER/PROLIFERATE_LITELLM_ECS_SERVICE "
        + "are not both set; skipping ECS LiteLLM task-definition inspection.",
    );
    return;
  }
  let service;
  try {
    service = JSON.parse(
      execFileSync(
        "aws",
        [
          "ecs",
          "describe-services",
          "--cluster",
          cluster,
          "--services",
          litellmService,
          "--output",
          "json",
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (error) {
    fail(`Could not describe LiteLLM ECS service: ${error.message}`);
    return;
  }
  const taskDefinition = service.services?.[0]?.taskDefinition;
  if (!taskDefinition) {
    fail("LiteLLM ECS service does not report a task definition.");
    return;
  }
  let task;
  try {
    task = JSON.parse(
      execFileSync(
        "aws",
        [
          "ecs",
          "describe-task-definition",
          "--task-definition",
          taskDefinition,
          "--output",
          "json",
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (error) {
    fail(`Could not describe LiteLLM ECS task definition: ${error.message}`);
    return;
  }
  const containers = task.taskDefinition?.containerDefinitions || [];
  const litellmContainer = containers.find((container) => /litellm/i.test(container.name || ""))
    || containers[0];
  if (!litellmContainer) {
    fail("LiteLLM ECS task definition has no containers.");
    return;
  }
  if (!imagePinned(litellmContainer.image || "")) {
    fail("LiteLLM ECS task image is not digest-pinned.");
  }
  const secretNames = new Set((litellmContainer.secrets || []).map((item) => item.name));
  for (const requiredSecret of ["LITELLM_MASTER_KEY", "LITELLM_POSTGRES_PASSWORD"]) {
    if (!secretNames.has(requiredSecret)) {
      fail(`LiteLLM ECS task definition is missing secret ${requiredSecret}.`);
    }
  }
}

const failures = [];
const warnings = [];

checkEnvSurface();
checkStripeWebhookEvents();
checkAwsInventory();

for (const message of warnings) {
  console.warn(`WARN ${message}`);
}
for (const message of failures) {
  console.error(`FAIL ${message}`);
}
if (failures.length > 0) {
  process.exit(1);
}
console.log("PASS billing/gateway readiness checks completed without blocking failures.");
