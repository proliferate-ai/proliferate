import assert from "node:assert/strict";
import { test } from "node:test";

import { assertNeverLeaked, describeShape, describeShapeCheck, matchesShape } from "./redaction.js";

const FAKE_SECRET = "sk_test_totally_fake_do_not_use_1234567890abcdef";

test("describeShape never contains any character of the value", () => {
  const description = describeShape(FAKE_SECRET);
  assert.equal(description.includes(FAKE_SECRET), false);
  assert.equal(description.includes("sk_test"), false);
  assert.match(description, /^present \(\d+ chars\)$/);
});

test("describeShape distinguishes absent/empty/present without leaking length-zero ambiguity", () => {
  assert.equal(describeShape(undefined), "absent");
  assert.equal(describeShape(""), "empty");
  assert.equal(describeShape("   "), "empty");
  assert.equal(describeShape("x"), "present (1 chars)");
});

test("matchesShape: named checks are boolean-only, never echo the value", () => {
  assert.equal(matchesShape("sk_test_prefix", FAKE_SECRET), true);
  assert.equal(matchesShape("sk_live_prefix", FAKE_SECRET), false);
  assert.equal(matchesShape("non_empty", FAKE_SECRET), true);
  assert.equal(matchesShape("non_empty", undefined), false);
  assert.equal(matchesShape("public_https_url", "https://gateway.example.test"), true);
  assert.equal(matchesShape("public_https_url", "http://insecure.example.test"), false);
  assert.equal(matchesShape("public_https_url", "not a url"), false);
  assert.equal(matchesShape("hex_64", "a".repeat(64)), true);
  assert.equal(matchesShape("hex_64", "a".repeat(63)), false);
  assert.equal(matchesShape("e2b_key_prefix", "e2b_abc123"), true);
  assert.equal(matchesShape("gh_token_prefix", "ghp_abc123"), true);
  assert.equal(matchesShape("gh_token_prefix", "abc123"), false);
});

test("describeShapeCheck combines length + verdict without leaking the value", () => {
  const description = describeShapeCheck(FAKE_SECRET, "sk_test_prefix");
  assert.equal(description.includes(FAKE_SECRET), false);
  assert.match(description, /sk_test_prefix: yes/);
});

test("assertNeverLeaked passes when the secret is absent from every haystack", () => {
  assert.doesNotThrow(() =>
    assertNeverLeaked(FAKE_SECRET, [describeShape(FAKE_SECRET), { detail: describeShapeCheck(FAKE_SECRET, "sk_test_prefix") }]),
  );
});

test("assertNeverLeaked throws (without repeating the secret) when it IS present", () => {
  assert.throws(() => assertNeverLeaked(FAKE_SECRET, [`leaked: ${FAKE_SECRET}`]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(FAKE_SECRET), false);
    return true;
  });
});

test("assertNeverLeaked catches a leak nested inside an object haystack", () => {
  assert.throws(() => assertNeverLeaked(FAKE_SECRET, [{ nested: { value: FAKE_SECRET } }]));
});
