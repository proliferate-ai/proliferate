import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { BoxExec } from "./box-exec.js";
import {
  getBotRefreshTokenFromSsm,
  persistRotatedBotSeed,
  persistRotatedBotSeedDurable,
  putBotRefreshTokenToSsm,
  seedGithubAuthorizationOnBox,
  seedUnlimitedCloudEntitlementOnBox,
  type GithubTokenRefresher,
} from "./box-seeds.js";
import type { AwsCliExec } from "./ec2.js";

const ACTOR_ID = "11111111-2222-3333-4444-555555555555";

interface FakeBox extends BoxExec {
  scripts: string[];
  putFiles: Array<{ name: string; contents: string }>;
  removed: string[];
}

function fakeBox(stdoutForPython: (script: string) => string): FakeBox {
  const scripts: string[] = [];
  const putFiles: Array<{ name: string; contents: string }> = [];
  const removed: string[] = [];
  return {
    scripts,
    putFiles,
    removed,
    exec: async () => ({ stdout: "", stderr: "" }),
    putSecretFile: async (name, contents) => {
      putFiles.push({ name, contents });
      return `/home/ubuntu/candidate/${name}`;
    },
    readRemoteFile: async () => "",
    removeRemoteFile: async (remotePath) => {
      removed.push(remotePath);
    },
    serverPython: async (script) => {
      scripts.push(script);
      return { stdout: stdoutForPython(script), stderr: "" };
    },
  };
}

test("seedUnlimitedCloudEntitlementOnBox runs the entitlement seed and returns the subject id", async () => {
  const box = fakeBox(() => '{"billing_subject_id": "sub-123"}');
  const result = await seedUnlimitedCloudEntitlementOnBox(box, ACTOR_ID);
  assert.equal(result.billingSubjectId, "sub-123");
  assert.equal(box.scripts.length, 1);
  assert.ok(box.scripts[0]!.includes("UNLIMITED_CLOUD_ENTITLEMENT"));
  assert.ok(box.scripts[0]!.includes("BillingEntitlement"));
});

test("seedUnlimitedCloudEntitlementOnBox rejects a non-UUID actor id (no injection into the snippet)", async () => {
  const box = fakeBox(() => "{}");
  await assert.rejects(
    seedUnlimitedCloudEntitlementOnBox(box, "'; DROP TABLE billing_entitlement; --"),
    /non-UUID/,
  );
  assert.equal(box.scripts.length, 0);
});

test("seedUnlimitedCloudEntitlementOnBox fails loudly when the seed reports no subject id", async () => {
  const box = fakeBox(() => "{}");
  await assert.rejects(seedUnlimitedCloudEntitlementOnBox(box, ACTOR_ID), /did not report a billing subject id/);
});

function fakeRefresher(refreshToken: string | null): GithubTokenRefresher {
  return {
    async refresh() {
      return {
        accessToken: "gho_access",
        refreshToken,
        expiresAtUnix: 1_000,
        refreshTokenExpiresAtUnix: 2_000,
        githubLogin: "proliferate-e2e-bot",
        githubUserId: "301498062",
      };
    },
  };
}

test("seedGithubAuthorizationOnBox refreshes, persists the rotated token FIRST, then upserts on the box", async () => {
  const box = fakeBox(() => '{"github_login": "proliferate-e2e-bot", "github_user_id": "301498062"}');
  const persisted: Array<{ refreshToken: string; githubLogin: string }> = [];
  const result = await seedGithubAuthorizationOnBox({
    box,
    userId: ACTOR_ID,
    clientId: "Iv23xxxx",
    clientSecret: "secret",
    refreshToken: "ghr_old",
    coveredRepoOwner: "proliferate-e2e",
    coveredRepoName: "e2e-fixture",
    coveredRepoDefaultBranch: "main",
    persistRotatedRefreshToken: async (next) => {
      // Persistence must happen before the on-box upsert reads the auth file.
      assert.equal(box.putFiles.length, 0, "rotated token must be persisted before the box upsert stages the auth file");
      persisted.push({ refreshToken: next.refreshToken, githubLogin: next.githubLogin });
    },
    refresher: fakeRefresher("ghr_new_rotated"),
  });
  assert.equal(result.githubLogin, "proliferate-e2e-bot");
  assert.equal(result.refreshTokenRotated, true);
  assert.deepEqual(persisted, [{ refreshToken: "ghr_new_rotated", githubLogin: "proliferate-e2e-bot" }]);
  // The auth file is staged (with the access token + covered repo) and then shredded.
  assert.equal(box.putFiles.length, 1);
  assert.ok(box.putFiles[0]!.contents.includes("gho_access"));
  assert.ok(box.putFiles[0]!.contents.includes("proliferate-e2e"));
  assert.ok(box.putFiles[0]!.contents.includes("e2e-fixture"));
  assert.equal(box.removed.length, 1);
  assert.ok(box.scripts[0]!.includes("upsert_github_app_authorization"));
  // The seed configures the covered repo as a cloud repo_environment so the
  // sandbox bootstrap preclones it (spec step 7).
  assert.ok(box.scripts[0]!.includes("upsert_cloud_repo_environment"));
});

