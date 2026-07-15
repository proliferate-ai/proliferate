import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claimSelfHostOwner,
  assertSecondClaimRejected,
  defaultSelfHostActorTransport,
  inviteAndRegisterMember,
  isNotFoundError,
  type SelfHostActorTransport,
} from "./selfhost-actor.js";
import { ApiClient, ApiRequestError } from "./http.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";

function fakeWorld(): ReadySelfHostWorld {
  const baseUrl = "https://run-abc.qualification.proliferate.com";
  return {
    kind: "selfhost",
    run: {
      run_id: "sh-run-1",
      shard_id: "sh-0",
      attempt: 1,
      source_sha: "a".repeat(40),
      origin: { kind: "local", github_run_id: null, github_job: null },
    },
    artifacts: undefined as never,
    api: { baseUrl, client: new ApiClient({ baseUrl }) },
    runtime: { baseUrl: "http://127.0.0.1:9102", client: undefined as never },
    renderer: { baseUrl: "http://127.0.0.1:9103", browser: undefined as never },
    control: {
      box: undefined as never,
      ssh: undefined as never,
      readSetupToken: async () => "the-setup-token",
      restartStack: async () => undefined,
      assertRunningImageDigest: async () => "sha256:deadbeef",
    },
    paths: { runDir: "/tmp/sh-run-1", runtimeHome: "/tmp/sh-run-1/home", artifactsDir: "/tmp/sh-run-1/art", keyPath: "/tmp/sh-run-1/key.pem" },
    close: async () => {
      throw new Error("not used in this test");
    },
  } as unknown as ReadySelfHostWorld;
}

function fakeTransport(overrides: Partial<SelfHostActorTransport> = {}): {
  transport: SelfHostActorTransport;
  calls: string[];
} {
  const calls: string[] = [];
  const transport: SelfHostActorTransport = {
    readSetupToken: async () => {
      calls.push("readSetupToken");
      return "the-setup-token";
    },
    claimSetup: async (params) => {
      calls.push(`claimSetup:${params.email}:${params.organizationName}:${params.setupToken}`);
    },
    loginWithPassword: async (_apiBaseUrl, email) => {
      calls.push(`login:${email}`);
      return {
        access_token: `access-${email}`,
        refresh_token: "refresh-1",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: `user-${email}`, email, display_name: null, github_login: null, avatar_url: null },
      };
    },
    listOrganizations: async () => {
      calls.push("listOrganizations");
      return { organizations: [{ id: "org-1", membership: { status: "active", role: "owner" } }] };
    },
    invite: async (_api, orgId, email) => {
      calls.push(`invite:${orgId}:${email}`);
      return { id: "invitation-1", status: "pending" };
    },
    register: async (_apiBaseUrl, params) => {
      calls.push(`register:${params.email}:${params.invitationToken}`);
    },
    getSetupStatus: async () => {
      calls.push("getSetupStatus");
      return 404;
    },
    ...overrides,
  };
  return { transport, calls };
}

test("claimSelfHostOwner reads the setup token over SSH, claims, logs in, and resolves the single owner org", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport();

  const owner = await claimSelfHostOwner(world, {}, transport);

  assert.equal(owner.role, "owner");
  assert.equal(owner.organizationId, "org-1");
  assert.equal(owner.userId, "user-qual-owner-sh-run-1-sh-0@example.com");
  assert.equal(owner.session.access_token, "access-qual-owner-sh-run-1-sh-0@example.com");
  assert.deepEqual(calls, [
    "readSetupToken",
    "claimSetup:qual-owner-sh-run-1-sh-0@example.com:selfhost-install-sh-run-1:the-setup-token",
    "login:qual-owner-sh-run-1-sh-0@example.com",
    "listOrganizations",
  ]);
});

test("claimSelfHostOwner never persists the setup token or the generated password on the returned actor", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  const owner = await claimSelfHostOwner(world, {}, transport);
  const serialized = JSON.stringify(owner);
  assert.equal(serialized.includes("the-setup-token"), false);
  assert.equal("password" in (owner as unknown as Record<string, unknown>), false);
  // The api client keeps the bearer private (not serialized), so no token leaks.
  assert.equal(serialized.includes(owner.session.access_token), true);
});

test("claimSelfHostOwner rejects when the claimed owner does not belong to exactly one org", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport({
    listOrganizations: async () => ({ organizations: [{ id: "org-1" }, { id: "org-2" }] }),
  });
  await assert.rejects(() => claimSelfHostOwner(world, {}, transport), /exactly one org/);
});

test("claimSelfHostOwner rejects when membership is not owner/active", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport({
    listOrganizations: async () => ({ organizations: [{ id: "org-1", membership: { status: "active", role: "member" } }] }),
  });
  await assert.rejects(() => claimSelfHostOwner(world, {}, transport), /not the org owner/);
});

test("claimSelfHostOwner rejects an empty setup token", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport({ readSetupToken: async () => "   " });
  await assert.rejects(() => claimSelfHostOwner(world, {}, transport), /empty setup token/);
});

