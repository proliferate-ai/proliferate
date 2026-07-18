import assert from "node:assert/strict";
import test from "node:test";
import type { BootedStack } from "./boot.ts";
import { claimOwnedInstance } from "./claim.ts";
import { createOwnedEphemeralProfile } from "./ephemeral-profile.ts";

const ownedProfile = createOwnedEphemeralProfile({
  namespace: "t2e2bgate",
  runId: "unit-run",
  runAttempt: 1,
  workerIndex: 0,
  retry: 0,
  roots: {
    profileRoot: "/state/profiles",
    runtimeRoot: "/state/runtimes",
    tempRoot: "/state/tmp",
  },
});

const stack: BootedStack = {
  profile: ownedProfile.profile,
  apiBaseUrl: "http://intent.test",
  webBaseUrl: "http://web.test",
  anyharnessBaseUrl: "http://runtime.test",
  databaseUrl: "postgresql://intent",
  setupTokenFile: ownedProfile.setupTokenFile,
  teardown: async () => {},
};

function response(status: number, body = ""): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

test("claim waits for durable closure then logs in exactly once", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const setupGets = [200, 200, 404];
  let tokenReads = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    calls.push({ path: url.pathname, method });
    if (url.pathname === "/setup" && method === "GET") {
      return response(setupGets.shift() ?? 500);
    }
    if (url.pathname === "/setup" && method === "POST") {
      assert.match(String(init?.body), /setup_token=owned-token/);
      return response(200, "claimed");
    }
    if (url.pathname === "/auth/desktop/password/login") {
      return response(200, JSON.stringify({ access_token: "owner-access" }));
    }
    return response(500);
  }) as typeof fetch;

  const accessToken = await claimOwnedInstance({
    stack,
    ownedProfile,
    email: "owner@example.com",
    password: "password",
    organizationName: "Owned Org",
    fetchImpl,
    readToken: (tokenFile) => {
      tokenReads += 1;
      assert.equal(tokenFile, ownedProfile.setupTokenFile);
      return "owned-token";
    },
    visibilityIntervalMs: 0,
    delay: async () => {},
  });

  assert.equal(accessToken, "owner-access");
  assert.equal(tokenReads, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/password/login")).length, 1);
  assert.deepEqual(setupGets, []);
});

test("a failed login remains red and is never retried", async () => {
  let loginCalls = 0;
  let setupGets = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/setup" && (init?.method ?? "GET") === "GET") {
      setupGets += 1;
      return response(setupGets === 1 ? 200 : 404);
    }
    if (url.pathname === "/setup") {
      return response(200);
    }
    loginCalls += 1;
    return response(401, JSON.stringify({ detail: "invalid" }));
  }) as typeof fetch;

  await assert.rejects(
    claimOwnedInstance({
      stack,
      ownedProfile,
      email: "owner@example.com",
      password: "password",
      organizationName: "Owned Org",
      fetchImpl,
      readToken: () => "owned-token",
      visibilityIntervalMs: 0,
    }),
    /login failed.*not retried/,
  );
  assert.equal(loginCalls, 1);
});

test("missing token custody fails before claim or login", async () => {
  const methods: string[] = [];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return response(200);
  }) as typeof fetch;

  await assert.rejects(
    claimOwnedInstance({
      stack,
      ownedProfile,
      email: "owner@example.com",
      password: "password",
      organizationName: "Owned Org",
      fetchImpl,
      readToken: () => {
        throw new Error("ENOENT");
      },
    }),
    /custody/,
  );
  assert.deepEqual(methods, ["GET"]);
});

test("an already-claimed profile fails without reading a token", async () => {
  let tokenReads = 0;
  const fetchImpl = (async () => response(404)) as typeof fetch;
  await assert.rejects(
    claimOwnedInstance({
      stack,
      ownedProfile,
      email: "owner@example.com",
      password: "password",
      organizationName: "Owned Org",
      fetchImpl,
      readToken: () => {
        tokenReads += 1;
        return "unexpected";
      },
    }),
    /not fresh/,
  );
  assert.equal(tokenReads, 0);
});
