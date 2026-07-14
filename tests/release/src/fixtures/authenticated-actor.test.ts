import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedActor,
  toStoredSession,
  type AuthenticatedActorTransport,
} from "./authenticated-actor.js";
import { ApiClient } from "./http.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { ActorKeyIdentity } from "../services/qualification-litellm.js";

function fakeWorld(): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: {
      run_id: "local-run-1",
      shard_id: "local-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    artifacts: {
      server: { artifact_id: "server/linux-amd64", version: "1", sha256: "s".repeat(64), path: "/tmp/server" },
      anyharness: { artifact_id: "anyharness/x86_64", version: "1", sha256: "a".repeat(64), path: "/tmp/anyharness" },
      desktopRenderer: {
        artifact_id: "desktop-renderer/browser",
        version: "1",
        sha256: "d".repeat(64),
        path: "/tmp/renderer",
      },
    },
    api: { baseUrl: "http://127.0.0.1:9001", client: new ApiClient({ baseUrl: "http://127.0.0.1:9001" }) },
    runtime: { baseUrl: "http://127.0.0.1:9002", client: undefined as never },
    renderer: { baseUrl: "http://127.0.0.1:9003", browser: undefined as never },
    gateway: {
      resolveActorKey: async ({ userId, enrollmentId }: { userId: string; enrollmentId: string }) =>
        ({
          userId,
          enrollmentId,
          teamId: "team-1",
          litellmUserId: "litellm-user-1",
          keyAlias: `vk-user-${userId}-${enrollmentId.slice(0, 8)}`,
          tokenId: "token-1",
          tokenIdHash: "hash-1",
        }) satisfies ActorKeyIdentity,
    } as unknown as ReadyLocalWorld["gateway"],
    paths: { runDir: "/tmp/run-1", runtimeHome: "/tmp/run-1/runtime-home", repositoriesDir: "/tmp/run-1/repositories" },
    close: async () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeTransport(overrides: Partial<AuthenticatedActorTransport> = {}): {
  transport: AuthenticatedActorTransport;
  calls: string[];
} {
  const calls: string[] = [];
  let enrollmentCallCount = 0;
  const transport: AuthenticatedActorTransport = {
    readSetupToken: async (setupTokenPath) => {
      calls.push(`readSetupToken:${setupTokenPath}`);
      return "the-setup-token";
    },
    claimSetup: async (params) => {
      calls.push(`claimSetup:${params.email}`);
    },
    loginWithPassword: async (apiBaseUrl, email) => {
      calls.push(`loginWithPassword:${email}`);
      return {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: "user-1", email, display_name: "Owner", github_login: null, avatar_url: null },
      };
    },
    listOrganizations: async () => {
      calls.push("listOrganizations");
      return { organizations: [{ id: "org-1" }] };
    },
    getEnrollment: async () => {
      enrollmentCallCount += 1;
      calls.push(`getEnrollment:${enrollmentCallCount}`);
      return {
        id: "enrollment-1",
        subjectKind: "user",
        litellmTeamId: "team-1",
        syncStatus: enrollmentCallCount < 2 ? "pending" : "synced",
        lastErrorCode: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
    },
    putGatewaySelection: async (_api, harnessKind) => {
      calls.push(`putGatewaySelection:${harnessKind}`);
    },
    ...overrides,
  };
  return { transport, calls };
}

test("toStoredSession maps the desktop token response onto the snake_case StoredAuthSession the client persists", () => {
  const session = toStoredSession({
    access_token: "a",
    refresh_token: "r",
    token_type: "bearer",
    expires_in: 60,
    user: { id: "u1", email: "owner@example.com", display_name: "Owner", github_login: "owner", avatar_url: null },
  });
  assert.equal(session.access_token, "a");
  assert.equal(session.refresh_token, "r");
  assert.equal(session.user_id, "u1");
  assert.equal(session.email, "owner@example.com");
  assert.equal(session.display_name, "Owner");
  assert.equal(session.github_login, "owner");
  assert.ok(!Number.isNaN(Date.parse(session.expires_at)));
});

test("authenticatedActor drives claim -> login -> org lookup -> enrollment poll -> gateway selection -> key resolution, in order", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  const actor = await authenticatedActor(world, "owner", {}, transport);

  assert.equal(actor.role, "owner");
  assert.equal(actor.userId, "user-1");
  assert.equal(actor.organizationId, "org-1");
  assert.equal(actor.enrollmentId, "enrollment-1");
  assert.equal(actor.gatewayKey.keyAlias, "vk-user-user-1-enrollme");
  assert.equal(actor.session.access_token, "access-1");
  // Never persists the raw password anywhere on the returned actor.
  assert.equal(JSON.stringify(actor).includes(actor.session.access_token), true);
  assert.equal("password" in (actor as unknown as Record<string, unknown>), false);

  assert.deepEqual(calls, [
    "readSetupToken:/tmp/run-1/setup-token",
    "claimSetup:qual-owner-local-run-1-local-0@local-world-smoke.invalid",
    "loginWithPassword:qual-owner-local-run-1-local-0@local-world-smoke.invalid",
    "listOrganizations",
    "getEnrollment:1",
    "getEnrollment:2",
    "putGatewaySelection:claude",
  ]);
});

test("authenticatedActor rejects non-owner roles", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  await assert.rejects(
    () => authenticatedActor(world, "admin" as unknown as "owner", {}, transport),
    /unsupported role/,
  );
});

test("authenticatedActor skips gateway-selection PUT when selectGatewayRoute is false", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();
  await authenticatedActor(world, "owner", { selectGatewayRoute: false }, transport);
  assert.ok(!calls.some((call) => call.startsWith("putGatewaySelection")));
});

test("authenticatedActor propagates a bounded timeout when enrollment never syncs", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport({
    getEnrollment: async () => ({
      id: "enrollment-1",
      subjectKind: "user",
      litellmTeamId: null,
      syncStatus: "pending",
      lastErrorCode: "gateway_unreachable",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  });
  await assert.rejects(
    () => authenticatedActor(world, "owner", { enrollmentTimeoutMs: 5, enrollmentPollMs: 1 }, transport),
    /did not reach "synced"/,
  );
});

test("authenticatedActor propagates claim failures without masking them", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport({
    claimSetup: async () => {
      throw new Error("POST /setup -> 400: invalid setup token");
    },
  });
  await assert.rejects(() => authenticatedActor(world, "owner", {}, transport), /invalid setup token/);
});
