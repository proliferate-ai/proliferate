import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  assertLocalProfileTargetLaneCompatibility,
  loadLocalProfileEnvironment,
  LocalProfileConfigurationError,
  type CandidateBuildIdentity,
} from "./local-profile.js";

const TEST_GIT_HEAD = "a".repeat(40);
const TEST_BUILD_IDENTITY = `sha256:${"b".repeat(64)}`;
const TEST_CANDIDATE_IDENTITY: CandidateBuildIdentity = {
  gitHead: TEST_GIT_HEAD,
  buildIdentity: TEST_BUILD_IDENTITY,
};
const DEFAULT_DATABASE_HOST = process.platform === "darwin" ? "::1" : "127.0.0.1";

test("loadLocalProfileEnvironment derives safe local endpoints and exposes profile posture", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  writeInstance(homeDir, "release", {
    profile: "release",
    worktreePath,
    databaseName: "proliferate_dev_release",
    databaseMode: "profile",
    singleOrgMode: true,
    publicCloudWorkerBaseUrl: "https://worker.example.test/callbacks/",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    const env: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "release",
      RELEASE_E2E_SERVER_URL: "http://ambient.test",
      LOCAL_PGHOST: "db-value-that-must-not-rewrite-profile-metadata.test",
    };
    const result = loadLocalProfileEnvironment(
      syntheticProfileOptions(env, homeDir, worktreePath),
    );
    assert.ok(result);
    assert.equal(env.RELEASE_E2E_SERVER_URL, "http://ambient.test");
    assert.equal(env.RELEASE_E2E_LOCAL_RUNTIME_URL, "http://127.0.0.1:18542");
    assert.equal(env.RELEASE_E2E_DESKTOP_WEB_URL, "http://127.0.0.1:11590");
    assert.equal(
      env.RELEASE_E2E_LOCAL_DATABASE_URL,
      `postgresql+asyncpg://proliferate:localdev@${databaseUrlHost(DEFAULT_DATABASE_HOST)}:5432/` +
        "proliferate_dev_release",
    );
    assert.equal(result.singleOrgMode, true);
    assert.equal(result.managedDatabaseUsesSafeDefaults, true);
    assert.equal(result.requiresExplicitDatabaseUrl, false);
    assert.deepEqual(result.managedDatabaseConnection, {
      host: DEFAULT_DATABASE_HOST,
      port: 5432,
      user: "proliferate",
      database: "proliferate_dev_release",
    });
    assert.equal(result.managedDatabaseUsesDefaultPassword, true);
    assert.equal(result.candidateGitHead, TEST_GIT_HEAD);
    assert.equal(result.candidateBuildIdentity, TEST_BUILD_IDENTITY);
    assert.equal(result.publicCloudWorkerBaseUrl, "https://worker.example.test/callbacks");
    assert.deepEqual(result.preservedNames, ["RELEASE_E2E_SERVER_URL"]);
    assert.equal(JSON.stringify(result).includes("localdev"), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadLocalProfileEnvironment rejects a profile bound to a vanished worktree", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  writeInstance(homeDir, "stale", {
    profile: "stale",
    worktreePath: path.join(homeDir, "does-not-exist"),
    databaseName: "proliferate_dev_stale",
    databaseMode: "profile",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    assert.throws(
      () => loadLocalProfileEnvironment({ env: { RELEASE_E2E_PROFILE: "stale" }, homeDir }),
      (error: unknown) => {
        assert.ok(error instanceof LocalProfileConfigurationError);
        assert.match(error.message, /is stale/);
        assert.match(error.message, /make setup PROFILE=stale-clean/);
        return true;
      },
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("profile endpoints replace shared-file values but not original ambient values", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  writeInstance(homeDir, "release", {
    profile: "release",
    worktreePath,
    databaseName: "proliferate_dev_release",
    databaseMode: "profile",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    const env: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "release",
      RELEASE_E2E_SERVER_URL: "http://stale-file.test",
      RELEASE_E2E_DURABLE_ORG_ID: "stale-profile-org",
    };
    loadLocalProfileEnvironment({
      ...syntheticProfileOptions(env, homeDir, worktreePath),
      preserveNames: new Set(["RELEASE_E2E_PROFILE"]),
    });
    assert.equal(env.RELEASE_E2E_SERVER_URL, "http://127.0.0.1:18086");
    assert.equal(env.RELEASE_E2E_DURABLE_ORG_ID, undefined);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("profile must be bound to the candidate worktree unless ambient override is explicit", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const profileWorktree = path.join(homeDir, "profile-worktree");
  const candidateWorktree = path.join(homeDir, "candidate-worktree");
  mkdirSync(profileWorktree);
  mkdirSync(candidateWorktree);
  writeInstance(homeDir, "release", {
    profile: "release",
    worktreePath: profileWorktree,
    databaseName: "proliferate_dev_release",
    databaseMode: "profile",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    assert.throws(
      () =>
        loadLocalProfileEnvironment({
          env: { RELEASE_E2E_PROFILE: "release" },
          homeDir,
          currentWorktreePath: candidateWorktree,
        }),
      /bound to a different worktree/,
    );
    assert.doesNotThrow(() =>
      loadLocalProfileEnvironment({
        env: {
          RELEASE_E2E_PROFILE: "release",
          RELEASE_E2E_ALLOW_PROFILE_WORKTREE_MISMATCH: "1",
        },
        homeDir,
        currentWorktreePath: candidateWorktree,
        profileCandidateIdentity: TEST_CANDIDATE_IDENTITY,
      }),
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("profile rejects a checkout that changed after its launch metadata was recorded", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  writeInstance(homeDir, "release", {
    profile: "release",
    worktreePath,
    databaseName: "proliferate_dev_release",
    databaseMode: "profile",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    assert.throws(
      () =>
        loadLocalProfileEnvironment({
          env: { RELEASE_E2E_PROFILE: "release" },
          homeDir,
          currentWorktreePath: worktreePath,
          profileCandidateIdentity: {
            gitHead: "c".repeat(40),
            buildIdentity: `sha256:${"d".repeat(64)}`,
          },
        }),
      /bound checkout changed after profile launch/,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("custom managed database identity requires an explicit release database URL", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  writeInstance(homeDir, "custom", {
    profile: "custom",
    worktreePath,
    databaseName: "custom_release_db",
    databaseMode: "profile",
    managedDatabaseConnection: {
      host: "db.dev.internal",
      port: 6543,
      user: "release_user",
      database: "custom_release_db",
    },
    managedDatabaseUsesDefaultPassword: false,
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    const fromFile: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "custom",
      RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://stale-file",
    };
    const result = loadLocalProfileEnvironment({
      ...syntheticProfileOptions(fromFile, homeDir, worktreePath),
      preserveNames: new Set(["RELEASE_E2E_PROFILE"]),
    });
    assert.ok(result);
    assert.equal(result.managedDatabaseUsesSafeDefaults, false);
    assert.equal(result.requiresExplicitDatabaseUrl, true);
    assert.equal(fromFile.RELEASE_E2E_LOCAL_DATABASE_URL, undefined);

    const explicit: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "custom",
      RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://explicit",
    };
    loadLocalProfileEnvironment({
      ...syntheticProfileOptions(explicit, homeDir, worktreePath),
      preserveNames: new Set(["RELEASE_E2E_PROFILE", "RELEASE_E2E_LOCAL_DATABASE_URL"]),
    });
    assert.equal(explicit.RELEASE_E2E_LOCAL_DATABASE_URL, "postgresql://explicit");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("external database profiles require an explicit test-side database URL", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  writeInstance(homeDir, "external", {
    profile: "external",
    worktreePath,
    databaseName: "unused_profile_name",
    databaseMode: "external",
    ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
  });
  try {
    const fromFile: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "external",
      RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://stale-file",
    };
    const result = loadLocalProfileEnvironment({
      ...syntheticProfileOptions(fromFile, homeDir, worktreePath),
      preserveNames: new Set(["RELEASE_E2E_PROFILE"]),
    });
    assert.ok(result);
    assert.equal(result.requiresExplicitDatabaseUrl, true);
    assert.equal(result.managedDatabaseConnection, undefined);
    assert.equal(fromFile.RELEASE_E2E_LOCAL_DATABASE_URL, undefined);

    const explicit: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: "external",
      RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://explicit",
    };
    loadLocalProfileEnvironment({
      ...syntheticProfileOptions(explicit, homeDir, worktreePath),
      preserveNames: new Set(["RELEASE_E2E_PROFILE", "RELEASE_E2E_LOCAL_DATABASE_URL"]),
    });
    assert.equal(explicit.RELEASE_E2E_LOCAL_DATABASE_URL, "postgresql://explicit");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("profile metadata is structurally validated", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  const worktreePath = path.join(homeDir, "worktree");
  mkdirSync(worktreePath);
  try {
    writeInstance(homeDir, "old", {
      profile: "old",
      worktreePath,
      databaseName: "proliferate_dev_old",
      databaseMode: "profile",
      singleOrgMode: undefined,
      ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
    });
    assert.throws(
      () =>
        loadLocalProfileEnvironment(
          syntheticProfileOptions({ RELEASE_E2E_PROFILE: "old" }, homeDir, worktreePath),
        ),
      /single-org posture tracking/,
    );

    writeInstance(homeDir, "bad-db", {
      profile: "bad-db",
      worktreePath,
      databaseName: "proliferate_dev_bad_db",
      databaseMode: "profile",
      managedDatabaseConnection: {
        host: "127.0.0.1",
        port: 5432,
        user: "proliferate",
        database: "wrong_database",
      },
      managedDatabaseUsesDefaultPassword: true,
      ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
    });
    assert.throws(
      () =>
        loadLocalProfileEnvironment(
          syntheticProfileOptions({ RELEASE_E2E_PROFILE: "bad-db" }, homeDir, worktreePath),
        ),
      /database identity mismatch/,
    );

    writeInstance(homeDir, "bad-callback", {
      profile: "bad-callback",
      worktreePath,
      databaseName: "proliferate_dev_bad_callback",
      databaseMode: "profile",
      publicCloudWorkerBaseUrl: "http://127.0.0.1:8000",
      ports: { api: 18086, desktopWeb: 11590, anyharness: 18542 },
    });
    assert.throws(
      () =>
        loadLocalProfileEnvironment(
          syntheticProfileOptions(
            { RELEASE_E2E_PROFILE: "bad-callback" },
            homeDir,
            worktreePath,
          ),
        ),
      /invalid public Cloud worker callback URL/,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("local profile and staging target lane are mutually exclusive", () => {
  assert.doesNotThrow(() =>
    assertLocalProfileTargetLaneCompatibility("local", { RELEASE_E2E_PROFILE: "release" }),
  );
  assert.doesNotThrow(() => assertLocalProfileTargetLaneCompatibility("staging", {}));
  assert.throws(
    () =>
      assertLocalProfileTargetLaneCompatibility("staging", {
        RELEASE_E2E_PROFILE: "release",
      }),
    /cannot be combined with --lane staging/,
  );
});

test("dev profile writer persists non-secret launch identity and public callback metadata", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "dev-profile-writer-home-"));
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const profile = "metadata-test";
  const scriptPath = path.join(repoRoot, "scripts/dev.mjs");
  const secretPassword = "super-secret-database-password";
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    PROLIFERATE_DEV_DATABASE_MODE: "profile",
    SINGLE_ORG_MODE: "true",
    LOCAL_PGHOST: "db.dev.internal",
    LOCAL_PGPORT: "6543",
    LOCAL_PGUSER: "custom_user",
    LOCAL_PGPASSWORD: secretPassword,
    CLOUD_WORKER_BASE_URL: "http://127.0.0.1:8000",
  };
  try {
    execFileSync(process.execPath, [scriptPath, "ensure", "--profile", profile], {
      cwd: repoRoot,
      env: baseEnv,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const instancePath = path.join(
      homeDir,
      ".proliferate-local/dev/profiles",
      profile,
      "instance.json",
    );
    let instance = JSON.parse(readFileSync(instancePath, "utf8")) as Record<string, unknown>;
    assert.equal(instance.singleOrgMode, true);
    assert.equal(instance.publicCloudWorkerBaseUrl, undefined);
    assert.deepEqual(instance.managedDatabaseConnection, {
      host: "db.dev.internal",
      port: 6543,
      user: "custom_user",
      database: "proliferate_dev_metadata_test",
    });
    assert.equal(instance.managedDatabaseUsesDefaultPassword, false);
    assert.match(String(instance.candidateGitHead), /^[0-9a-f]{40,64}$/);
    assert.match(String(instance.candidateBuildIdentity), /^sha256:[0-9a-f]{64}$/);

    execFileSync(process.execPath, [scriptPath, "record-runtime-metadata", "--profile", profile], {
      cwd: repoRoot,
      env: { ...baseEnv, CLOUD_WORKER_BASE_URL: "https://callbacks.example.test/worker/" },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const rawInstance = readFileSync(instancePath, "utf8");
    instance = JSON.parse(rawInstance) as Record<string, unknown>;
    assert.equal(instance.publicCloudWorkerBaseUrl, "https://callbacks.example.test/worker");
    assert.equal(rawInstance.includes(secretPassword), false);
    assert.equal(rawInstance.includes("DATABASE_URL"), false);
    assert.equal(rawInstance.includes("postgresql"), false);

    const releaseEnv: NodeJS.ProcessEnv = {
      RELEASE_E2E_PROFILE: profile,
      RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql://explicit-test-only",
    };
    const loaded = loadLocalProfileEnvironment({ env: releaseEnv, homeDir });
    assert.ok(loaded);
    assert.equal(loaded.candidateGitHead, instance.candidateGitHead);
    assert.equal(loaded.candidateBuildIdentity, instance.candidateBuildIdentity);
    assert.equal(loaded.publicCloudWorkerBaseUrl, "https://callbacks.example.test/worker");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("loadLocalProfileEnvironment reports missing and malformed profiles clearly", () => {
  const homeDir = mkdtempSync(path.join(tmpdir(), "release-profile-home-"));
  try {
    assert.throws(
      () => loadLocalProfileEnvironment({ env: { RELEASE_E2E_PROFILE: "missing" }, homeDir }),
      /make setup PROFILE=missing/,
    );
    assert.throws(
      () => loadLocalProfileEnvironment({ env: { RELEASE_E2E_PROFILE: "../escape" }, homeDir }),
      /must contain only/,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

function syntheticProfileOptions(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  worktreePath: string,
) {
  return {
    env,
    homeDir,
    currentWorktreePath: worktreePath,
    profileCandidateIdentity: TEST_CANDIDATE_IDENTITY,
  };
}

function writeInstance(homeDir: string, profile: string, value: Record<string, unknown>): void {
  const directory = path.join(homeDir, ".proliferate-local/dev/profiles", profile);
  mkdirSync(directory, { recursive: true });
  const instance: Record<string, unknown> = {
    singleOrgMode: false,
    candidateGitHead: TEST_GIT_HEAD,
    candidateBuildIdentity: TEST_BUILD_IDENTITY,
    ...value,
  };
  if (value.databaseMode === "profile" && !("managedDatabaseConnection" in value)) {
    instance.managedDatabaseConnection = {
      host: DEFAULT_DATABASE_HOST,
      port: 5432,
      user: "proliferate",
      database: value.databaseName,
    };
    instance.managedDatabaseUsesDefaultPassword = true;
  }
  writeFileSync(path.join(directory, "instance.json"), `${JSON.stringify(instance)}\n`);
}

function databaseUrlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
