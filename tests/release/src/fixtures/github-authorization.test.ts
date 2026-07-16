import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GithubAuthorizationController,
  GithubAuthorizationDeniedError,
  extractStateFromAuthorizeUrl,
  githubAuthorization,
  parseRedirectCallback,
  resolveGithubAuthorizationMode,
  type GithubAuthorizationMode,
  type GithubAuthorizationTransport,
} from "./github-authorization.js";
import { ScenarioBlockedError } from "../scenarios/types.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

const world = {} as ManagedCloudWorld;
const actor = {} as AuthenticatedActor;

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=st_123&redirect_uri=x";

interface FakeConfig {
  mode?: GithubAuthorizationMode;
  authorizeUrl?: string;
  state?: string;
  complete?: () => Promise<{ authorizationCode: string }>;
}

function fakeTransport(config: FakeConfig = {}): { transport: GithubAuthorizationTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: GithubAuthorizationTransport = {
    resolveMode() {
      calls.push("resolveMode");
      return config.mode ?? "manual_assist";
    },
    async startAuthorization() {
      calls.push("startAuthorization");
      return { authorizeUrl: config.authorizeUrl ?? AUTHORIZE_URL, state: config.state ?? "st_123" };
    },
    async completeHumanBoundary() {
      calls.push("completeHumanBoundary");
      return config.complete ? config.complete() : { authorizationCode: "code_abc" };
    },
  };
  return { transport, calls };
}

// --- resolveGithubAuthorizationMode -----------------------------------------

test("resolveGithubAuthorizationMode returns automated when the D2 bot seed is present", () => {
  assert.equal(resolveGithubAuthorizationMode({ RELEASE_E2E_CLOUD_GITHUB_BOT_SEED: "seed" }), "automated");
  // seed presence wins over the Actions origin
  assert.equal(
    resolveGithubAuthorizationMode({ RELEASE_E2E_CLOUD_GITHUB_BOT_SEED: "seed", GITHUB_ACTIONS: "true" }),
    "automated",
  );
});

test("resolveGithubAuthorizationMode is blocked_honest in Actions without the seed, manual_assist locally", () => {
  assert.equal(resolveGithubAuthorizationMode({ GITHUB_ACTIONS: "true" }), "blocked_honest");
  assert.equal(resolveGithubAuthorizationMode({}), "manual_assist");
  // whitespace-only seed is treated as unset
  assert.equal(
    resolveGithubAuthorizationMode({ RELEASE_E2E_CLOUD_GITHUB_BOT_SEED: "   ", GITHUB_ACTIONS: "true" }),
    "blocked_honest",
  );
});

// --- extractStateFromAuthorizeUrl -------------------------------------------

test("extractStateFromAuthorizeUrl returns the product-minted state", () => {
  assert.equal(extractStateFromAuthorizeUrl(AUTHORIZE_URL), "st_123");
});

test("extractStateFromAuthorizeUrl throws on a missing state or malformed URL", () => {
  assert.throws(
    () => extractStateFromAuthorizeUrl("https://github.com/login/oauth/authorize?client_id=x"),
    /no "state"/,
  );
  assert.throws(() => extractStateFromAuthorizeUrl("not a url"), /could not parse/);
});

// --- parseRedirectCallback --------------------------------------------------

test("parseRedirectCallback extracts the code from a matching full callback URL", () => {
  const { authorizationCode } = parseRedirectCallback(
    "https://run.qualification.proliferate.com/auth/github-app/user-authorization/callback?code=cd_1&state=st_123",
    "st_123",
  );
  assert.equal(authorizationCode, "cd_1");
});

test("parseRedirectCallback accepts a bare query fragment and a bare code", () => {
  assert.equal(parseRedirectCallback("?code=cd_2&state=st_123", "st_123").authorizationCode, "cd_2");
  assert.equal(parseRedirectCallback("cd_bare", "st_123").authorizationCode, "cd_bare");
});

test("parseRedirectCallback throws denial on access_denied", () => {
  assert.throws(
    () => parseRedirectCallback("https://x/callback?error=access_denied&error_description=The+user+declined", "st_123"),
    (error: unknown) => error instanceof GithubAuthorizationDeniedError && /access_denied/.test((error as Error).message),
  );
});