test("seedGithubAuthorizationOnBox does not persist when GitHub returns no rotated token", async () => {
  const box = fakeBox(() => '{"github_login": "proliferate-e2e-bot", "github_user_id": "301498062"}');
  let persistCalls = 0;
  const result = await seedGithubAuthorizationOnBox({
    box,
    userId: ACTOR_ID,
    clientId: "Iv23xxxx",
    clientSecret: "secret",
    refreshToken: "ghr_old",
    coveredRepoOwner: "proliferate-e2e",
    coveredRepoName: "e2e-fixture",
    coveredRepoDefaultBranch: "main",
    persistRotatedRefreshToken: async () => {
      persistCalls += 1;
    },
    refresher: fakeRefresher(null),
  });
  assert.equal(persistCalls, 0);
  assert.equal(result.refreshTokenRotated, false);
});

test("seedGithubAuthorizationOnBox seed-only mode cannot invoke provider materialization", async () => {
  const box = fakeBox(() => '{"github_login": "proliferate-e2e-bot", "github_user_id": "301498062"}');
  await seedGithubAuthorizationOnBox({
    box,
    userId: ACTOR_ID,
    clientId: "Iv23xxxx",
    clientSecret: "secret",
    refreshToken: "ghr_old",
    coveredRepoOwner: "proliferate-e2e",
    coveredRepoName: "e2e-fixture",
    coveredRepoDefaultBranch: "main",
    materializeSandbox: false,
    persistRotatedRefreshToken: async () => undefined,
    refresher: fakeRefresher(null),
  });
  const payload = JSON.parse(box.putFiles[0]!.contents) as Record<string, unknown>;
  assert.equal(payload.materialize_sandbox, false);
  assert.match(box.scripts[0]!, /if payload\.get\("materialize_sandbox", True\):/);
});

test("persistRotatedBotSeed writes a 0600 seed file with the rotated token and identity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seed-"));
  const seedPath = path.join(dir, "seed.json");
  await persistRotatedBotSeed(seedPath, {
    refreshToken: "ghr_rotated",
    githubLogin: "proliferate-e2e-bot",
    githubUserId: "301498062",
  });
  const parsed = JSON.parse(await readFile(seedPath, "utf8")) as Record<string, unknown>;
  assert.equal(parsed.refresh_token, "ghr_rotated");
  assert.equal(parsed.github_login, "proliferate-e2e-bot");
  assert.equal(parsed.github_user_id, "301498062");
});

// ---------------------------------------------------------------------------
// MCW-004 — durable AWS SSM Parameter Store seam
// ---------------------------------------------------------------------------

const SSM_PARAM = "/proliferate/qualification/github-bot-refresh-token";

