import assert from "node:assert/strict";
import { test } from "node:test";

import { redactSecrets, assertNoSecret } from "./redaction.js";

test("redactSecrets replaces a raw secret and its url-encoded and base64 forms", () => {
  const secret = "sk-live-abcdef123456";
  const input = `key=${secret} enc=${encodeURIComponent(secret)} b64=${Buffer.from(secret).toString("base64")}`;
  const out = redactSecrets(input, { secrets: [secret] });
  assert.ok(!out.includes(secret));
  assert.ok(!out.includes(encodeURIComponent(secret)));
  assert.ok(!out.includes(Buffer.from(secret).toString("base64")));
  assert.ok(out.includes("[REDACTED_SECRET]"));
});

test("redactSecrets strips URL userinfo even for an unknown token", () => {
  const out = redactSecrets("clone https://x-access-token:ghs_unknown@github.com/o/r.git");
  assert.ok(out.includes("https://[REDACTED_SECRET]@github.com/o/r.git"));
  assert.ok(!out.includes("ghs_unknown"));
});

test("redactSecrets ignores trivially short values to avoid corrupting text", () => {
  const out = redactSecrets("the cat sat", { secrets: ["cat"] });
  assert.equal(out, "the cat sat");
});

test("redactSecrets prefers the longest overlapping secret", () => {
  const out = redactSecrets("token=abcdefghij", { secrets: ["abcd", "abcdefghij"] });
  assert.equal(out, "token=[REDACTED_SECRET]");
});

test("assertNoSecret throws with the NAME, never the value, when a secret leaks", () => {
  assert.throws(
    () => assertNoSecret({ url: "https://api?k=supersecretvalue" }, { RELEASE_E2E_GATEWAY_TEST_KEY: "supersecretvalue" }),
    (err: Error) => {
      assert.ok(err.message.includes("RELEASE_E2E_GATEWAY_TEST_KEY"));
      assert.ok(!err.message.includes("supersecretvalue"));
      return true;
    },
  );
});

test("assertNoSecret passes clean payloads through unchanged", () => {
  const payload = { ok: true };
  assert.equal(assertNoSecret(payload, { RELEASE_E2E_GATEWAY_TEST_KEY: "secret" }), payload);
});
