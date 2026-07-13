import { test } from "node:test";
import assert from "node:assert/strict";

import { redactSecrets, redactValue, forbiddenSecretKey, findForbiddenKey, REDACTION } from "./redaction.js";

test("redacts the raw secret value and its common encodings", () => {
  const secret = "sk_test_supersecretvalue123456";
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const uri = encodeURIComponent(secret);
  const input = `raw=${secret} b64=${base64} uri=${uri}`;
  const out = redactSecrets(input, [secret]);
  assert.ok(!out.includes(secret), "raw secret must be gone");
  assert.ok(!out.includes(base64), "base64 encoding must be gone");
  assert.ok(!out.includes(uri), "uri encoding must be gone");
  assert.ok(out.includes(REDACTION));
});

test("redacts the x-access-token basic-auth base64 form", () => {
  const secret = "ghs_tokenvaluexyz";
  const helper = Buffer.from(`x-access-token:${secret}`, "utf8").toString("base64");
  const out = redactSecrets(`Authorization: Basic ${helper}`, [secret]);
  assert.ok(!out.includes(helper));
});

test("scrubs URL userinfo structurally even for unknown values", () => {
  const out = redactSecrets("clone https://x-access-token:abc123@github.com/o/r.git", []);
  assert.ok(!out.includes("abc123"));
  assert.match(out, /https:\/\/\[REDACTED_SECRET\]@github\.com/);
});

test("longest-first ordering avoids leaving a prefix half-redacted", () => {
  const short = "secretAB";
  const long = "secretABCDEF";
  const out = redactSecrets(`${long} then ${short}`, [short, long]);
  assert.ok(!out.includes(long));
  assert.ok(!out.includes(short));
});

test("redactValue handles errors and objects", () => {
  const secret = "topsecretvalue99";
  assert.ok(!String(redactValue(new Error(`boom ${secret}`), [secret])).includes(secret));
  assert.ok(!String(redactValue({ nested: { field: secret } }, [secret])).includes(secret));
});

test("forbiddenSecretKey flags credential-shaped keys and allows safe identifiers", () => {
  assert.equal(forbiddenSecretKey("apiKey"), true);
  assert.equal(forbiddenSecretKey("api_key"), true);
  assert.equal(forbiddenSecretKey("password"), true);
  assert.equal(forbiddenSecretKey("access_token"), true);
  assert.equal(forbiddenSecretKey("authorization"), true);
  assert.equal(forbiddenSecretKey("resourceId"), false);
  assert.equal(forbiddenSecretKey("virtualKeyId"), false);
  assert.equal(forbiddenSecretKey("templateId"), false);
  assert.equal(forbiddenSecretKey("digest"), false);
});

test("findForbiddenKey walks nested payloads and returns the path", () => {
  assert.equal(findForbiddenKey({ a: { b: 1 }, list: [{ ok: true }] }), null);
  assert.equal(findForbiddenKey({ a: { secret: "x" } }), "a.secret");
  assert.equal(findForbiddenKey({ list: [{ password: "x" }] }), "list.0.password");
});
