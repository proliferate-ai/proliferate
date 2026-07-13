import assert from "node:assert/strict";
import { test } from "node:test";

import { redactSecrets, redactValue } from "./redaction.js";

test("redacts a manifest-declared secret from the ambient env", () => {
  const env: NodeJS.ProcessEnv = { RELEASE_E2E_GATEWAY_TEST_KEY: "sk-super-secret-123" };
  const out = redactSecrets("using key sk-super-secret-123 now", { env });
  assert.ok(!out.includes("sk-super-secret-123"));
  assert.ok(out.includes("[REDACTED_SECRET]"));
});

test("redacts caller-supplied ephemeral secrets (raw virtual key)", () => {
  const out = redactSecrets("key=sk-ephemeral-xyz done", {
    env: {},
    additionalSecrets: ["sk-ephemeral-xyz"],
  });
  assert.ok(!out.includes("sk-ephemeral-xyz"));
});

test("redacts URL-encoded and base64 variants of a secret", () => {
  const secret = "s p a c e/secret+value";
  const encoded = encodeURIComponent(secret);
  const b64 = Buffer.from(secret, "utf8").toString("base64");
  const out = redactSecrets(`a=${encoded} b=${b64}`, { env: {}, additionalSecrets: [secret] });
  assert.ok(!out.includes(encoded));
  assert.ok(!out.includes(b64));
});

test("redacts http(s) URL userinfo even when not in the manifest", () => {
  const out = redactSecrets("connect https://user:pw@gw.example.com/v1", { env: {} });
  assert.ok(!out.includes("user:pw@"));
  assert.ok(out.includes("[REDACTED_SECRET]@"));
});

test("redactValue handles Error objects", () => {
  const env: NodeJS.ProcessEnv = { RELEASE_E2E_GATEWAY_TEST_KEY: "sk-in-error" };
  const out = redactValue(new Error("boom sk-in-error boom"), { env });
  assert.ok(!out.includes("sk-in-error"));
});
