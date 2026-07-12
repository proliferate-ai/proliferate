import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertResolved,
  blockedReasonForMissingEnv,
  missingRequiredForLane,
  MissingEnvVarsError,
  requiredEnvForTargetLane,
  resolveEnv,
  scenarioUsesDurableIdentity,
} from "./env-resolution.js";

const NONE: ReadonlySet<string> = new Set<string>();

test("resolveEnv marks a declared var present when set to a non-empty value", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], { RELEASE_E2E_SERVER_URL: "http://example.test" });
  assert.equal(resolution.present("RELEASE_E2E_SERVER_URL"), true);
  assert.equal(resolution.get("RELEASE_E2E_SERVER_URL"), "http://example.test");
  assert.equal(resolution.missing.length, 0);
});

test("resolveEnv treats unset and empty-string the same: missing", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], { RELEASE_E2E_SERVER_URL: "" });
  assert.equal(resolution.present("RELEASE_E2E_SERVER_URL"), false);
  assert.equal(resolution.get("RELEASE_E2E_SERVER_URL"), undefined);
  assert.equal(resolution.missing.length, 1);
});

test("resolveEnv throws when asked about a var not in the manifest", () => {
  assert.throws(() => resolveEnv(["NOT_A_REAL_VAR"], {}), /not declared in the env manifest/);
});

test("EnvResolution.require throws MissingEnvVarsError for an unset var", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], {});
  assert.throws(() => resolution.require("RELEASE_E2E_SERVER_URL"), MissingEnvVarsError);
});

test("EnvResolution.require returns the value for a set var", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], { RELEASE_E2E_SERVER_URL: "http://example.test" });
  assert.equal(resolution.require("RELEASE_E2E_SERVER_URL"), "http://example.test");
});

test("assertResolved is a no-op when nothing is missing", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], { RELEASE_E2E_SERVER_URL: "http://example.test" });
  assert.doesNotThrow(() => assertResolved(resolution, { dryRun: false }));
});

test("assertResolved never throws under --dry-run, even with missing vars", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], {});
  assert.doesNotThrow(() => assertResolved(resolution, { dryRun: true }));
});

test("assertResolved throws a named-variable error outside --dry-run", () => {
  const resolution = resolveEnv(["RELEASE_E2E_SERVER_URL"], {});
  assert.throws(() => assertResolved(resolution, { dryRun: false }), (error: unknown) => {
    assert.ok(error instanceof MissingEnvVarsError);
    assert.match(error.message, /RELEASE_E2E_SERVER_URL/);
    return true;
  });
});

test("missingRequiredForLane reports an absent required var as unsatisfied", () => {
  const resolution = resolveEnv(["RELEASE_E2E_DURABLE_USER_EMAIL"], {});
  const missing = missingRequiredForLane(["RELEASE_E2E_DURABLE_USER_EMAIL"], "local", resolution, NONE);
  assert.deepEqual(missing, ["RELEASE_E2E_DURABLE_USER_EMAIL"]);
});

test("missingRequiredForLane treats a present var as satisfied on any lane", () => {
  const resolution = resolveEnv(["RELEASE_E2E_DURABLE_USER_EMAIL"], {
    RELEASE_E2E_DURABLE_USER_EMAIL: "durable@example.dev",
  });
  assert.deepEqual(missingRequiredForLane(["RELEASE_E2E_DURABLE_USER_EMAIL"], "local", resolution, NONE), []);
  assert.deepEqual(missingRequiredForLane(["RELEASE_E2E_DURABLE_USER_EMAIL"], "sandbox", resolution, NONE), []);
});

test("a locally-seeded var satisfies the local lane but not the sandbox lane", () => {
  const resolution = resolveEnv(["RELEASE_E2E_DURABLE_USER_EMAIL"], {
    RELEASE_E2E_DURABLE_USER_EMAIL: "durable@example.dev",
  });
  const seeded = new Set(["RELEASE_E2E_DURABLE_USER_EMAIL"]);
  assert.deepEqual(missingRequiredForLane(["RELEASE_E2E_DURABLE_USER_EMAIL"], "local", resolution, seeded), []);
  assert.deepEqual(missingRequiredForLane(["RELEASE_E2E_DURABLE_USER_EMAIL"], "sandbox", resolution, seeded), [
    "RELEASE_E2E_DURABLE_USER_EMAIL",
  ]);
});

test("required opt-ins are unsatisfied unless they have the exact activation value", () => {
  for (const value of [undefined, "", "0", "true"]) {
    const resolution = resolveEnv(["RELEASE_E2E_SELFHOST_PROVISION"], {
      RELEASE_E2E_SELFHOST_PROVISION: value,
    });
    assert.deepEqual(
      missingRequiredForLane(["RELEASE_E2E_SELFHOST_PROVISION"], "local", resolution, NONE),
      ["RELEASE_E2E_SELFHOST_PROVISION"],
    );
  }
  const active = resolveEnv(["RELEASE_E2E_SELFHOST_PROVISION"], {
    RELEASE_E2E_SELFHOST_PROVISION: "1",
  });
  assert.deepEqual(missingRequiredForLane(["RELEASE_E2E_SELFHOST_PROVISION"], "local", active, NONE), []);
});

test("requiredEnvForTargetLane keeps the list unchanged on the local target", () => {
  const required = ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_DURABLE_USER_PASSWORD"];
  assert.deepEqual(requiredEnvForTargetLane(required, "local"), required);
});

test("requiredEnvForTargetLane drops the durable email/password on the staging target", () => {
  const required = [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_USER_EMAIL",
    "RELEASE_E2E_DURABLE_USER_PASSWORD",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ];
  assert.deepEqual(requiredEnvForTargetLane(required, "staging"), [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_DURABLE_ORG_ID",
  ]);
});

test("requiredEnvForTargetLane keeps local-only vars on staging so scenarios still block honestly", () => {
  // e.g. billing_probe.py needs RELEASE_E2E_LOCAL_DATABASE_URL, which staging
  // does not expose — the scenario must report blocked, not silently run.
  assert.deepEqual(requiredEnvForTargetLane(["RELEASE_E2E_LOCAL_DATABASE_URL"], "staging"), [
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ]);
});

test("scenarioUsesDurableIdentity is true iff the durable email is required", () => {
  assert.equal(scenarioUsesDurableIdentity(["RELEASE_E2E_DURABLE_USER_EMAIL", "RELEASE_E2E_SERVER_URL"]), true);
  assert.equal(scenarioUsesDurableIdentity(["RELEASE_E2E_SERVER_URL"]), false);
  assert.equal(scenarioUsesDurableIdentity([]), false);
});

test("blockedReasonForMissingEnv names the scenario, lane, and where each var lives", () => {
  const reason = blockedReasonForMissingEnv(
    "T3-PROV-2",
    "sandbox",
    ["RELEASE_E2E_DURABLE_USER_EMAIL"],
    new Set(["RELEASE_E2E_DURABLE_USER_EMAIL"]),
  );
  assert.match(reason, /T3-PROV-2\/sandbox: blocked on unsatisfied environment requirement/);
  assert.match(reason, /RELEASE_E2E_DURABLE_USER_EMAIL/);
  assert.match(reason, /does not satisfy the sandbox lane/);
});
