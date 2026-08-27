import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { chooseDelivery, deliver, findReports, formatDigest, summarizeReports } from "./battery-digest.mjs";

const report = (results) => ({ schema_version: 4, results });
const cell = (id, status, message) => ({
  cell_id: `${id}/sandbox`,
  scenario_id: id,
  status,
  reason: message ? { code: "scenario_failure", message } : null,
});

test("summarizeReports groups cells by verdict and counts green", () => {
  const summary = summarizeReports([
    report([cell("T3-BATT-AUTH-1", "green"), cell("T3-BATT-WORKER-1", "expected_fail", "no worker plane")]),
    report([cell("T3-BATT-RUN-1", "failed", "proxy 502"), cell("T3-BATT-INT-1", "blocked", "no key")]),
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.green, 1);
  assert.deepEqual(Object.keys(summary.byStatus).sort(), ["blocked", "expected_fail", "failed", "green"]);
  assert.equal(summary.byStatus.failed[0].reason, "proxy 502");
});

test("a later report's verdict for the same cell wins (re-runs replace, never double count)", () => {
  const summary = summarizeReports([
    report([cell("T3-BATT-GH-1", "failed", "first attempt")]),
    report([cell("T3-BATT-GH-1", "green")]),
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.green, 1);
});

test("formatDigest names every non-green journey with its cause and labels expected-fail distinctly", () => {
  const text = formatDigest(
    summarizeReports([
      report([
        cell("T3-BATT-AUTH-1", "green"),
        cell("T3-BATT-RUN-1", "failed", "the cloud session path is not serving"),
        cell("T3-BATT-WORKER-1", "expected_fail", "no worker plane on staging"),
        cell("T3-BATT-INT-1", "blocked", "RELEASE_E2E_INTEGRATION_API_KEY is not provisioned"),
      ]),
    ]),
    { lane: "staging", runUrl: "https://example/run/1", when: new Date("2026-08-27T08:00:00Z") },
  );
  assert.match(text, /^staging battery 2026-08-27: 1\/4 green/m);
  assert.match(text, /RED \(1\):\n {2}• T3-BATT-RUN-1\/sandbox — the cloud session path is not serving/);
  assert.match(text, /expected-fail \(1\):\n {2}• T3-BATT-WORKER-1\/sandbox — no worker plane on staging/);
  assert.match(text, /blocked \(1\):/);
  assert.match(text, /green \(1\): T3-BATT-AUTH-1\/sandbox/);
  assert.match(text, /run: https:\/\/example\/run\/1$/);
  // A red journey is never described as green anywhere in the digest.
  assert.doesNotMatch(text, /green.*T3-BATT-RUN-1/);
});

test("formatDigest says NO RESULTS when the runner produced no evidence", () => {
  const text = formatDigest(summarizeReports([]), { when: new Date("2026-08-27T08:00:00Z") });
  assert.match(text, /NO RESULTS/);
});

test("chooseDelivery prefers Slack, then the issue, then stdout", () => {
  assert.equal(chooseDelivery({ SLACK_WEBHOOK_URL: "https://hooks.example/x" }).kind, "slack");
  assert.equal(chooseDelivery({ GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r" }).kind, "issue");
  assert.equal(chooseDelivery({}).kind, "stdout");
});

test("deliver never throws: a failing webhook is reported, not raised", async () => {
  const calls = [];
  const failingFetch = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: false, status: 500 };
  };
  const outcome = await deliver("digest text", { SLACK_WEBHOOK_URL: "https://hooks.example/x" }, failingFetch);
  assert.equal(outcome.delivered, "slack");
  assert.match(outcome.error, /500/);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { text: "digest text" });
});

test("deliver replaces the pinned issue body when it exists, creates it otherwise", async () => {
  const seen = [];
  const fetchWithIssue = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("&labels=")) {
      return { ok: true, status: 200, json: async () => [{ number: 7, title: "Staging battery — morning digest" }] };
    }
    return { ok: true, status: 200 };
  };
  const env = { GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };
  const updated = await deliver("d", env, fetchWithIssue);
  assert.equal(updated.error, null);
  assert.ok(seen.some((call) => call.method === "PATCH" && call.url.endsWith("/issues/7")));

  seen.length = 0;
  const fetchWithout = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("&labels=")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: true, status: 201 };
  };
  await deliver("d", env, fetchWithout);
  assert.ok(seen.some((call) => call.method === "POST" && call.url.endsWith("/issues")));
});

test("findReports discovers every qualification-evidence.json under the output tree", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "battery-digest-"));
  const a = path.join(root, "run-a", "shard-0", "attempt-1");
  const b = path.join(root, "run-b", "shard-0", "attempt-2");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(path.join(a, "qualification-evidence.json"), "{}");
  writeFileSync(path.join(b, "qualification-evidence.json"), "{}");
  writeFileSync(path.join(b, "other.json"), "{}");
  assert.equal(findReports(root).length, 2);
  assert.equal(findReports(path.join(root, "missing")).length, 0);
});
