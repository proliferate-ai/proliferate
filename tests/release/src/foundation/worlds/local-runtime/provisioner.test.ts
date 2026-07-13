import assert from "node:assert/strict";
import { test } from "node:test";

import { gatewayHostIdentity, sanitizeDatabaseUrl } from "./provisioner.js";

test("gatewayHostIdentity returns host only, never the key or path", () => {
  assert.equal(gatewayHostIdentity("https://gw.example.com/v1/chat"), "gw.example.com");
  assert.equal(gatewayHostIdentity("https://gw.example.com:4000"), "gw.example.com:4000");
  assert.equal(gatewayHostIdentity("not a url"), "invalid-url");
});

test("sanitizeDatabaseUrl strips userinfo credentials", () => {
  const out = sanitizeDatabaseUrl("postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/db");
  assert.ok(!out.includes("localdev"));
  assert.ok(out.includes("[REDACTED]@127.0.0.1:5432/db"));
  assert.equal(sanitizeDatabaseUrl(undefined), "");
});
