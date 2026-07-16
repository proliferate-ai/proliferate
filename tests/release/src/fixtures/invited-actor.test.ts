import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthenticatedActor } from "./authenticated-actor.js";
import { ApiClient } from "./http.js";
import { invitedActor, type InvitedActorTransport } from "./invited-actor.js";
import type { ActorKeyIdentity } from "../services/qualification-litellm.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";

function fakeWorld(): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: {
      run_id: "cloud-run-1",
      shard_id: "cloud-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    artifacts: {} as never,
    api: { baseUrl: "http://127.0.0.1:9001", client: new ApiClient({ baseUrl: "http://127.0.0.1:9001" }) },
    runtime: { baseUrl: "http://127.0.0.1:9002", client: undefined as never },
    renderer: { baseUrl: "http://127.0.0.1:9003", browser: undefined as never },
    gateway: {
      resolveActorKey: async ({ userId, enrollmentId }: { userId: string; enrollmentId: string }) =>
        ({
          userId,
          enrollmentId,
          teamId: "team-b",
          litellmUserId: "litellm-user-b",
          keyAlias: `vk-user-${userId}`,
          tokenId: "token-b",
          tokenIdHash: "hash-b",
        }) satisfies ActorKeyIdentity,
    } as unknown as ReadyLocalWorld["gateway"],
    paths: { runDir: "/tmp/run-1", runtimeHome: "/tmp/run-1/runtime-home", repositoriesDir: "/tmp/run-1/repositories" },
    close: async () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeInviter(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "user-a",
    organizationId: "org-1",
    enrollmentId: "enrollment-a",
    api: new ApiClient({ baseUrl: "http://127.0.0.1:9001", bearerToken: "actor-a-token" }),
    session: {
      access_token: "actor-a-token",
      refresh_token: "refresh-a",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user_id: "user-a",
      email: "a@example.com",
      display_name: null,
    },
    gatewayKey: {
      userId: "user-a",
      enrollmentId: "enrollment-a",
      teamId: "team-a",
      litellmUserId: "litellm-user-a",
      keyAlias: "vk-user-a",
      tokenId: "token-a",
      tokenIdHash: "hash-a",
    },
  };
}

function fakeTransport(overrides: Partial<InvitedActorTransport> = {}): {
  transport: InvitedActorTransport;
  calls: string[];
} {
  const calls: string[] = [];
  let enrollmentCalls = 0;
  const transport: InvitedActorTransport = {
    createInvitation: async (_adminApi, organizationId, email) => {
      calls.push(`createInvitation:${organizationId}:${email}`);
      return { id: "invitation-1", email, status: "pending" };
    },
    registerInvited: async (_apiBaseUrl, params) => {
      calls.push(`registerInvited:${params.email}:${params.invitationToken}`);
    },
    loginWithPassword: async (_apiBaseUrl, email) => {
      calls.push(`loginWithPassword:${email}`);
      return {
        access_token: "actor-b-token",
        refresh_token: "refresh-b",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: "user-b", email, display_name: null, github_login: null, avatar_url: null },
      };
    },
    listOrganizations: async () => {
      calls.push("listOrganizations");
      return { organizations: [{ id: "org-1" }] };
    },
    getEnrollment: async () => {
      enrollmentCalls += 1;
      calls.push(`getEnrollment:${enrollmentCalls}`);
      return {
        id: "enrollment-b",
        syncStatus: enrollmentCalls < 2 ? "pending" : "synced",
        lastErrorCode: null,
      };
    },
    putGatewaySelection: async (_api, harnessKind, surface) => {
      calls.push(`putGatewaySelection:${harnessKind}:${surface}`);
    },
    ...overrides,
  };
  return { transport, calls };
}

test("invitedActor drives invite -> register -> login -> enrollment poll -> cloud gateway selection, in order", async () => {
  const { transport, calls } = fakeTransport();
  const actor = await invitedActor(
    fakeWorld(),
    { inviter: fakeInviter(), email: "actor-b@example.com", enrollmentPollMs: 1 },
    transport,
  );

  assert.equal(actor.role, "member");
  assert.equal(actor.userId, "user-b");
  assert.equal(actor.organizationId, "org-1");
  assert.equal(actor.enrollmentId, "enrollment-b");
  assert.equal(actor.session.access_token, "actor-b-token");
  assert.equal(actor.gatewayKey.keyAlias, "vk-user-user-b");

  // The register token IS the invitation id; the surface defaults to cloud.
  assert.deepEqual(calls, [
    "createInvitation:org-1:actor-b@example.com",
    "registerInvited:actor-b@example.com:invitation-1",
    "loginWithPassword:actor-b@example.com",
    "listOrganizations",
    "getEnrollment:1",
    "getEnrollment:2",
    "putGatewaySelection:claude:cloud",
  ]);
});

test("invitedActor does not reuse the one-time /setup claim (never calls claimSetup/readSetupToken)", async () => {
  const { transport, calls } = fakeTransport();
  await invitedActor(fakeWorld(), { inviter: fakeInviter(), enrollmentPollMs: 1 }, transport);
  assert.ok(!calls.some((c) => c.startsWith("claimSetup")));
  assert.ok(!calls.some((c) => c.startsWith("readSetupToken")));
  // It DID register against an invitation — the real supported second-user seam.
  assert.ok(calls.some((c) => c.startsWith("registerInvited")));
});

test("invitedActor propagates a bounded timeout when enrollment never syncs", async () => {
  const { transport } = fakeTransport({
    getEnrollment: async () => ({ id: "enrollment-b", syncStatus: "pending", lastErrorCode: "gateway_unreachable" }),
  });
  await assert.rejects(
    () =>
      invitedActor(
        fakeWorld(),
        { inviter: fakeInviter(), enrollmentTimeoutMs: 5, enrollmentPollMs: 1 },
        transport,
      ),
    /did not reach "synced"/,
  );
});

test("invitedActor skips the gateway-selection PUT when selectGatewayRoute is false", async () => {
  const { transport, calls } = fakeTransport();
  await invitedActor(
    fakeWorld(),
    { inviter: fakeInviter(), selectGatewayRoute: false, enrollmentPollMs: 1 },
    transport,
  );
  assert.ok(!calls.some((c) => c.startsWith("putGatewaySelection")));
});

test("invitedActor propagates a registration failure without masking it", async () => {
  const { transport } = fakeTransport({
    registerInvited: async () => {
      throw new Error("POST /auth/password/register -> 403: not invited");
    },
  });
  await assert.rejects(
    () => invitedActor(fakeWorld(), { inviter: fakeInviter(), enrollmentPollMs: 1 }, transport),
    /not invited/,
  );
});
