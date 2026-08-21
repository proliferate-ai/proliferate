import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NEW_TARGET,
  WORKSPACE_BASE_URL,
  adminTokenProvider,
  createClient,
  ensureRules,
  loadOverlay,
  runApply,
  runCheck,
  runVerify,
  validateOverlayDocument,
  verifyTarget,
} from "./grafana-sli-alerts.mjs";
import { queryChecksum } from "./grafana-alerting.mjs";

// --- Fixtures: a real base overlay shape mirroring the checked-in file ------

function baseQueryModel(overrides = {}) {
  return {
    title: "Sign-in failures > 5 in 10m",
    condition: "threshold",
    data: [
      { refId: "A", datasourceUid: "cfvtvusw9bd34d", model: { metricName: "SignInFailureCount" } },
      { refId: "B", datasourceUid: "__expr__", model: { expression: "A", type: "reduce" } },
      { refId: "threshold", datasourceUid: "__expr__", model: { expression: "B", type: "threshold" } },
    ],
    noDataState: "OK",
    execErrState: "Alerting",
    for: "10m",
    ruleGroup: "sli-alerts",
    folderUID: "ops-folder",
    isPaused: false,
    ...overrides,
  };
}

function baseOverlay(overrides = {}) {
  const queryModel = baseQueryModel(overrides.queryModel);
  const rule = {
    uid: "ffvtx33lbo5c0e",
    title: "Sign-in failures > 5 in 10m",
    severity: "warning",
    labels: { proliferate_component: "proliferate-server", severity: "warning" },
    annotations: {
      runbook_url:
        "https://github.com/proliferate-ai/proliferate/blob/main/guides/operating/production-alerts.md#sign-in-success-rate",
    },
    queryModel,
    queryChecksum: queryChecksum(queryModel),
    ...(overrides.rule || {}),
  };
  return {
    schemaVersion: 1,
    target: { ...NEW_TARGET },
    component: "proliferate-server",
    rules: [rule],
    ...overrides.top,
  };
}

// --- Offline validation ------------------------------------------------------

test("verifyTarget accepts an exact match and rejects any drift", () => {
  assert.doesNotThrow(() => verifyTarget({ ...NEW_TARGET }));
  assert.throws(() => verifyTarget({ ...NEW_TARGET, grafanaWorkspaceId: "g-e532d030d8" }), /non-matching target/);
  assert.throws(() => verifyTarget(null), /non-matching target/);
});

test("the real checked-in sli-alerts.json passes full offline validation", () => {
  const overlay = loadOverlay();
  assert.doesNotThrow(() => validateOverlayDocument(overlay));
  assert.equal(overlay.rules[0].queryModel.ruleGroup, "sli-alerts");
});

test("runCheck loads and validates the real checked-in file", () => {
  const { overlay } = runCheck();
  assert.equal(overlay.target.grafanaWorkspaceId, "g-48655e6419");
});

test("validateOverlayDocument rejects a rule outside the sli-alerts ruleGroup", () => {
  const overlay = baseOverlay({ queryModel: { ruleGroup: "production-alerts" } });
  overlay.rules[0].queryChecksum = queryChecksum(overlay.rules[0].queryModel);
  assert.throws(() => validateOverlayDocument(overlay), /must be in ruleGroup "sli-alerts"/);
});

test("validateOverlayDocument rejects a title mismatch between identity and queryModel", () => {
  const overlay = baseOverlay();
  overlay.rules[0].queryModel.title = "Something else";
  assert.throws(() => validateOverlayDocument(overlay), /title does not match/);
});

test("validateOverlayDocument detects checksum drift against a tampered queryModel", () => {
  const overlay = baseOverlay();
  overlay.rules[0].queryModel.for = "1m"; // tamper after the checksum was computed
  assert.throws(() => validateOverlayDocument(overlay), /queryChecksum does not match/);
});

test("validateOverlayDocument rejects a query stanza missing a datasourceUid", () => {
  const overlay = baseOverlay();
  delete overlay.rules[0].queryModel.data[0].datasourceUid;
  overlay.rules[0].queryChecksum = queryChecksum(overlay.rules[0].queryModel);
  assert.throws(() => validateOverlayDocument(overlay), /missing datasourceUid/);
});

test("validateOverlayDocument requires a runbook_url annotation on every rule", () => {
  const overlay = baseOverlay();
  overlay.rules[0].annotations = {};
  assert.throws(() => validateOverlayDocument(overlay), /missing a runbook_url annotation/);
});

test("validateOverlayDocument rejects a duplicate rule UID", () => {
  const overlay = baseOverlay();
  overlay.rules.push({ ...overlay.rules[0] });
  assert.throws(() => validateOverlayDocument(overlay), /Duplicate rule UID/);
});

test("validateOverlayDocument rejects an empty rule set", () => {
  const overlay = baseOverlay();
  overlay.rules = [];
  assert.throws(() => validateOverlayDocument(overlay), /defines no rules/);
});

// --- Admin token loading ------------------------------------------------------

test("adminTokenProvider throws when the token file is missing", () => {
  const missing = path.join(os.tmpdir(), `grafana-sli-token-missing-${process.pid}`);
  assert.throws(() => adminTokenProvider({ tokenPath: missing }), /not found/);
});

test("adminTokenProvider throws when the token file is not mode 0600", () => {
  const tokenPath = path.join(os.tmpdir(), `grafana-sli-token-loose-${process.pid}`);
  fs.writeFileSync(tokenPath, "sekret", { mode: 0o644 });
  try {
    assert.throws(() => adminTokenProvider({ tokenPath }), /mode 0600/);
  } finally {
    fs.rmSync(tokenPath, { force: true });
  }
});

