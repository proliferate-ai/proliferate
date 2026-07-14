import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";

import { BROWSER_AUTH_SESSION_KEY, productPage, type ProductPageDriver } from "./product-page.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import type { AuthenticatedActor } from "./authenticated-actor.js";

function fakeWorld(browser: Browser): ReadyLocalWorld {
  return {
    kind: "local-workspace",
    run: undefined as never,
    artifacts: undefined as never,
    api: undefined as never,
    runtime: undefined as never,
    renderer: { baseUrl: "http://127.0.0.1:9003", browser },
    gateway: undefined as never,
    paths: undefined as never,
    close: async () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeActor(): AuthenticatedActor {
  return {
    role: "owner",
    userId: "user-1",
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    api: undefined as never,
    session: {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: "2030-01-01T00:00:00.000Z",
      user_id: "user-1",
      email: "owner@example.com",
      display_name: "Owner",
    },
    gatewayKey: undefined as never,
  };
}

function fakeDriver(): { driver: ProductPageDriver; calls: string[] } {
  const calls: string[] = [];
  const fakeContext = {} as BrowserContext;
  const fakePage = {} as Page;
  const driver: ProductPageDriver = {
    newContext: async (browser) => {
      calls.push(`newContext:${browser === (undefined as never) ? "none" : "browser"}`);
      return fakeContext;
    },
    installSession: async (context, session) => {
      calls.push(`installSession:${context === fakeContext}:${session.user_id}`);
    },
    newPage: async (context) => {
      calls.push(`newPage:${context === fakeContext}`);
      return fakePage;
    },
    goto: async (page, url) => {
      calls.push(`goto:${page === fakePage}:${url}`);
    },
    waitForAuthenticatedReadiness: async (page, timeoutMs) => {
      calls.push(`waitForAuthenticatedReadiness:${page === fakePage}:${timeoutMs}`);
    },
    closePage: async (page) => {
      calls.push(`closePage:${page === fakePage}`);
    },
    closeContext: async (context) => {
      calls.push(`closeContext:${context === fakeContext}`);
    },
  };
  return { driver, calls };
}

test("productPage installs the auth session before navigation, then navigates and waits for readiness, in order", async () => {
  const world = fakeWorld({} as Browser);
  const { driver, calls } = fakeDriver();

  const result = await productPage(world, fakeActor(), {}, driver);

  assert.equal(calls[0], "newContext:browser");
  assert.equal(calls[1], "installSession:true:user-1");
  assert.equal(calls[2], "newPage:true");
  assert.equal(calls[3], "goto:true:http://127.0.0.1:9003");
  assert.equal(calls[4], "waitForAuthenticatedReadiness:true:30000");
  assert.equal(calls.length, 5);

  await result.close();
  assert.equal(calls[5], "closePage:true");
  assert.equal(calls[6], "closeContext:true");
});

test("productPage honors a custom readinessTimeoutMs", async () => {
  const world = fakeWorld({} as Browser);
  const { driver, calls } = fakeDriver();
  await productPage(world, fakeActor(), { readinessTimeoutMs: 5000 }, driver);
  assert.ok(calls.includes("waitForAuthenticatedReadiness:true:5000"));
});

test("productPage closes the page and context if readiness never arrives, then rethrows", async () => {
  const world = fakeWorld({} as Browser);
  const { driver, calls } = fakeDriver();
  driver.waitForAuthenticatedReadiness = async () => {
    throw new Error("timed out waiting for authenticated readiness");
  };

  await assert.rejects(() => productPage(world, fakeActor(), {}, driver), /timed out waiting/);
  assert.ok(calls.includes("closePage:true"));
  assert.ok(calls.includes("closeContext:true"));
});

test("productPage closes only the context if page creation itself fails", async () => {
  const world = fakeWorld({} as Browser);
  const { driver, calls } = fakeDriver();
  driver.newPage = async () => {
    throw new Error("newPage failed");
  };

  await assert.rejects(() => productPage(world, fakeActor(), {}, driver), /newPage failed/);
  assert.ok(!calls.some((call) => call.startsWith("closePage")));
  assert.ok(calls.includes("closeContext:true"));
});

test("BROWSER_AUTH_SESSION_KEY matches the real desktop client's localStorage key", () => {
  assert.equal(BROWSER_AUTH_SESSION_KEY, "proliferate.auth.session");
});
