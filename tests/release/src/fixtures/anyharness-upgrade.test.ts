import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anyharnessBinaryConverged,
  assertNotProduction,
  registerableTaskDefinition,
  runtimeHealthVersion,
  runtimeVersionPinOf,
  withRuntimeVersionPin,
  type EcsTaskDefinition,
} from "./anyharness-upgrade.js";

function taskDef(overrides: Partial<EcsTaskDefinition> = {}): EcsTaskDefinition {
  return {
    family: "proliferate-staging-server",
    taskDefinitionArn: "arn:aws:ecs:us-east-1:1:task-definition/proliferate-staging-server:155",
    revision: 155,
    status: "ACTIVE",
    requiresAttributes: [{ name: "ecs.capability.execution-role-awslogs" }],
    compatibilities: ["EC2", "FARGATE"],
    registeredAt: "2026-07-09T00:00:00Z",
    registeredBy: "arn:aws:iam::1:user/ci",
    containerDefinitions: [
      { name: "server", environment: [{ name: "SERVER_VERSION", value: "0.1.0" }] },
      { name: "sidecar", environment: [] },
    ],
    ...overrides,
  };
}

test("runtimeHealthVersion trims and defaults to empty string", () => {
  assert.equal(runtimeHealthVersion({ version: " 0.3.12 " }), "0.3.12");
  assert.equal(runtimeHealthVersion({}), "");
  assert.equal(runtimeHealthVersion({ status: "ok" }), "");
});

test("anyharnessBinaryConverged: exact match converges, empty pin never converges", () => {
  assert.equal(anyharnessBinaryConverged("0.3.12", "0.3.12"), true);
  assert.equal(anyharnessBinaryConverged(" 0.3.12 ", "0.3.12"), true);
  // The exact shape of the shipped bug: /health reports CARGO_PKG_VERSION 0.1.0
  // while the server advertises the real pin — must NOT be read as converged.
  assert.equal(anyharnessBinaryConverged("0.1.0", "0.3.12"), false);
  assert.equal(anyharnessBinaryConverged("0.3.12", ""), false);
  assert.equal(anyharnessBinaryConverged("", "0.3.12"), false);
});

test("withRuntimeVersionPin overrides only the named container and only RUNTIME_VERSION", () => {
  const bumped = withRuntimeVersionPin(taskDef(), "server", "0.3.12");
  const server = bumped.containerDefinitions.find((c) => c.name === "server");
  assert.deepEqual(server?.environment, [
    { name: "SERVER_VERSION", value: "0.1.0" },
    { name: "RUNTIME_VERSION", value: "0.3.12" },
  ]);
  // Other containers untouched.
  const sidecar = bumped.containerDefinitions.find((c) => c.name === "sidecar");
  assert.deepEqual(sidecar?.environment, []);
});

test("withRuntimeVersionPin replaces an existing RUNTIME_VERSION rather than duplicating it", () => {
  const withPin = taskDef({
    containerDefinitions: [
      { name: "server", environment: [{ name: "RUNTIME_VERSION", value: "0.3.11" }] },
    ],
  });
  const bumped = withRuntimeVersionPin(withPin, "server", "0.3.12");
  const env = bumped.containerDefinitions[0].environment ?? [];
  assert.equal(env.filter((e) => e.name === "RUNTIME_VERSION").length, 1);
  assert.equal(env.find((e) => e.name === "RUNTIME_VERSION")?.value, "0.3.12");
});

test("withRuntimeVersionPin does not mutate its input", () => {
  const input = taskDef();
  const before = JSON.stringify(input);
  withRuntimeVersionPin(input, "server", "0.3.12");
  assert.equal(JSON.stringify(input), before);
});

test("runtimeVersionPinOf reads the pin, undefined when unset", () => {
  assert.equal(runtimeVersionPinOf(taskDef(), "server"), undefined);
  const withPin = withRuntimeVersionPin(taskDef(), "server", "0.3.12");
  assert.equal(runtimeVersionPinOf(withPin, "server"), "0.3.12");
});

test("registerableTaskDefinition strips every read-only field", () => {
  const input = registerableTaskDefinition(taskDef());
  for (const readOnly of [
    "taskDefinitionArn",
    "revision",
    "status",
    "requiresAttributes",
    "compatibilities",
    "registeredAt",
    "registeredBy",
  ]) {
    assert.equal(readOnly in input, false, `${readOnly} must be stripped`);
  }
  assert.equal(input.family, "proliferate-staging-server");
  assert.ok(Array.isArray(input.containerDefinitions));
});

test("assertNotProduction blocks prod-looking targets, allows staging", () => {
  assert.throws(() =>
    assertNotProduction({ cluster: "proliferate-production", service: "x", container: "server", region: "us-east-1" }),
  );
  assert.throws(() =>
    assertNotProduction({ cluster: "proliferate-prod", service: "x", container: "server", region: "us-east-1" }),
  );
  assert.doesNotThrow(() =>
    assertNotProduction({
      cluster: "proliferate-staging",
      service: "proliferate-staging-server",
      container: "server",
      region: "us-east-1",
    }),
  );
});
