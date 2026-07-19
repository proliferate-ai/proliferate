import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiClient, ApiRequestError } from "./http.js";

/**
 * Installs a fake global `fetch` that replays a scripted sequence of outcomes
 * (either a Response-like object or a thrown transport error), returning the
 * count of calls so a test can assert how many attempts the client made.
 * Restores the original fetch on `dispose()`.
 */
function scriptFetch(outcomes: Array<{ status: number; body: string } | { throw: Error }>) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if ("throw" in outcome) {
      throw outcome.throw;
    }
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      text: async () => outcome.body,
    } as unknown as Response;
  }) as typeof fetch;
  return {
    get calls() {
      return calls;
    },
    dispose() {
      globalThis.fetch = originalFetch;
    },
  };
}

// retryDelayMs: 0 → the bounded backoff is instant, so these tests never sleep.
function client() {
  return new ApiClient({ baseUrl: "https://box.example.com", retryDelayMs: 0 });
}

test("GET retries across a transient 502 then succeeds (just-booted stack window)", async (t) => {
  const fake = scriptFetch([
    { status: 502, body: "Bad Gateway" },
    { status: 502, body: "Bad Gateway" },
    { status: 200, body: JSON.stringify({ organizations: [{ id: "org-1" }] }) },
  ]);
  t.after(() => fake.dispose());

  const result = await client().get<{ organizations: Array<{ id: string }> }>("/v1/organizations");

  assert.equal(result.organizations[0].id, "org-1");
  assert.equal(fake.calls, 3, "should have retried twice before the 200");
});

test("GET retries a transport (network) error", async (t) => {
  const fake = scriptFetch([
    { throw: new Error("ECONNRESET") },
    { status: 200, body: JSON.stringify({ ok: true }) },
  ]);
  t.after(() => fake.dispose());

  const result = await client().get<{ ok: boolean }>("/health");

  assert.equal(result.ok, true);
  assert.equal(fake.calls, 2);
});

test("GET does NOT retry a 4xx (a real client error is not a warming-stack blip)", async (t) => {
  const fake = scriptFetch([{ status: 403, body: "forbidden" }]);
  t.after(() => fake.dispose());

  await assert.rejects(client().get("/v1/organizations"), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 403);
    return true;
  });
  assert.equal(fake.calls, 1, "a 4xx must fail immediately, no retry");
});

test("GET gives up after the bounded attempt cap on a persistently wedged stack", async (t) => {
  const fake = scriptFetch([{ status: 503, body: "Service Unavailable" }]);
  t.after(() => fake.dispose());

  await assert.rejects(client().get("/v1/organizations"), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(fake.calls, 6, "should stop at GET_RETRY_MAX_ATTEMPTS");
});
