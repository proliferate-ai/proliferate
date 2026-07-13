import assert from "node:assert/strict";
import { test } from "node:test";

import { WorldReadinessError } from "../../contracts/world.js";
import type { ManagedCloudWorldConfig } from "./config.js";
import { ManagedCloudWorldProvisioner } from "./provisioner.js";
import type { E2BTemplateResolver } from "./template-identity.js";
import { fakeFetch, makeCandidateManifest, makeWorldContext } from "./test-support.js";

function baseConfig(overrides: Partial<ManagedCloudWorldConfig> = {}): ManagedCloudWorldConfig {
  return {
    apiUrl: "https://candidate.example/api",
    gatewayOrigin: "https://gw.example",
    gatewayKeyPresent: true,
    e2bApiKeyPresent: true,
    e2bTeamId: "team-1",
    preparedRepository: "proliferate-e2e/e2e-fixture",
    githubAppAuthorityAvailable: true,
    secrets: { byName: { RELEASE_E2E_GATEWAY_TEST_KEY: "sk-secret-value-123" } },
    templateResolver: null,
    ...overrides,
  };
}

const immutableManifest = () =>
  makeCandidateManifest({ available: true, value: { templateId: "sha-abc123def456", inputHash: "h1" } });

test("prepare returns a handle with immutable template + verified capabilities when all boundaries are ready", async () => {
  const { ctx } = makeWorldContext(immutableManifest());
  const provisioner = new ManagedCloudWorldProvisioner(baseConfig(), {
    fetchImpl: fakeFetch({ "/health": { status: 200 }, "/health/liveliness": { status: 200 } }),
  });
  const handle = await provisioner.prepare(ctx);
  assert.equal(handle.world, "managed-cloud");
  assert.equal(handle.template.templateId, "sha-abc123def456");
  assert.ok(handle.verifiedCapabilities.includes("candidate-api"));
  assert.ok(handle.verifiedCapabilities.includes("e2b-template"));
  assert.ok(handle.verifiedCapabilities.includes("github-app"));
  assert.ok(handle.verifiedCapabilities.includes("e2b"));
  assert.ok(handle.verifiedCapabilities.includes("litellm"));
});

test("prepare throws WorldReadinessError when the candidate API is unreachable", async () => {
  const { ctx } = makeWorldContext(immutableManifest());
  const provisioner = new ManagedCloudWorldProvisioner(baseConfig(), {
    fetchImpl: fakeFetch({ "/health": new Error("ECONNREFUSED"), "/health/liveliness": { status: 200 } }),
  });
  await assert.rejects(provisioner.prepare(ctx), (err: Error) => {
    assert.ok(err instanceof WorldReadinessError);
    assert.ok(err.message.includes("candidate-api-reachability"));
    return true;
  });
});

test("prepare throws when only a rolling template is available and no resolver can pin it", async () => {
  const rollingManifest = makeCandidateManifest({ available: true, value: { templateId: "v1", inputHash: "h" } });
  const { ctx } = makeWorldContext(rollingManifest);
  const provisioner = new ManagedCloudWorldProvisioner(baseConfig({ templateResolver: null }), {
    fetchImpl: fakeFetch({ "/health": { status: 200 } }),
    observedRollingRef: "base",
  });
  await assert.rejects(provisioner.prepare(ctx), (err: Error) => {
    assert.ok(err instanceof WorldReadinessError);
    assert.ok(err.message.includes("candidate-e2b-template-identity"));
    return true;
  });
});

test("prepare resolves+pins a rolling template via the E2B resolver when available", async () => {
  const rollingManifest = makeCandidateManifest({ available: false, reason: "not built for local run" });
  const { ctx } = makeWorldContext(rollingManifest);
  const resolver: E2BTemplateResolver = {
    resolveImmutableBuild: async (alias) => ({ buildId: "sha-777888999000", how: `e2b.templates.get(${alias})` }),
  };
  const provisioner = new ManagedCloudWorldProvisioner(baseConfig({ templateResolver: resolver }), {
    fetchImpl: fakeFetch({ "/health": { status: 200 }, "/health/liveliness": { status: 200 } }),
    observedRollingRef: "base",
  });
  const handle = await provisioner.prepare(ctx);
  assert.equal(handle.template.templateId, "sha-777888999000");
});

test("conditional capabilities are recorded but do not block readiness", async () => {
  const { ctx } = makeWorldContext(immutableManifest());
  // No E2B, no gateway origin, no gateway key.
  const provisioner = new ManagedCloudWorldProvisioner(
    baseConfig({ e2bApiKeyPresent: false, e2bTeamId: null, gatewayOrigin: null, gatewayKeyPresent: false }),
    { fetchImpl: fakeFetch({ "/health": { status: 200 } }) },
  );
  const handle = await provisioner.prepare(ctx);
  assert.ok(!handle.verifiedCapabilities.includes("e2b"));
  assert.ok(!handle.verifiedCapabilities.includes("litellm"));
  // Still ready because required boundaries passed.
  assert.ok(handle.verifiedCapabilities.includes("candidate-api"));
});

test("evidence appended for readiness never contains a raw secret value", async () => {
  const { ctx, events } = makeWorldContext(immutableManifest());
  const provisioner = new ManagedCloudWorldProvisioner(
    baseConfig({ secrets: { byName: { RELEASE_E2E_GATEWAY_TEST_KEY: "sk-super-secret-xyz" } } }),
    { fetchImpl: fakeFetch({ "/health": { status: 200 }, "/health/liveliness": { status: 200 } }) },
  );
  await provisioner.prepare(ctx);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes("sk-super-secret-xyz"));
  assert.ok(events.length > 0);
});
