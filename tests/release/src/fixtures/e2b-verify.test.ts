import assert from "node:assert/strict";
import { test } from "node:test";

import { e2bVerificationAvailable, retryE2bReadAfterRateLimit } from "./e2b-verify.js";

test("e2bVerificationAvailable is false when RELEASE_E2E_E2B_API_KEY is unset or blank", () => {
  assert.equal(e2bVerificationAvailable({}), false);
  assert.equal(e2bVerificationAvailable({ RELEASE_E2E_E2B_API_KEY: "   " }), false);
});

test("e2bVerificationAvailable is true when RELEASE_E2E_E2B_API_KEY is set", () => {
  assert.equal(e2bVerificationAvailable({ RELEASE_E2E_E2B_API_KEY: "e2b_test_key" }), true);
});

test("E2B inventory reads retry explicit 429s with bounded backoff", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const result = await retryE2bReadAfterRateLimit(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("e2b.exceptions.RateLimitException: 429: Rate limit exceeded");
      }
      return "found";
    },
    { delaysMs: [2_000, 4_000, 8_000], sleep: async (ms) => void sleeps.push(ms) },
  );

  assert.equal(result, "found");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [2_000, 4_000]);
});

test("E2B inventory reads do not retry non-rate-limit failures", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    retryE2bReadAfterRateLimit(
      async () => {
        attempts += 1;
        throw new Error("E2B authentication failed");
      },
      { delaysMs: [2_000, 4_000, 8_000], sleep: async (ms) => void sleeps.push(ms) },
    ),
    /authentication failed/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test("E2B inventory reads remain red after the bounded fourth 429 attempt", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    retryE2bReadAfterRateLimit(
      async () => {
        attempts += 1;
        throw new Error("e2b.exceptions.RateLimitException: 429: Rate limit exceeded");
      },
      { delaysMs: [2_000, 4_000, 8_000], sleep: async (ms) => void sleeps.push(ms) },
    ),
    /RateLimitException: 429/,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(sleeps, [2_000, 4_000, 8_000]);
});