function fakeAwsExec(
  calls: string[][],
  handler: (args: string[]) => { stdout: string; stderr: string } | Error,
): AwsCliExec {
  return async (file, args) => {
    calls.push([file, ...args]);
    const result = handler(args);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
}

test("getBotRefreshTokenFromSsm resolves the decrypted parameter value and never puts it in argv", async () => {
  const calls: string[][] = [];
  const exec = fakeAwsExec(calls, () => ({ stdout: "ghr_from_ssm\n", stderr: "" }));
  const result = await getBotRefreshTokenFromSsm(SSM_PARAM, exec);
  assert.deepEqual(result, { refreshToken: "ghr_from_ssm" });
  assert.equal(calls.length, 1);
  const [, ...args] = calls[0]!;
  assert.ok(args.includes("get-parameter"));
  assert.ok(args.includes("--with-decryption"));
  assert.ok(args.includes(SSM_PARAM));
  assert.ok(!args.some((arg) => arg.includes("ghr_from_ssm")), "the resolved token must never appear in argv");
});

test("getBotRefreshTokenFromSsm passes --region when given (CI maps RELEASE_E2E_CLOUD_AWS_REGION, not AWS_REGION)", async () => {
  const calls: string[][] = [];
  const exec = fakeAwsExec(calls, () => ({ stdout: "ghr_from_ssm\n", stderr: "" }));
  await getBotRefreshTokenFromSsm(SSM_PARAM, exec, "us-east-1");
  const [, ...args] = calls[0]!;
  const regionIdx = args.indexOf("--region");
  assert.ok(regionIdx >= 0, "expected --region in the SSM get-parameter argv");
  assert.equal(args[regionIdx + 1], "us-east-1");
});

test("getBotRefreshTokenFromSsm returns a bounded honest reason when the parameter is empty", async () => {
  const exec = fakeAwsExec([], () => ({ stdout: "None\n", stderr: "" }));
  const result = await getBotRefreshTokenFromSsm(SSM_PARAM, exec);
  assert.equal(result.refreshToken, null);
  assert.ok("reason" in result && /empty value/.test(result.reason));
});

test("getBotRefreshTokenFromSsm returns a bounded honest reason instead of throwing when the aws CLI fails", async () => {
  const exec = fakeAwsExec([], () => new Error("Command failed: aws ssm get-parameter ... ParameterNotFound"));
  const result = await getBotRefreshTokenFromSsm(SSM_PARAM, exec);
  assert.equal(result.refreshToken, null);
  assert.ok("reason" in result && /ParameterNotFound/.test(result.reason));
});

test("putBotRefreshTokenToSsm writes the token via a file:// temp file, never argv, and cleans it up", async () => {
  const calls: string[][] = [];
  let tmpPathSeen: string | null = null;
  const exec = fakeAwsExec(calls, (args) => {
    const valueArg = args[args.indexOf("--value") + 1]!;
    assert.ok(valueArg.startsWith("file://"), "the token must be passed via file://, never inline argv");
    tmpPathSeen = valueArg.slice("file://".length);
    return { stdout: "", stderr: "" };
  });
  await putBotRefreshTokenToSsm(SSM_PARAM, "ghr_rotated_secret", exec);

  const [, ...args] = calls[0]!;
  assert.ok(args.includes("put-parameter"));
  assert.ok(args.includes("--overwrite"));
  assert.ok(args.includes("SecureString"));
  assert.ok(!args.some((arg) => arg.includes("ghr_rotated_secret")), "the token must never appear directly in argv");
  assert.ok(tmpPathSeen, "put-parameter must be called with a --value argument");
  await assert.rejects(stat(tmpPathSeen!), "the temp file holding the token must be removed after the call");
});

test("putBotRefreshTokenToSsm throws loudly (does not swallow) when the aws CLI call fails", async () => {
  const exec = fakeAwsExec([], () => new Error("Command failed: aws ssm put-parameter ... AccessDenied"));
  await assert.rejects(putBotRefreshTokenToSsm(SSM_PARAM, "ghr_x", exec), /AccessDenied/);
});

test("persistRotatedBotSeedDurable writes ONLY the local seed file when running locally with a file-sourced token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seed-durable-"));
  const seedPath = path.join(dir, "seed.json");
  const calls: string[][] = [];
  const exec = fakeAwsExec(calls, () => ({ stdout: "", stderr: "" }));

  await persistRotatedBotSeedDurable(
    {
      localSeedFilePath: seedPath,
      source: "file",
      ssmParameterName: SSM_PARAM,
      exec,
      env: {},
    },
    { refreshToken: "ghr_rotated", githubLogin: "proliferate-e2e-bot", githubUserId: "301498062" },
  );

  const parsed = JSON.parse(await readFile(seedPath, "utf8")) as Record<string, unknown>;
  assert.equal(parsed.refresh_token, "ghr_rotated");
  assert.equal(calls.length, 0, "SSM must not be written when the token did not come from SSM and we are not in Actions");
});

test("persistRotatedBotSeedDurable writes BOTH the local file and SSM when the token came from SSM (locally)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seed-durable-"));
  const seedPath = path.join(dir, "seed.json");
  const calls: string[][] = [];
  const exec = fakeAwsExec(calls, () => ({ stdout: "", stderr: "" }));

  await persistRotatedBotSeedDurable(
    {
      localSeedFilePath: seedPath,
      source: "ssm",
      ssmParameterName: SSM_PARAM,
      exec,
      env: {},
    },
    { refreshToken: "ghr_rotated", githubLogin: "proliferate-e2e-bot", githubUserId: "301498062" },
  );

  const parsed = JSON.parse(await readFile(seedPath, "utf8")) as Record<string, unknown>;
  assert.equal(parsed.refresh_token, "ghr_rotated");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("put-parameter"));
});

test("persistRotatedBotSeedDurable writes ONLY SSM in Actions, skipping the ephemeral-runner local file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seed-durable-"));
  const seedPath = path.join(dir, "seed.json");
  const calls: string[][] = [];
  const exec = fakeAwsExec(calls, () => ({ stdout: "", stderr: "" }));

  await persistRotatedBotSeedDurable(
    {
      localSeedFilePath: seedPath,
      source: "env",
      ssmParameterName: SSM_PARAM,
      exec,
      env: { GITHUB_ACTIONS: "true" },
    },
    { refreshToken: "ghr_rotated", githubLogin: "proliferate-e2e-bot", githubUserId: "301498062" },
  );

  await assert.rejects(stat(seedPath), "the local seed file must not be written in Actions");
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("put-parameter"));
});

test("persistRotatedBotSeedDurable fails loudly (does not swallow) when the SSM write fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seed-durable-"));
  const seedPath = path.join(dir, "seed.json");
  const exec: AwsCliExec = async () => {
    throw new Error("Command failed: aws ssm put-parameter ... AccessDenied");
  };

  await assert.rejects(
    persistRotatedBotSeedDurable(
      {
        localSeedFilePath: seedPath,
        source: "ssm",
        ssmParameterName: SSM_PARAM,
        exec,
        env: {},
      },
      { refreshToken: "ghr_rotated", githubLogin: "proliferate-e2e-bot", githubUserId: "301498062" },
    ),
    /AccessDenied/,
  );
  // The local write still happened (it is independent of the SSM failure) — only the SSM leg failed.
  const parsed = JSON.parse(await readFile(seedPath, "utf8")) as Record<string, unknown>;
  assert.equal(parsed.refresh_token, "ghr_rotated");
});
