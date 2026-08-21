#!/usr/bin/env node

// Operator tooling for the sign-in success-rate SLI alert rule (Lane D,
// observability overnight push 2026-08-20/21). Lives in its own `sli-alerts`
// ruleGroup inside the shared `ops-folder` folder on the NEW workspace
// (proliferate-ops-rebuild, g-48655e6419), deliberately separate from the
// five-rule `production-alerts` group that scripts/ops/grafana-alerting.mjs
// (OLD workspace) and scripts/ops/grafana-rebuild-bootstrap.mjs (NEW
// workspace) manage -- this script never reads or writes those rules, their
// contact point, or the notification policy. It relies on both the
// `ops-folder` folder and the CloudWatch datasource already existing (Lane
// A3's job); it does not create either.
//
// Delivery: this rule has no per-rule contact point of its own. It rides the
// NEW workspace's default notification policy / SNS contact point that Lane
// A3 wired to arn:aws:sns:us-east-1:157466816238:grafana-proliferate-ops-alerts
// (confirmed pablo@pablohansen.com email subscription). See
// guides/operating/production-alerts.md#sign-in-success-rate.
//
// `check` is offline. `apply` and `verify` are live and refuse the network
// unless GRAFANA_ALERTING_LIVE=1 (same gate as the other two scripts in this
// directory). Every write is idempotent: it verifies current state first and
// only creates what is missing; a live rule that has drifted from the
// checked-in definition fails loudly rather than being silently overwritten.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize, queryChecksum, redact, sha256 } from "./grafana-alerting.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const OVERLAY_REL = "server/infra/observability/grafana/sli-alerts.json";

// Fixed new-workspace target. Intentionally the same target constant shape as
// grafana-rebuild-bootstrap.mjs's NEW_TARGET, kept as a separate literal here
// (not imported) so this script has no dependency on that unmerged tool and
// cannot be affected if its target definition ever changes.
export const NEW_TARGET = Object.freeze({
  awsAccount: "157466816238",
  awsRegion: "us-east-1",
  grafanaWorkspaceId: "g-48655e6419",
  grafanaWorkspaceName: "proliferate-ops-rebuild",
  grafanaVersion: "10.4",
});

export const WORKSPACE_BASE_URL = `https://${NEW_TARGET.grafanaWorkspaceId}.grafana-workspace.${NEW_TARGET.awsRegion}.amazonaws.com`;

// Deliberately the rebuild-workspace admin token, never the OLD workspace's
// ~/.proliferate-local/ops/grafana-admin.token.
export const ADMIN_TOKEN_PATH = path.join(
  os.homedir(),
  ".proliferate-local/ops/grafana-admin-rebuild.token",
);

const RULE_GROUP = "sli-alerts";

function safeLog(...parts) {
  console.log(parts.map((p) => redact(String(p))).join(" "));
}

export function loadOverlay(repoRoot = REPO_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, OVERLAY_REL), "utf8"));
}

export function verifyTarget(target) {
  const diffs = [];
  for (const key of Object.keys(NEW_TARGET)) {
    if (!target || target[key] !== NEW_TARGET[key]) {
      diffs.push(`${key}: expected ${NEW_TARGET[key]}, got ${target ? target[key] : "<missing>"}`);
    }
  }
  if (diffs.length > 0) {
    throw new Error(`Refusing to operate on a non-matching target:\n  ${diffs.join("\n  ")}`);
  }
}

// Full offline validation of the checked-in sli-alerts overlay: target pins
// to the NEW workspace, every rule sits in the sli-alerts ruleGroup (never
// production-alerts -- that would collide with the other two tools), every
// checksum reproduces from its own queryModel, and every query stanza names
// an actual datasource uid (or the built-in expression datasource).
export function validateOverlayDocument(overlay) {
  verifyTarget(overlay.target);
  if (overlay.component !== "proliferate-server") {
    throw new Error("Overlay component must be proliferate-server");
  }
  const rules = overlay.rules || [];
  if (rules.length === 0) {
    throw new Error("Overlay defines no rules");
  }
  const seen = new Set();
  for (const rule of rules) {
    if (seen.has(rule.uid)) {
      throw new Error(`Duplicate rule UID: ${rule.uid}`);
    }
    seen.add(rule.uid);
    const qm = rule.queryModel;
    if (!qm || typeof qm !== "object") {
      throw new Error(`Rule ${rule.uid} is missing its queryModel`);
    }
    if (qm.ruleGroup !== RULE_GROUP) {
      throw new Error(`Rule ${rule.uid} must be in ruleGroup "${RULE_GROUP}", got "${qm.ruleGroup}"`);
    }
    if (qm.title !== rule.title) {
      throw new Error(`Rule ${rule.uid} queryModel title does not match its identity title`);
    }
    const expected = queryChecksum(qm);
    if (rule.queryChecksum !== expected) {
      throw new Error(`Rule ${rule.uid} queryChecksum does not match its queryModel`);
    }
    for (const stanza of qm.data || []) {
      if (!stanza.datasourceUid) {
        throw new Error(`Rule ${rule.uid} query stanza ${stanza.refId} is missing datasourceUid`);
      }
    }
    if (!rule.annotations?.runbook_url) {
      throw new Error(`Rule ${rule.uid} is missing a runbook_url annotation`);
    }
  }
  return true;
}

export function runCheck({ repoRoot = REPO_ROOT } = {}) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  return { overlay };
}