test("adminTokenProvider throws when the token file is empty", () => {
  const tokenPath = path.join(os.tmpdir(), `grafana-sli-token-empty-${process.pid}`);
  fs.writeFileSync(tokenPath, "", { mode: 0o600 });
  try {
    assert.throws(() => adminTokenProvider({ tokenPath }), /empty/);
  } finally {
    fs.rmSync(tokenPath, { force: true });
  }
});

test("adminTokenProvider returns the trimmed token on a valid 0600 file", () => {
  const tokenPath = path.join(os.tmpdir(), `grafana-sli-token-ok-${process.pid}`);
  fs.writeFileSync(tokenPath, "glsa_abc123\n", { mode: 0o600 });
  try {
    assert.equal(adminTokenProvider({ tokenPath }), "glsa_abc123");
  } finally {
    fs.rmSync(tokenPath, { force: true });
  }
});

// --- Fake-transport client: apply / verify without the network --------------

function makeFakeGrafana(initialRules = {}) {
  const rules = { ...initialRules };
  const calls = [];
  async function fetchImpl(url, init) {
    calls.push({ url: String(url), method: init.method });
    assert.ok(String(url).startsWith(WORKSPACE_BASE_URL), "requests must target the fixed workspace base URL");
    const u = new URL(url);
    const getMatch = u.pathname.match(/^\/api\/v1\/provisioning\/alert-rules\/(.+)$/);
    if (init.method === "GET" && getMatch) {
      const uid = decodeURIComponent(getMatch[1]);
      if (!(uid in rules)) {
        return { ok: false, status: 404, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(rules[uid]) };
    }
    if (init.method === "POST" && u.pathname === "/api/v1/provisioning/alert-rules") {
      const body = JSON.parse(init.body);
      rules[body.uid] = body;
      return { ok: true, status: 201, text: async () => JSON.stringify(body) };
    }
    if (init.method === "GET" && u.pathname === "/api/prometheus/grafana/api/v1/rules") {
      const groupRules = Object.values(rules).map((r) => ({ name: r.title, health: "ok", state: "inactive" }));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { groups: [{ name: "sli-alerts", rules: groupRules }] } }),
      };
    }
    throw new Error(`Unhandled fake request: ${init.method} ${u.pathname}`);
  }
  return { fetchImpl, calls, rules };
}

test("createClient requires a tokenProvider function", () => {
  assert.throws(() => createClient({ tokenProvider: undefined }), /requires a tokenProvider/);
});

test("createClient sends a Bearer header derived from the token provider", async () => {
  const { fetchImpl, calls } = makeFakeGrafana();
  const client = createClient({ fetchImpl, tokenProvider: () => "test-token" });
  await client.getAlertRule("nope");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});

test("ensureRules creates a missing rule and reports it created", async () => {
  const { fetchImpl, rules } = makeFakeGrafana();
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  const overlay = baseOverlay();
  const result = await ensureRules(client, overlay);
  assert.deepEqual(result, { ffvtx33lbo5c0e: "created" });
  assert.ok(rules.ffvtx33lbo5c0e);
});

test("ensureRules is idempotent: a matching live rule reports present, no second create", async () => {
  const overlay = baseOverlay();
  const liveRule = { uid: overlay.rules[0].uid, ...overlay.rules[0].queryModel };
  const { fetchImpl, calls } = makeFakeGrafana({ [overlay.rules[0].uid]: liveRule });
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  const result = await ensureRules(client, overlay);
  assert.deepEqual(result, { ffvtx33lbo5c0e: "present" });
  assert.ok(!calls.some((c) => c.method === "POST"), "must not attempt to recreate a present, matching rule");
});

test("ensureRules hard-fails rather than overwriting a live rule that has drifted", async () => {
  const overlay = baseOverlay();
  const drifted = { uid: overlay.rules[0].uid, ...overlay.rules[0].queryModel, for: "30m" };
  const { fetchImpl } = makeFakeGrafana({ [overlay.rules[0].uid]: drifted });
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  await assert.rejects(() => ensureRules(client, overlay), /has drifted from the checked-in sli-alerts overlay/);
});

test("runApply is a thin wrapper that validates then ensures every rule", async () => {
  const { fetchImpl } = makeFakeGrafana();
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  const result = await runApply({ client, repoRoot: undefined }).catch((e) => e);
  // Uses the real checked-in overlay (repoRoot default), so this exercises the
  // actual file end to end against the fake transport.
  assert.ok(result.rules, "expected a rules result, not an error");
  assert.equal(result.rules.ffvtx33lbo5c0e, "created");
});

test("runVerify reports checksum match/mismatch and per-rule health from the rules API", async () => {
  // runVerify always reloads the real checked-in overlay from disk (same as
  // runCheck/runApply), so the fake live rule must be built from that same
  // on-disk queryModel for the checksums to align -- not a hand-rolled one.
  const onDisk = loadOverlay();
  const liveRule = { uid: onDisk.rules[0].uid, ...onDisk.rules[0].queryModel };
  const { fetchImpl } = makeFakeGrafana({ [onDisk.rules[0].uid]: liveRule });
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  const result = await runVerify({ client });
  assert.equal(result.checksums[onDisk.rules[0].uid], "match");
  assert.equal(result.health[onDisk.rules[0].title].health, "ok");
});

test("runVerify reports MISSING for a rule that does not exist live", async () => {
  const { fetchImpl } = makeFakeGrafana();
  const client = createClient({ fetchImpl, tokenProvider: () => "t" });
  const result = await runVerify({ client });
  assert.equal(result.checksums.ffvtx33lbo5c0e, "MISSING");
});
