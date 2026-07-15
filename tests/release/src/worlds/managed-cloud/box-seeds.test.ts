import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { BoxExec } from "./box-exec.js";
import {
  persistRotatedBotSeed,
  seedGithubAuthorizationOnBox,
  seedUnlimitedCloudEntitlementOnBox,
  type GithubTokenRefresher,
} from "./box-seeds.js";

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
  // The auth file is staged (with the access token) and then shredded.
  assert.equal(box.putFiles.length, 1);
  assert.ok(box.putFiles[0]!.contents.includes("gho_access"));
  assert.equal(box.removed.length, 1);
  assert.ok(box.scripts[0]!.includes("upsert_github_app_authorization"));
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
    persistRotatedRefreshToken: async () => {
      persistCalls += 1;
    },
    refresher: fakeRefresher(null),
  });
  assert.equal(persistCalls, 0);
  assert.equal(result.refreshTokenRotated, false);
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
