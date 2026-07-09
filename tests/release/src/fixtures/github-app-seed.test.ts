import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ApiRequestError } from "./http.js";
import {
  githubAppSeedAvailable,
  isGithubAppAuthorizationRequiredError,
  isGithubAppInstallationRequiredError,
  isGithubAppRepoNotCoveredError,
  parseSeedOutput,
  seedStatePath,
} from "./github-app-seed.js";

const DB = "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate_dev_t3local";

test("seedStatePath honours the override and otherwise uses the default home path", () => {
  assert.equal(seedStatePath({ RELEASE_E2E_GITHUB_APP_SEED_STATE: "/tmp/seed.json" }), "/tmp/seed.json");
  assert.equal(
    seedStatePath({}),
    path.join(os.homedir(), ".proliferate-local/dev/release-e2e-github-seed.json"),
  );
  // whitespace-only override is treated as unset
  assert.equal(
    seedStatePath({ RELEASE_E2E_GITHUB_APP_SEED_STATE: "   " }),
    path.join(os.homedir(), ".proliferate-local/dev/release-e2e-github-seed.json"),
  );
});

test("githubAppSeedAvailable requires the local DB url", () => {
  assert.equal(
    githubAppSeedAvailable({ RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN: "ghr_x" }, () => true),
    false,
  );
});

test("githubAppSeedAvailable is true with the DB url plus a bootstrap token", () => {
  assert.equal(
    githubAppSeedAvailable(
      { RELEASE_E2E_LOCAL_DATABASE_URL: DB, RELEASE_E2E_GITHUB_APP_SEED_REFRESH_TOKEN: "ghr_x" },
      () => false,
    ),
    true,
  );
});

test("githubAppSeedAvailable is true with the DB url plus an existing state file", () => {
  assert.equal(githubAppSeedAvailable({ RELEASE_E2E_LOCAL_DATABASE_URL: DB }, () => true), true);
});

test("githubAppSeedAvailable is false with the DB url but no credential", () => {
  assert.equal(githubAppSeedAvailable({ RELEASE_E2E_LOCAL_DATABASE_URL: DB }, () => false), false);
});

test("parseSeedOutput reads the last JSON line, ignoring leading log noise", () => {
  const stdout = "some warning\n{\"seeded\":{\"status\":\"ready\"},\"error\":null}\n";
  const parsed = parseSeedOutput<{ seeded: { status: string }; error: null }>(stdout);
  assert.equal(parsed.seeded.status, "ready");
  assert.equal(parsed.error, null);
});

function cloudError(status: number, code: string): ApiRequestError {
  // FastAPI's default envelope: {"detail": {"code": ...}}
  return new ApiRequestError("PUT", "/v1/cloud/repositories/o/r/environment", status, {
    detail: { code, message: "x" },
  });
}

test("authorization-required classifier matches only the 409 auth code", () => {
  assert.equal(isGithubAppAuthorizationRequiredError(cloudError(409, "github_app_authorization_required")), true);
  // top-level code variant (some routes)
  assert.equal(
    isGithubAppAuthorizationRequiredError(
      new ApiRequestError("PUT", "/x", 409, { code: "github_app_authorization_required" }),
    ),
    true,
  );
  assert.equal(isGithubAppAuthorizationRequiredError(cloudError(409, "github_app_installation_required")), false);
  assert.equal(isGithubAppAuthorizationRequiredError(cloudError(403, "github_app_authorization_required")), false);
  assert.equal(isGithubAppAuthorizationRequiredError(new Error("nope")), false);
});

test("installation-required and repo-not-covered classifiers are distinct", () => {
  assert.equal(isGithubAppInstallationRequiredError(cloudError(409, "github_app_installation_required")), true);
  assert.equal(isGithubAppInstallationRequiredError(cloudError(409, "github_app_authorization_required")), false);
  assert.equal(isGithubAppRepoNotCoveredError(cloudError(409, "github_app_repo_not_covered")), true);
  assert.equal(isGithubAppRepoNotCoveredError(cloudError(409, "github_app_installation_required")), false);
});
