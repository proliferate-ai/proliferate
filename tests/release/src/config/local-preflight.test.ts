import assert from "node:assert/strict";
import { test } from "node:test";

import { preflightLocalProfileServices } from "./local-preflight.js";

test("preflight probes only required profile services without exposing URL credentials", async () => {
  const calls: Array<{ host: string; port: number }> = [];
  const urls: string[] = [];
  const checks = await preflightLocalProfileServices(
    ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_LOCAL_RUNTIME_URL", "RELEASE_E2E_DESKTOP_WEB_URL", "RELEASE_E2E_LOCAL_DATABASE_URL"],
    {
      env: {
        RELEASE_E2E_SERVER_URL: "http://127.0.0.1:8086",
        RELEASE_E2E_LOCAL_RUNTIME_URL: "http://127.0.0.1:8542",
        RELEASE_E2E_DESKTOP_WEB_URL: "http://127.0.0.1:1420",
        RELEASE_E2E_LOCAL_DATABASE_URL: "postgresql+asyncpg://user:secret@[::1]:5432/profile_db",
      },
      fetchImpl: async (input) => {
        urls.push(String(input));
        if (String(input).endsWith("/health")) {
          return new Response(JSON.stringify({ status: "ok", version: "0.3.25" }), { status: 200 });
        }
        return new Response('<title>Proliferate</title><div id="root"></div>', { status: 200 });
      },
      tcpProbe: async (host, port) => {
        calls.push({ host, port });
      },
    },
  );

  assert.deepEqual(calls, [{ host: "::1", port: 5432 }]);
  assert.deepEqual(urls, [
    "http://127.0.0.1:8086/health",
    "http://127.0.0.1:8542/health",
    "http://127.0.0.1:1420",
  ]);
  assert.deepEqual(checks.map((check) => check.name), [
    "RELEASE_E2E_SERVER_URL",
    "RELEASE_E2E_LOCAL_RUNTIME_URL",
    "RELEASE_E2E_DESKTOP_WEB_URL",
    "RELEASE_E2E_LOCAL_DATABASE_URL",
  ]);
  assert.equal(JSON.stringify(checks).includes("secret"), false);
});

test("preflight reports unreachable, invalid, and unset services without throwing", async () => {
  const checks = await preflightLocalProfileServices(
    ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_LOCAL_RUNTIME_URL", "RELEASE_E2E_DESKTOP_WEB_URL"],
    {
      env: {
        RELEASE_E2E_SERVER_URL: "http://127.0.0.1:8086",
        RELEASE_E2E_LOCAL_RUNTIME_URL: "not-a-url",
      },
      fetchImpl: async () => {
        throw new Error("health connection refused");
      },
    },
  );

  assert.deepEqual(checks.map((check) => check.ready), [false, false, false]);
  assert.match(checks[0].detail ?? "", /health connection refused/);
  assert.match(checks[1].detail ?? "", /Invalid URL/);
  assert.equal(checks[2].detail, "environment value is unset");
});

test("preflight rejects healthy TCP impostors with invalid HTTP payloads", async () => {
  const checks = await preflightLocalProfileServices(
    ["RELEASE_E2E_SERVER_URL", "RELEASE_E2E_DESKTOP_WEB_URL"],
    {
      env: {
        RELEASE_E2E_SERVER_URL: "http://127.0.0.1:8086",
        RELEASE_E2E_DESKTOP_WEB_URL: "http://127.0.0.1:1420",
      },
      fetchImpl: async (input) =>
        String(input).endsWith("/health")
          ? new Response(JSON.stringify({ status: "wrong", version: "0.3.25" }), { status: 200 })
          : new Response("not the app", { status: 200 }),
    },
  );

  assert.deepEqual(checks.map((check) => check.ready), [false, false]);
  assert.match(checks[0].detail ?? "", /status was/);
  assert.match(checks[1].detail ?? "", /application shell/);
});
