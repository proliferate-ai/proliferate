import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_BYOK_ENV_VAR,
  preflightByokKey,
  storeAndSelectByokKey,
  waitForDesktopByokSync,
  type ByokStoreTransport,
  type ByokPreflightProbe,
} from "./byok.js";
import { ApiClient } from "./http.js";
import type { SelfHostOwnerActor } from "./selfhost-actor.js";
import type { ReadySelfHostWorld } from "../worlds/selfhost/world.js";
import type { ProductPage } from "./product-page.js";

function fakeOwner(): SelfHostOwnerActor {
  return {
    role: "owner",
    userId: "user-owner",
    organizationId: "org-1",
    api: new ApiClient({ baseUrl: "https://run-abc.qualification.proliferate.com" }),
    session: {
      access_token: "owner-access",
      refresh_token: "r",
      expires_at: new Date().toISOString(),
      user_id: "user-owner",
      email: "owner@example.com",
      display_name: null,
    },
  };
}

test("preflightByokKey returns ok on a 200 provider response", async () => {
  const probe: ByokPreflightProbe = { checkKey: async () => ({ status: 200 }) };
  const result = await preflightByokKey("sk-real-key", {}, probe);
  assert.deepEqual(result, { ok: true });
});

test("preflightByokKey fails CLOSED on a 401 with a bounded, secret-free reason", async () => {
  let seenKey = "";
  const probe: ByokPreflightProbe = {
    checkKey: async (rawKey) => {
      seenKey = rawKey;
      return { status: 401 };
    },
  };
  const result = await preflightByokKey("sk-placeholder-401", {}, probe);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "provider returned 401 on /models");
  // The reason never echoes the key back.
  assert.equal(result.reason?.includes(seenKey), false);
});

test("preflightByokKey fails closed on an empty key without calling the provider", async () => {
  let called = false;
  const probe: ByokPreflightProbe = {
    checkKey: async () => {
      called = true;
      return { status: 200 };
    },
  };
  const result = await preflightByokKey("   ", {}, probe);
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("preflightByokKey fails closed (never throws the key) when the provider call itself errors", async () => {
  const probe: ByokPreflightProbe = {
    checkKey: async () => {
      throw new Error("network down");
    },
  };
  const result = await preflightByokKey("sk-real-key", {}, probe);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /provider preflight call failed/);
});

test("storeAndSelectByokKey posts the raw key then PUTs the exact api_key selection wire shape", async () => {
  const owner = fakeOwner();
  const captured: { keyBody?: unknown; harness?: string; selectionBody?: unknown } = {};
  const transport: ByokStoreTransport = {
    createKey: async (_api, body) => {
      captured.keyBody = body;
      return { id: "key-uuid-1" };
    },
    putSelection: async (_api, harnessKind, body) => {
      captured.harness = harnessKind;
      captured.selectionBody = body;
    },
  };

  const selection = await storeAndSelectByokKey(owner, { rawKey: "sk-real-key", harnessKind: "claude" }, transport);

  assert.deepEqual(selection, { apiKeyId: "key-uuid-1", harnessKind: "claude", envVarName: DEFAULT_BYOK_ENV_VAR });
  assert.deepEqual(captured.keyBody, { title: "selfhost-byok-claude", value: "sk-real-key" });
  assert.equal(captured.harness, "claude");
  assert.deepEqual(captured.selectionBody, {
    sources: [{ sourceKind: "api_key", apiKeyId: "key-uuid-1", envVarName: "ANTHROPIC_API_KEY", enabled: true }],
  });
});

test("storeAndSelectByokKey honors a custom envVarName and title", async () => {
  const owner = fakeOwner();
  let selectionBody: unknown;
  const transport: ByokStoreTransport = {
    createKey: async () => ({ id: "key-2" }),
    putSelection: async (_api, _harness, body) => {
      selectionBody = body;
    },
  };
  const selection = await storeAndSelectByokKey(
    owner,
    { rawKey: "sk-x", harnessKind: "codex", envVarName: "OPENAI_API_KEY", title: "my-key" },
    transport,
  );
  assert.equal(selection.envVarName, "OPENAI_API_KEY");
  assert.deepEqual(selectionBody, {
    sources: [{ sourceKind: "api_key", apiKeyId: "key-2", envVarName: "OPENAI_API_KEY", enabled: true }],
  });
});

test("storeAndSelectByokKey throws when the key store returns no id", async () => {
  const owner = fakeOwner();
  const transport: ByokStoreTransport = {
    createKey: async () => ({ id: "" }),
    putSelection: async () => undefined,
  };
  await assert.rejects(
    () => storeAndSelectByokKey(owner, { rawKey: "sk-x", harnessKind: "claude" }, transport),
    /no key id/,
  );
});

test("waitForDesktopByokSync resolves once the harness becomes launchable in the runtime", async () => {
  const world = {} as ReadySelfHostWorld;
  const page = {} as ProductPage;
  let poll = 0;
  await waitForDesktopByokSync(
    world,
    page,
    { apiKeyId: "k", harnessKind: "claude", envVarName: "ANTHROPIC_API_KEY" },
    {
      timeoutMs: 1000,
      pollMs: 1,
      readLaunchOptions: async () => {
        poll += 1;
        // Not launchable until the third poll (Desktop finishes pushing state).
        return poll < 3 ? [{ kind: "claude", models: [] }] : [{ kind: "claude", models: [{ id: "claude-x" }] }];
      },
    },
  );
  assert.ok(poll >= 3);
});

test("waitForDesktopByokSync fails CLOSED (never a false green) when Desktop never pushes the source", async () => {
  const world = {} as ReadySelfHostWorld;
  const page = {} as ProductPage;
  await assert.rejects(
    () =>
      waitForDesktopByokSync(
        world,
        page,
        { apiKeyId: "k", harnessKind: "claude", envVarName: "ANTHROPIC_API_KEY" },
        { timeoutMs: 10, pollMs: 1, readLaunchOptions: async () => [{ kind: "claude", models: [] }] },
      ),
    /did not push the api_key source/,
  );
});