function assertLiveAllowed() {
  if (process.env.GRAFANA_ALERTING_LIVE !== "1") {
    throw new Error(
      "Live Grafana operations require GRAFANA_ALERTING_LIVE=1 (same gate as scripts/ops/grafana-alerting.mjs).",
    );
  }
}

export function adminTokenProvider({ tokenPath = ADMIN_TOKEN_PATH } = {}) {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Admin token not found at its named 0600 path (${tokenPath})`);
  }
  const mode = fs.statSync(tokenPath).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error("Admin token file must be mode 0600");
  }
  const token = fs.readFileSync(tokenPath, "utf8").trim();
  if (!token) {
    throw new Error("Admin token file is empty");
  }
  return token;
}

function fixedWorkspaceUrl(apiPath) {
  if (typeof apiPath !== "string" || !apiPath.startsWith("/api/") || apiPath.startsWith("//")) {
    throw new Error("Invalid fixed Grafana API path");
  }
  const absolute = `${WORKSPACE_BASE_URL}${apiPath}`;
  const url = new URL(absolute);
  if (url.origin !== WORKSPACE_BASE_URL || url.username || url.password || url.hash) {
    throw new Error("Invalid fixed Grafana API origin");
  }
  return absolute;
}

export function createClient({ fetchImpl = fetch, tokenProvider } = {}) {
  if (typeof tokenProvider !== "function") {
    throw new Error("createClient requires a tokenProvider function");
  }
  async function request(method, apiPath, body) {
    const url = fixedWorkspaceUrl(apiPath);
    const headers = { Authorization: `Bearer ${tokenProvider()}`, Accept: "application/json" };
    const init = { method, headers, redirect: "manual" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["X-Disable-Provenance"] = "true";
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(url, init);
    if (!response.ok && response.status !== 404) {
      throw new Error(`Grafana ${method} ${apiPath} failed with HTTP ${response.status}`);
    }
    if (response.status === 404) {
      return { status: 404, body: null };
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  return {
    getAlertRule: (uid) => request("GET", `/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`),
    createAlertRule: (body) => request("POST", "/api/v1/provisioning/alert-rules", body),
    getPrometheusRules: () => request("GET", "/api/prometheus/grafana/api/v1/rules"),
  };
}

export async function ensureRules(client, overlay) {
  const results = {};
  for (const rule of overlay.rules) {
    const existing = await client.getAlertRule(rule.uid);
    if (existing.status === 404) {
      const qm = rule.queryModel;
      await client.createAlertRule({
        uid: rule.uid,
        title: qm.title,
        ruleGroup: qm.ruleGroup,
        folderUID: qm.folderUID,
        condition: qm.condition,
        data: qm.data,
        noDataState: qm.noDataState,
        execErrState: qm.execErrState,
        for: qm.for,
        labels: rule.labels,
        annotations: rule.annotations,
        isPaused: qm.isPaused ?? false,
      });
      results[rule.uid] = "created";
    } else {
      const liveChecksum = queryChecksum(existing.body);
      if (liveChecksum !== rule.queryChecksum) {
        throw new Error(
          `Rule ${rule.uid} exists live but has drifted from the checked-in sli-alerts overlay ` +
            "(never overwritten automatically; reconcile by hand).",
        );
      }
      results[rule.uid] = "present";
    }
  }
  return results;
}

export async function runApply({ client, repoRoot = REPO_ROOT } = {}) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  const rules = await ensureRules(client, overlay);
  return { rules };
}

export async function runVerify({ client, repoRoot = REPO_ROOT } = {}) {
  const overlay = loadOverlay(repoRoot);
  const live = await Promise.all(overlay.rules.map((r) => client.getAlertRule(r.uid)));
  const checksums = {};
  for (let i = 0; i < overlay.rules.length; i += 1) {
    const rule = overlay.rules[i];
    const body = live[i].body;
    checksums[rule.uid] = body ? (queryChecksum(body) === rule.queryChecksum ? "match" : "MISMATCH") : "MISSING";
  }
  const promRules = await client.getPrometheusRules();
  const group = (promRules.body?.data?.groups || []).find((g) => g.name === RULE_GROUP);
  const health = {};
  for (const r of group?.rules || []) {
    health[r.name] = { health: r.health, state: r.state };
  }
  return { checksums, health };
}

function buildLiveClient() {
  return createClient({ tokenProvider: () => adminTokenProvider() });
}

function printBoundedReadback(result) {
  safeLog("read-back:");
  for (const [uid, state] of Object.entries(result.checksums || {})) {
    safeLog(`  ${uid} ${state}`);
  }
  for (const [title, h] of Object.entries(result.health || {})) {
    safeLog(`  "${title}" health=${h.health} state=${h.state}`);
  }
}

async function main() {
  const command = process.argv[2] || "";
  switch (command) {
    case "check": {
      runCheck();
      safeLog(`check passed: ${RULE_GROUP} overlay is internally consistent.`);
      return;
    }
    case "apply": {
      assertLiveAllowed();
      const client = buildLiveClient();
      const result = await runApply({ client });
      safeLog("apply result:", JSON.stringify(result));
      return;
    }
    case "verify": {
      assertLiveAllowed();
      const client = buildLiveClient();
      const result = await runVerify({ client });
      printBoundedReadback(result);
      return;
    }
    default:
      throw new Error("Usage: grafana-sli-alerts.mjs <check|apply|verify>");
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}

export { canonicalize, sha256 };