test("parseRedirectCallback throws denial on a missing code", () => {
  assert.throws(
    () => parseRedirectCallback("https://x/callback?state=st_123", "st_123"),
    (error: unknown) => error instanceof GithubAuthorizationDeniedError && /no authorization code/.test((error as Error).message),
  );
});

test("parseRedirectCallback throws denial on a state mismatch (wrong flow captured)", () => {
  assert.throws(
    () => parseRedirectCallback("https://x/callback?code=cd_3&state=other", "st_123"),
    (error: unknown) => error instanceof GithubAuthorizationDeniedError && /did not match/.test((error as Error).message),
  );
});

test("parseRedirectCallback throws denial on empty input", () => {
  assert.throws(() => parseRedirectCallback("   ", "st_123"), GithubAuthorizationDeniedError);
});

// --- githubAuthorization orchestration --------------------------------------

test("githubAuthorization clears the human boundary and returns the code+state", async () => {
  const { transport, calls } = fakeTransport();
  const boundary = await githubAuthorization(world, actor, {}, transport);
  assert.deepEqual(boundary, { mode: "manual_assist", authorizationCode: "code_abc", state: "st_123" });
  assert.deepEqual(calls, ["resolveMode", "startAuthorization", "completeHumanBoundary"]);
});

test("githubAuthorization honours an explicit mode override without calling resolveMode", async () => {
  const { transport, calls } = fakeTransport();
  const boundary = await githubAuthorization(world, actor, { mode: "manual_assist" }, transport);
  assert.equal(boundary.mode, "manual_assist");
  assert.ok(!calls.includes("resolveMode"));
});

test("githubAuthorization reports blocked honestly and never starts the flow", async () => {
  const { transport, calls } = fakeTransport({ mode: "blocked_honest" });
  await assert.rejects(() => githubAuthorization(world, actor, {}, transport), ScenarioBlockedError);
  assert.ok(!calls.includes("startAuthorization"), "blocked_honest must not start the real authorization");
});

test("githubAuthorization propagates a denial from the human boundary", async () => {
  const { transport } = fakeTransport({
    complete: async () => {
      throw new GithubAuthorizationDeniedError("the user declined");
    },
  });
  await assert.rejects(() => githubAuthorization(world, actor, {}, transport), GithubAuthorizationDeniedError);
});

test("githubAuthorization rejects an empty authorization code as a denial", async () => {
  const { transport } = fakeTransport({ complete: async () => ({ authorizationCode: "" }) });
  await assert.rejects(() => githubAuthorization(world, actor, {}, transport), GithubAuthorizationDeniedError);
});

// --- single-flight convergence (spec step 3) --------------------------------

test("concurrent authorize() calls converge to ONE authorization", async () => {
  const { transport, calls } = fakeTransport();
  const controller = new GithubAuthorizationController(world, actor, {}, transport);
  const [a, b] = await Promise.all([controller.authorize(), controller.authorize()]);
  assert.equal(a, b, "concurrent callers must receive the very same boundary");
  assert.equal(calls.filter((c) => c === "startAuthorization").length, 1, "the flow must start exactly once");
  assert.equal(calls.filter((c) => c === "completeHumanBoundary").length, 1);
});

test("a replayed authorize() after settlement returns the cached authorization (no second start)", async () => {
  const { transport, calls } = fakeTransport();
  const controller = new GithubAuthorizationController(world, actor, {}, transport);
  const first = await controller.authorize();
  const second = await controller.authorize();
  assert.equal(first, second);
  assert.equal(calls.filter((c) => c === "startAuthorization").length, 1);
});

test("single-flight caches a blocked rejection so a replay converges on the same block", async () => {
  const { transport, calls } = fakeTransport({ mode: "blocked_honest" });
  const controller = new GithubAuthorizationController(world, actor, {}, transport);
  await assert.rejects(() => controller.authorize(), ScenarioBlockedError);
  await assert.rejects(() => controller.authorize(), ScenarioBlockedError);
  // resolveMode ran once; the flow never started on either call.
  assert.equal(calls.filter((c) => c === "resolveMode").length, 1);
  assert.ok(!calls.includes("startAuthorization"));
});
