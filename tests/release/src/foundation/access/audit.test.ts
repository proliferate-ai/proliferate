import assert from "node:assert/strict";
import { test } from "node:test";

import { loadLocalEnvironment } from "./env-file.js";
import { runAccessAudit, type CommandResult, type RunCommand } from "./audit.js";

const FAKE_E2B_KEY = "e2b_totally_fake_do_not_use_1234567890";
const FAKE_STRIPE_LIVE_KEY = "sk_live_totally_fake_do_not_use_1234567890";
const FAKE_STRIPE_TEST_KEY = "sk_test_totally_fake_do_not_use_1234567890";

function envWith(ambient: NodeJS.ProcessEnv) {
  return loadLocalEnvironment({ releaseEnvPath: "/nonexistent/release-e2e.env", ambient });
}

function commandsAllOk(): RunCommand {
  return () => ({ ok: true, spawnError: false });
}

function commandsAllFail(): RunCommand {
  return () => ({ ok: false, spawnError: false });
}

function commandsNotInstalled(): RunCommand {
  return () => ({ ok: false, spawnError: true });
}

test("a fully-credentialed environment reports ok with no missing names", () => {
  const report = runAccessAudit({
    env: envWith({
      RELEASE_E2E_E2B_API_KEY: FAKE_E2B_KEY,
      STRIPE_SECRET_KEY: FAKE_STRIPE_TEST_KEY,
      RELEASE_E2E_GATEWAY_BASE_URL: "https://gateway.example.test",
    }),
    runCommand: commandsAllOk(),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.missingNames, []);
});

test("missing gh/aws CLI auth is reported by name, not a value", () => {
  const report = runAccessAudit({ env: envWith({}), runCommand: commandsAllFail() });
  assert.ok(report.missingNames.includes("github"));
  assert.ok(report.missingNames.includes("aws"));
  const github = report.results.find((r) => r.name === "github")!;
  assert.equal(github.status, "missing");
});

test("an uninstalled CLI reports status \"error\", distinct from \"not authenticated\"", () => {
  const report = runAccessAudit({ env: envWith({}), runCommand: commandsNotInstalled() });
  const github = report.results.find((r) => r.name === "github")!;
  assert.equal(github.status, "error");
  assert.match(github.detail, /not installed/);
});

test("a missing E2B key is reported missing; a malformed one (wrong prefix) is reported malformed", () => {
  const missing = runAccessAudit({ env: envWith({}), runCommand: commandsAllOk() });
  assert.equal(missing.results.find((r) => r.name === "e2b")!.status, "missing");

  const malformed = runAccessAudit({ env: envWith({ RELEASE_E2E_E2B_API_KEY: "wrong-prefix-key" }), runCommand: commandsAllOk() });
  assert.equal(malformed.results.find((r) => r.name === "e2b")!.status, "malformed");
});

test("a Stripe LIVE key is rejected as malformed (only sk_test_ satisfies the release-e2e audit)", () => {
  const report = runAccessAudit({ env: envWith({ STRIPE_SECRET_KEY: FAKE_STRIPE_LIVE_KEY }), runCommand: commandsAllOk() });
  assert.equal(report.results.find((r) => r.name === "stripe")!.status, "malformed");
});

test("the litellm/gateway endpoint check requires a public https URL", () => {
  const httpOnly = runAccessAudit({
    env: envWith({ RELEASE_E2E_GATEWAY_BASE_URL: "http://not-secure.example.test" }),
    runCommand: commandsAllOk(),
  });
  assert.equal(httpOnly.results.find((r) => r.name === "litellm-gateway")!.status, "malformed");
});

test("no report ever contains any planted fake secret value, across every status branch", () => {
  const secrets = [FAKE_E2B_KEY, FAKE_STRIPE_LIVE_KEY, FAKE_STRIPE_TEST_KEY];
  const reports = [
    runAccessAudit({
      env: envWith({
        RELEASE_E2E_E2B_API_KEY: FAKE_E2B_KEY,
        STRIPE_SECRET_KEY: FAKE_STRIPE_TEST_KEY,
      }),
      runCommand: commandsAllOk(),
    }),
    runAccessAudit({ env: envWith({ STRIPE_SECRET_KEY: FAKE_STRIPE_LIVE_KEY }), runCommand: commandsAllFail() }),
  ];
  const serialized = JSON.stringify(reports);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret.slice(0, 3)}...`);
  }
});

test("runCommand is injected, never actually shells out to gh/aws in this test", () => {
  let calls = 0;
  const spy: RunCommand = (command): CommandResult => {
    calls += 1;
    assert.ok(["gh", "aws"].includes(command));
    return { ok: true, spawnError: false };
  };
  runAccessAudit({ env: envWith({}), runCommand: spy });
  assert.equal(calls, 2);
});
