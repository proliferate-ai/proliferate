import assert from "node:assert/strict";
import { test } from "node:test";

import { isRollingReference, rollingReferenceReason } from "./rolling-refs.js";

test("bare rolling tokens are rejected", () => {
  assert.equal(isRollingReference("latest"), true);
  assert.equal(isRollingReference("stable"), true);
  assert.equal(isRollingReference("LATEST"), true);
  assert.equal(isRollingReference("Stable"), true);
});

test("rolling tokens as the final path/tag segment are rejected", () => {
  assert.equal(isRollingReference("s3://bucket/candidate/latest"), true);
  assert.equal(isRollingReference("ghcr.io/proliferate/server:stable"), true);
  assert.equal(isRollingReference("ghcr.io/proliferate/server:latest"), true);
});

test("a token merely embedded in a longer segment is not rejected", () => {
  assert.equal(isRollingReference("s3://bucket/stable-branch/build.tar.gz"), false);
  assert.equal(isRollingReference("s3://bucket/latest-candidate/build.tar.gz"), false);
});

test("empty/whitespace-only locators are rejected", () => {
  assert.equal(isRollingReference(""), true);
  assert.equal(isRollingReference("   "), true);
});

test("an immutable content-addressed locator is accepted", () => {
  assert.equal(
    isRollingReference("s3://proliferate-artifacts/candidate/9f2c1e7/anyharness-linux-x86_64"),
    false,
  );
});

test("rollingReferenceReason is null for a valid locator and a message otherwise", () => {
  assert.equal(rollingReferenceReason("s3://bucket/candidate/9f2c1e7/server"), null);
  assert.match(rollingReferenceReason("latest") ?? "", /rolling reference/);
  assert.match(rollingReferenceReason("") ?? "", /empty/);
});
