import assert from "node:assert/strict";
import { test } from "node:test";

import { assertResolved, MissingEnvVarsError, resolveEnv } from "./env-resolution.js";

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
