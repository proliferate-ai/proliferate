import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupOwnedEphemeralProfile,
  createOwnedProfilePostgresCustody,
  createOwnedEphemeralProfile,
  ownedEphemeralProfileForWorker,
  prepareOwnedEphemeralProfile,
  type OwnedProfileLifecycle,
  type OwnedProfileResources,
} from "./ephemeral-profile.ts";

const ROOTS = {
  profileRoot: "/state/profiles",
  runtimeRoot: "/state/runtimes",
  tempRoot: "/state/tmp",
};

function owned(retry = 0) {
  return createOwnedEphemeralProfile({
    namespace: "t2e2bgate",
    runId: "29569721872",
    runAttempt: 2,
    workerIndex: 3,
    retry,
    roots: ROOTS,
  });
}

function lifecycle(options: {
  existingPaths?: string[];
  databaseExists?: boolean;
  calls?: string[];
} = {}): OwnedProfileLifecycle {
  const calls = options.calls ?? [];
  const existingPaths = new Set(options.existingPaths ?? []);
  return {
    pathExists: (target) => existingPaths.has(target),
    databaseExists: () => options.databaseExists ?? false,
    dropDatabase: (databaseName) => calls.push(`drop:${databaseName}`),
    removeFile: (target) => calls.push(`file:${target}`),
    removeDirectory: (target) => calls.push(`directory:${target}`),
  };
}

test("profile identity is bounded and changes across attempt, worker, and retry", () => {
  const base = ownedEphemeralProfileForWorker({
    namespace: "t2e2bgate",
    workerIndex: 0,
    retry: 0,
    env: { GITHUB_RUN_ID: "29569721872", GITHUB_RUN_ATTEMPT: "1" },
  });
  const variants = [
    ownedEphemeralProfileForWorker({
      namespace: "t2e2bgate",
      workerIndex: 0,
      retry: 0,
      env: { GITHUB_RUN_ID: "29569721872", GITHUB_RUN_ATTEMPT: "2" },
    }),
    ownedEphemeralProfileForWorker({
      namespace: "t2e2bgate",
      workerIndex: 1,
      retry: 0,
      env: { GITHUB_RUN_ID: "29569721872", GITHUB_RUN_ATTEMPT: "1" },
    }),
    ownedEphemeralProfileForWorker({
      namespace: "t2e2bgate",
      workerIndex: 0,
      retry: 1,
      env: { GITHUB_RUN_ID: "29569721872", GITHUB_RUN_ATTEMPT: "1" },
    }),
  ];

  for (const profile of [base, ...variants]) {
    assert.match(profile.profile, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    assert.ok(profile.profile.length <= 40);
  }
  assert.equal(new Set([base.profile, ...variants.map((value) => value.profile)]).size, 4);
  assert.notEqual(base.setupTokenFile, variants[2]!.setupTokenFile);
  assert.notEqual(base.databaseName, variants[2]!.databaseName);
});

test("database freshness, creation, server URL, and cleanup share one endpoint", () => {
  const sqlHosts: string[] = [];
  const custody = createOwnedProfilePostgresCustody({
    env: {},
    platform: "darwin",
    executeSql: (identity, sql) => {
      sqlHosts.push(`${identity.host}:${identity.port}:${identity.user}:${sql}`);
      return "";
    },
  });
  const profile = owned();

  prepareOwnedEphemeralProfile(profile, custody.lifecycle);
  cleanupOwnedEphemeralProfile(profile, profile, custody.lifecycle);

  assert.equal(custody.identity.host, "::1");
  assert.equal(custody.commandEnvironment.LOCAL_PGHOST, custody.identity.host);
  assert.equal(custody.commandEnvironment.LOCAL_PGPORT, custody.identity.port);
  assert.equal(custody.commandEnvironment.LOCAL_PGUSER, custody.identity.user);
  assert.equal(sqlHosts.length, 2);
  assert.ok(sqlHosts.every((call) => call.startsWith("::1:5432:proliferate:")));
});

test("freshness is fail-closed and never deletes a colliding owner", () => {
  const profile = owned();
  for (const collision of [
    { existingPaths: [profile.setupTokenFile] },
    { existingPaths: [profile.profileDirectory] },
    { existingPaths: [profile.runtimeDirectory] },
    { databaseExists: true },
  ]) {
    const calls: string[] = [];
    assert.throws(
      () => prepareOwnedEphemeralProfile(profile, lifecycle({ ...collision, calls })),
      /not fresh/,
    );
    assert.deepEqual(calls, []);
  }
});

test("cleanup removes only the exact resources carried by the owner", () => {
  const profile = owned();
  const calls: string[] = [];
  cleanupOwnedEphemeralProfile(profile, profile, lifecycle({ calls }));
  assert.deepEqual(calls, [
    `drop:${profile.databaseName}`,
    `file:${profile.setupTokenFile}`,
    `directory:${profile.runtimeDirectory}`,
    `directory:${profile.profileDirectory}`,
  ]);
});

test("cleanup rejects mismatched custody before touching any resource", () => {
  const profile = owned();
  const calls: string[] = [];
  const mismatched: OwnedProfileResources = {
    ...profile,
    setupTokenFile: `${profile.setupTokenFile}-other-owner`,
  };
  assert.throws(
    () => cleanupOwnedEphemeralProfile(profile, mismatched, lifecycle({ calls })),
    /resource mismatch/,
  );
  assert.deepEqual(calls, []);
});
