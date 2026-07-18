import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  authenticatedActor,
  toStoredSession,
  evictClaimedOwner,
  __resetAuthenticatedActorClaimCacheForTests,
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
    db: { databaseUrl: "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5599/proliferate" },
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
    waitForSetupCommitted: async () => {
      calls.push("waitForSetupCommitted");
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
    putGatewaySelection: async (_api, harnessKind, surface) => {
      calls.push(`putGatewaySelection:${harnessKind}:${surface}`);
    },
    ...overrides,
  };
  return { transport, calls };
}

beforeEach(() => {
  // All fake worlds in this file share the same `runDir` ("/tmp/run-1"), so
  // the module-level per-world claim cache must be cleared between tests or
  // one test's cached owner would leak into the next.
  __resetAuthenticatedActorClaimCacheForTests();
});

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
    "claimSetup:qual-owner-local-run-1-local-0@example.com",
    "waitForSetupCommitted",
    "loginWithPassword:qual-owner-local-run-1-local-0@example.com",
    "listOrganizations",
    "getEnrollment:1",
    "getEnrollment:2",
    "putGatewaySelection:claude:local",
  ]);
});

test("authenticatedActor writes the gateway selection to the requested surface (cloud) when overridden", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();
  await authenticatedActor(world, "owner", { gatewaySurface: "cloud" }, transport);
  assert.ok(
    calls.includes("putGatewaySelection:claude:cloud"),
    "the managed-cloud scenario must select the gateway route on the cloud surface",
  );
});

test("authenticatedActor durably hands off synced enrollment custody before any later selection or caller action", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport({
    getEnrollment: async () => ({
      id: "enrollment-1",
      subjectKind: "user",
      litellmTeamId: "team-1",
      syncStatus: "synced",
      lastErrorCode: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  });
  const custody: Array<{ userId: string; enrollmentId: string }> = [];

  await assert.rejects(
    () => authenticatedActor(world, "owner", {
      resolveAndTrackActorSubjects: async (identity) => {
        custody.push(identity);
        throw new Error("simulated crash before scenario trackActorSubjects");
      },
    }, transport),
    /simulated crash before scenario trackActorSubjects/,
  );

  assert.deepEqual(custody, [{ userId: "user-1", enrollmentId: "enrollment-1" }]);
  assert.ok(!calls.some((call) => call.startsWith("putGatewaySelection")));
});

test("authenticatedActor persists enrollment intent before claim and binds before selection", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport({
    getEnrollment: async () => ({
      id: "enrollment-1", subjectKind: "user", litellmTeamId: "team-1",
      syncStatus: "synced", lastErrorCode: null,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }),
  });
  await authenticatedActor(world, "owner", {
    beginActorEnrollmentCustody: async ({ email }) => {
      calls.push(`beginCustody:${email}`);
      return {
        resolveAndTrack: async (identity) => {
          calls.push(`bindCustody:${identity.userId}:${identity.enrollmentId}`);
          return world.gateway.resolveActorKey(identity);
        },
      };
    },
  }, transport);
  assert.ok(calls.indexOf("beginCustody:qual-owner-local-run-1-local-0@example.com") < calls.findIndex((c) => c.startsWith("claimSetup:")));
  assert.ok(calls.indexOf("bindCustody:user-1:enrollment-1") < calls.findIndex((c) => c.startsWith("putGatewaySelection:")));
});