test("assertSecondClaimRejected passes on a 404 /setup and fails on any other status", async () => {
  const world = fakeWorld();
  const { transport } = fakeTransport();
  await assert.doesNotReject(() => assertSecondClaimRejected(world, transport));

  const { transport: open } = fakeTransport({ getSetupStatus: async () => 200 });
  await assert.rejects(() => assertSecondClaimRejected(world, open), /permanently closed \(404\)/);
});

test("inviteAndRegisterMember invites, registers with the invitation id as token, logs in, and returns the member", async () => {
  const world = fakeWorld();
  const { transport, calls } = fakeTransport({
    // The invitee's org lookup must resolve to the owner org.
    listOrganizations: async () => ({ organizations: [{ id: "org-1", membership: { status: "active", role: "member" } }] }),
  });
  const owner = {
    role: "owner" as const,
    userId: "user-owner",
    organizationId: "org-1",
    api: new ApiClient({ baseUrl: world.api.baseUrl }),
    session: {
      access_token: "owner-access",
      refresh_token: "r",
      expires_at: new Date().toISOString(),
      user_id: "user-owner",
      email: "owner@example.com",
      display_name: null,
    },
  };

  const invitee = await inviteAndRegisterMember(world, owner, {}, transport);

  assert.equal(invitee.role, "member");
  assert.equal(invitee.organizationId, "org-1");
  assert.equal(invitee.invitationId, "invitation-1");
  assert.equal(invitee.email, "qual-invitee-sh-run-1-sh-0@example.com");
  assert.ok(calls.includes("invite:org-1:qual-invitee-sh-run-1-sh-0@example.com"));
  assert.ok(calls.includes("register:qual-invitee-sh-run-1-sh-0@example.com:invitation-1"));
});

test("inviteAndRegisterMember rejects a non-pending invitation and a wrong-org join", async () => {
  const world = fakeWorld();
  const owner = {
    role: "owner" as const,
    userId: "user-owner",
    organizationId: "org-1",
    api: new ApiClient({ baseUrl: world.api.baseUrl }),
    session: {
      access_token: "owner-access",
      refresh_token: "r",
      expires_at: new Date().toISOString(),
      user_id: "user-owner",
      email: "owner@example.com",
      display_name: null,
    },
  };

  const { transport: notPending } = fakeTransport({ invite: async () => ({ id: "i-1", status: "revoked" }) });
  await assert.rejects(() => inviteAndRegisterMember(world, owner, {}, notPending), /should be pending/);

  const { transport: wrongOrg } = fakeTransport({
    listOrganizations: async () => ({ organizations: [{ id: "org-99" }] }),
  });
  await assert.rejects(() => inviteAndRegisterMember(world, owner, {}, wrongOrg), /wrong organization/);
});

test("isNotFoundError distinguishes a 404 ApiRequestError", () => {
  assert.equal(isNotFoundError(new ApiRequestError("GET", "/setup", 404, "nope")), true);
  assert.equal(isNotFoundError(new ApiRequestError("GET", "/setup", 500, "boom")), false);
  assert.equal(isNotFoundError(new Error("other")), false);
});

/**
 * SHR-F02: the setup-claim and password-login error paths must NOT copy the raw
 * HTTP response body into the thrown error — a validation response can echo the
 * request-local setup token / password, which are not in the aggregate
 * sanitizer's known-secret set. Plant those secrets in a rejecting response body
 * and assert the thrown error carries only the status, never the secret.
 */
const PLANTED_SETUP_TOKEN = "SETUP-TOKEN-PLANTED-2f8c1a";
const PLANTED_PASSWORD = "PASSWORD-PLANTED-9d4e7b";

async function withStubbedFetch(
  response: () => Response,
  body: () => Promise<unknown>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response()) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

test("claimSetup keeps the setup token/password out of the thrown error (SHR-F02)", async () => {
  await withStubbedFetch(
    () =>
      new Response(`validation error: setup_token=${PLANTED_SETUP_TOKEN} password=${PLANTED_PASSWORD}`, {
        status: 400,
      }),
    () =>
      assert.rejects(
        defaultSelfHostActorTransport.claimSetup({
          apiBaseUrl: "https://box.example.com",
          email: "owner@example.com",
          password: PLANTED_PASSWORD,
          setupToken: PLANTED_SETUP_TOKEN,
          organizationName: "org",
        }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.ok(!message.includes(PLANTED_SETUP_TOKEN), `error leaked the setup token: ${message}`);
          assert.ok(!message.includes(PLANTED_PASSWORD), `error leaked the password: ${message}`);
          assert.match(message, /400/);
          return true;
        },
      ),
  );
});

test("loginWithPassword keeps the password out of the thrown error (SHR-F02)", async () => {
  await withStubbedFetch(
    () => new Response(`unauthorized: password=${PLANTED_PASSWORD}`, { status: 401 }),
    () =>
      assert.rejects(
        defaultSelfHostActorTransport.loginWithPassword("https://box.example.com", "owner@example.com", PLANTED_PASSWORD),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.ok(!message.includes(PLANTED_PASSWORD), `error leaked the password: ${message}`);
          assert.match(message, /401/);
          return true;
        },
      ),
  );
});
