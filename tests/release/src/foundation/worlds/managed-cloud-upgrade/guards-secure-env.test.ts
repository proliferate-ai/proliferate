import assert from "node:assert/strict";
import { test } from "node:test";

import { pollUntil, DeadlineExceededError, OnceGuard } from "./guards.js";
import { parseEnvFile, redactSecrets, SecureEnvError } from "./secure-env.js";

// ---------------------------------------------------------------------------
// guards
// ---------------------------------------------------------------------------

test("pollUntil returns the first non-null probe result", async () => {
  let calls = 0;
  const value = await pollUntil<string>(
    async () => {
      calls += 1;
      return calls >= 3 ? "converged" : null;
    },
    { what: "convergence", timeoutMs: 1000, intervalMs: 0, now: () => 0, sleep: async () => {} },
  );
  assert.equal(value, "converged");
  assert.equal(calls, 3);
});

test("pollUntil throws DeadlineExceededError on timeout (never a silent pass)", async () => {
  let clock = 0;
  await assert.rejects(
    () =>
      pollUntil<string>(async () => null, {
        what: "heartbeat N",
        timeoutMs: 10,
        intervalMs: 5,
        now: () => (clock += 5),
        sleep: async () => {},
      }),
    DeadlineExceededError,
  );
});

test("OnceGuard fires an effect at most once per key across retries", async () => {
  const guard = new OnceGuard<number>();
  let sideEffects = 0;
  const effect = async () => {
    sideEffects += 1;
    return sideEffects;
  };
  const a = await guard.run("flip", effect);
  const b = await guard.run("flip", effect);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(sideEffects, 1);
  assert.equal(guard.firedCount, 1);
  assert.equal(guard.hasFired("flip"), true);
});

// ---------------------------------------------------------------------------
// secure-env
// ---------------------------------------------------------------------------

test("parseEnvFile reads NAME=value, export, quotes, and comments as data", () => {
  const parsed = parseEnvFile(
    ["# comment", "export A=1", 'B="two words"', "C='literal'", "D=trailing # inline"].join("\n"),
  );
  assert.equal(parsed.get("A"), "1");
  assert.equal(parsed.get("B"), "two words");
  assert.equal(parsed.get("C"), "literal");
  assert.equal(parsed.get("D"), "trailing");
});

test("parseEnvFile rejects a malformed line and duplicate keys", () => {
  assert.throws(() => parseEnvFile("not an assignment"), SecureEnvError);
  assert.throws(() => parseEnvFile("A=1\nA=2"), SecureEnvError);
});

test("redactSecrets removes a secret value, its encodings, and URL userinfo", () => {
  const secret = "sk_live_supersecretvalue";
  const input = [
    `key=${secret}`,
    `enc=${encodeURIComponent(secret)}`,
    `b64=${Buffer.from(secret, "utf8").toString("base64")}`,
    `url=https://user:${secret}@host/path`,
  ].join(" ");
  const out = redactSecrets(input, [secret]);
  assert.ok(!out.includes(secret));
  assert.ok(!out.includes(Buffer.from(secret, "utf8").toString("base64")));
  assert.ok(out.includes("[REDACTED_SECRET]"));
  // URL userinfo is masked even beyond the raw value match.
  assert.ok(!/user:sk_live/.test(out));
});