test("authenticatedActor does not duplicate enrollment custody for a cached owner claim", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();
  const custodyEmails: string[] = [];
  const options = {
    beginActorEnrollmentCustody: async ({ email }: { email: string }) => {
      custodyEmails.push(email);
      return { resolveAndTrack: world.gateway.resolveActorKey };
    },
  };

  await authenticatedActor(world, "owner", options, transport);
  await authenticatedActor(world, "owner", options, transport);

  assert.deepEqual(custodyEmails, ["qual-owner-local-run-1-local-0@example.com"]);
  assert.equal(calls.filter((call) => call.startsWith("claimSetup:")).length, 1);
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

test("authenticatedActor requires committed setup visibility before its single password-login attempt", async () => {
  const world = fakeWorld();
  let readinessChecked = false;
  const { transport, calls } = fakeTransport({
    waitForSetupCommitted: async () => {
      readinessChecked = true;
      throw new Error("setup claim did not become committed/visible");
    },
  });

  await assert.rejects(
    () => authenticatedActor(world, "owner", {}, transport),
    /did not become committed\/visible/,
  );
  assert.equal(readinessChecked, true);
  assert.ok(!calls.some((call) => call.startsWith("loginWithPassword")));
});

test("authenticatedActor preserves password-login 401 as red and never retries it", async () => {
  const world = fakeWorld();
  let loginAttempts = 0;
  const { transport } = fakeTransport({
    loginWithPassword: async () => {
      loginAttempts += 1;
      throw new Error("POST /auth/desktop/password/login -> 401: invalid credentials");
    },
  });

  await assert.rejects(
    () => authenticatedActor(world, "owner", {}, transport),
    /password\/login -> 401/,
  );
  assert.equal(loginAttempts, 1);
});

test("authenticatedActor claims setup once per world: a second call for the same world logs in with the cached owner instead of re-claiming", async () => {
  // Regression for run 29628880856: Tier-3 scenarios loop authenticatedActor
  // over multiple harness cells (claude, codex, grok, ...) against ONE
  // ReadyLocalWorld. The server's one-time first-run claim 404s any second
  // `POST /setup`, so the second+ cell must skip claimSetup entirely.
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  const first = await authenticatedActor(world, "owner", { harnessKind: "claude" }, transport);
  const second = await authenticatedActor(world, "owner", { harnessKind: "codex" }, transport);

  const claimCalls = calls.filter((call) => call.startsWith("claimSetup"));
  const commitWaits = calls.filter((call) => call === "waitForSetupCommitted");
  assert.equal(claimCalls.length, 1, "only the first cell may claim setup");
  assert.equal(commitWaits.length, 1, "only the first cell waits for the commit to become visible");

  const loginCalls = calls.filter((call) => call.startsWith("loginWithPassword"));
  assert.equal(loginCalls.length, 2, "every cell, including cached ones, must still log in");
  assert.equal(loginCalls[0], loginCalls[1], "the second cell logs in with the SAME cached owner credentials");

  assert.equal(first.userId, second.userId);
});

test("authenticatedActor does not cache a failed claim: a later call for the same world retries the claim honestly", async () => {
  const world = fakeWorld();
  let claimAttempts = 0;
  const { transport, calls } = fakeTransport({
    claimSetup: async (params) => {
      claimAttempts += 1;
      calls.push(`claimSetup:${params.email}`);
      if (claimAttempts === 1) {
        throw new Error("POST /setup -> 400: invalid setup token");
      }
    },
  });

  await assert.rejects(() => authenticatedActor(world, "owner", {}, transport), /invalid setup token/);
  assert.equal(claimAttempts, 1);

  // The failed claim must NOT be cached: the next call for the same world
  // retries claimSetup from scratch (and here, succeeds) rather than
  // replaying the stale rejection.
  const actor = await authenticatedActor(world, "owner", {}, transport);
  assert.equal(claimAttempts, 2);
  assert.equal(actor.role, "owner");
  assert.equal(calls.filter((call) => call.startsWith("claimSetup")).length, 2);
});

test("evictClaimedOwner: after eviction, a new actor for the same runDir claims again instead of logging in with stale credentials", async () => {
  // Regression for run 29631868610 (T3-AUTHROUTE-1, route=change 401): two
  // successive worlds sharing the same worldRoot/runDir must never share a
  // cached owner. Simulates world close (which evicts) followed by a fresh
  // world reusing the same runDir.
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  const first = await authenticatedActor(world, "owner", {}, transport);
  evictClaimedOwner(world.paths.runDir);

  const { transport: secondTransport, calls: secondCalls } = fakeTransport();
  const second = await authenticatedActor(world, "owner", {}, secondTransport);

  assert.equal(
    calls.filter((call) => call.startsWith("claimSetup")).length,
    1,
    "the first world claims once",
  );
  assert.equal(
    secondCalls.filter((call) => call.startsWith("claimSetup")).length,
    1,
    "after eviction, the next call for the same runDir claims again rather than reusing the stale cache",
  );
  assert.equal(first.role, "owner");
  assert.equal(second.role, "owner");
});

test("evictClaimedOwner: claim-once-per-world behavior still holds within one world's lifetime (no eviction call)", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  await authenticatedActor(world, "owner", { harnessKind: "claude" }, transport);
  await authenticatedActor(world, "owner", { harnessKind: "codex" }, transport);

  assert.equal(
    calls.filter((call) => call.startsWith("claimSetup")).length,
    1,
    "without eviction, the cache still serves the second call from the same world",
  );
});

test("evictClaimedOwner: evicting an unknown runDir is a harmless no-op", () => {
  assert.doesNotThrow(() => evictClaimedOwner("/tmp/never-cached"));
});

test("authenticatedActor: an explicit email opts out of the shared per-world claim cache and always claims directly", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  await authenticatedActor(world, "owner", { email: "explicit-1@example.com" }, transport);
  await authenticatedActor(world, "owner", { email: "explicit-2@example.com" }, transport);

  const claimCalls = calls.filter((call) => call.startsWith("claimSetup"));
  assert.deepEqual(claimCalls, ["claimSetup:explicit-1@example.com", "claimSetup:explicit-2@example.com"]);
});
