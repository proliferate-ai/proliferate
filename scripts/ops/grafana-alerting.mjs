#!/usr/bin/env node

// Operator tooling for the six production Grafana alert rules and the dark
// issue-tracker webhook contact point (support-system slice E1).
// Contract: specs/codebase/systems/engineering/issue-lifecycle/grafana-rules-delivery.md
// check is offline; export/apply/restore are live and refuse the network
// unless GRAFANA_ALERTING_LIVE=1 (Phase 2, gated on slice A acceptance).
// HTTP transport lives in grafana-client.mjs (network-layer target lock).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTACT_POINT_NAME,
  TARGET,
  adminTokenProvider,
  createGrafanaClient,
  resolveWebhookSecret,
} from "./grafana-client.mjs";
import {
  REPO_ROOT,
  assertPrivateReceiptPath,
  readReceipt,
  writeReceipt,
} from "./grafana-receipts.mjs";

export { REPO_ROOT };
const OVERLAY_REL = "server/infra/observability/grafana/production-alerts.json";
const CONTACT_REL = "server/infra/observability/grafana/issue-tracker-contact.json";

// Fixed production target + tracker contact-point name are owned by
// grafana-client.mjs (single source of truth for the network target lock).
export { CONTACT_POINT_NAME, TARGET };
export const WEBHOOK_SECRET_REF = "issue-tracker/app.grafanaWebhookSecret";

// The six immutable rule identities. The one log-backed rule is flagged.
export const KNOWN_RULES = Object.freeze([
  { uid: "dfrmh7bc4yqrkf", title: "ALB 5xx > 10 in 5m", severity: "critical", log: false },
  { uid: "bfrmh7c7ecbnkb", title: "API p95 Latency > 5s for 10m", severity: "critical", log: false },
  { uid: "cfrmh7d7od8g0c", title: "ECS CPU > 90% for 15m", severity: "critical", log: false },
  { uid: "bfrmh7e7x2k8wd", title: "CRITICAL_FAILURE in prod logs", severity: "critical", log: true },
  { uid: "cfrmh7f2sbe2od", title: "Analytics ingest errors", severity: "critical", log: false },
  { uid: "cfrmh7fttw4jke", title: "Server error rate > 10 in 10m", severity: "warning", log: false },
]);
export const KNOWN_UIDS = Object.freeze(KNOWN_RULES.map((r) => r.uid));
export const LOG_RULE_UID = "bfrmh7e7x2k8wd";

export const ALLOWED_LABEL_KEYS = Object.freeze(["proliferate_rule_uid", "proliferate_component", "severity"]);
export const LOG_ANNOTATION_KEYS = Object.freeze([
  "proliferate_log_group",
  "proliferate_log_filter_pattern",
  "proliferate_log_region",
]);
export const ALLOWED_ANNOTATION_KEYS = Object.freeze(["runbook_url", ...LOG_ANNOTATION_KEYS]);

// Provider fields that carry ordering/timestamp noise and are dropped before
// hashing. The query/expression model is preserved byte-for-byte.
const VOLATILE_RULE_FIELDS = Object.freeze([
  "id", "updated", "updatedBy", "created", "version", "provenance", "namespace_id", "orgID", "orgId",
]);

// Deterministic canonical JSON: object keys recursively sorted, array order
// preserved (query model order is meaningful). Stable across key ordering and
// removed volatile/timestamp fields.
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// The query model is the alert's evaluation contract. We hash the fields that
// define behavior and placement: title, condition, the data/query stanzas,
// no-data/error handling, pending period, and group/folder placement.
export function extractQueryModel(rawRule) {
  const model = {
    title: rawRule.title,
    condition: rawRule.condition ?? null,
    data: rawRule.data ?? null,
    noDataState: rawRule.noDataState ?? null,
    execErrState: rawRule.execErrState ?? null,
    for: rawRule.for ?? null,
    ruleGroup: rawRule.ruleGroup ?? null,
    folderUID: rawRule.folderUID ?? null,
    isPaused: rawRule.isPaused ?? false,
  };
  return model;
}

export function queryChecksum(rawRule) {
  return sha256(canonicalize(extractQueryModel(rawRule)));
}

// Strip volatile fields recursively so normalized output is stable across
// provider ordering/timestamp changes.
export function normalizeRule(rawRule) {
  const clone = JSON.parse(JSON.stringify(rawRule));
  for (const field of VOLATILE_RULE_FIELDS) {
    delete clone[field];
  }
  return clone;
}

// Redaction. Applied to every console line, never to the private receipt file.
export function redact(input) {
  let text = typeof input === "string" ? input : JSON.stringify(input);
  // Full URLs (host + path can leak workspace/webhook routes).
  text = text.replace(/https?:\/\/[^\s"'`)]+/g, "<redacted-url>");
  // Bearer / Authorization values.
  text = text.replace(/(bearer\s+)\S+/gi, "$1<redacted>");
  text = text.replace(/(authorization[_-]?credentials?"?\s*[:=]\s*")[^"]*/gi, "$1<redacted>");
  // Long opaque tokens.
  text = text.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<redacted-token>");
  return text;
}

function safeLog(...parts) {
  console.log(parts.map((p) => redact(String(p))).join(" "));
}

export function verifyTarget(target) {
  const diffs = [];
  for (const key of Object.keys(TARGET)) {
    if (!target || target[key] !== TARGET[key]) {
      diffs.push(`${key}: expected ${TARGET[key]}, got ${target ? target[key] : "<missing>"}`);
    }
  }
  if (diffs.length > 0) {
    throw new Error(`Refusing to operate on a non-matching target:\n  ${diffs.join("\n  ")}`);
  }
}

export function verifyUidAllowlist(uids) {
  const seen = new Set();
  for (const uid of uids) {
    if (!KNOWN_UIDS.includes(uid)) {
      throw new Error(`Unknown rule UID (wildcard discovery is not allowed): ${uid}`);
    }
    if (seen.has(uid)) {
      throw new Error(`Duplicate rule UID: ${uid}`);
    }
    seen.add(uid);
  }
  const missing = KNOWN_UIDS.filter((uid) => !seen.has(uid));
  if (missing.length > 0) {
    throw new Error(`Expected exactly the six known UIDs; missing: ${missing.join(", ")}`);
  }
  if (seen.size !== KNOWN_UIDS.length) {
    throw new Error(`Expected exactly ${KNOWN_UIDS.length} UIDs, got ${seen.size}`);
  }
}

export function assertApprovedMetadata(rule) {
  const known = KNOWN_RULES.find((r) => r.uid === rule.uid);
  if (!known) {
    throw new Error(`Rule ${rule.uid} is not in the six-rule allowlist`);
  }
  if (rule.title !== known.title) {
    throw new Error(`Rule ${rule.uid} title mismatch: expected "${known.title}", got "${rule.title}"`);
  }
  if (rule.severity !== known.severity) {
    throw new Error(`Rule ${rule.uid} severity mismatch: expected ${known.severity}, got ${rule.severity}`);
  }
  const labels = rule.labels || {};
  const labelKeys = Object.keys(labels);
  for (const key of labelKeys) {
    if (!ALLOWED_LABEL_KEYS.includes(key)) {
      throw new Error(`Rule ${rule.uid} has an unapproved label: ${key}`);
    }
  }
  if (labels.proliferate_rule_uid !== rule.uid) {
    throw new Error(`Rule ${rule.uid} proliferate_rule_uid label must equal its UID`);
  }
  if (labels.proliferate_component !== "proliferate-server") {
    throw new Error(`Rule ${rule.uid} proliferate_component must be proliferate-server`);
  }
  if (labels.severity !== known.severity) {
    throw new Error(`Rule ${rule.uid} severity label must equal ${known.severity}`);
  }
  const annotations = rule.annotations || {};
  const annKeys = Object.keys(annotations);
  for (const key of annKeys) {
    if (!ALLOWED_ANNOTATION_KEYS.includes(key)) {
      throw new Error(`Rule ${rule.uid} has an unapproved annotation: ${key}`);
    }
  }
  if (!annotations.runbook_url) {
    throw new Error(`Rule ${rule.uid} is missing the runbook_url annotation`);
  }
}

// Only bfrmh7e7x2k8wd may carry the three log-lookup annotations.
export function assertLogAnnotationsOnlyOnLogRule(rules) {
  for (const rule of rules) {
    const annotations = rule.annotations || {};
    const hasLog = LOG_ANNOTATION_KEYS.some((k) => k in annotations);
    if (rule.uid === LOG_RULE_UID) {
      const missing = LOG_ANNOTATION_KEYS.filter((k) => !(k in annotations));
      if (missing.length > 0) {
        throw new Error(`Log rule ${LOG_RULE_UID} is missing log annotations: ${missing.join(", ")}`);
      }
      if (annotations.proliferate_log_group !== "/ecs/proliferate-prod") {
        throw new Error(`Log rule ${LOG_RULE_UID} has an unexpected log group`);
      }
      if (annotations.proliferate_log_filter_pattern !== "CRITICAL_FAILURE") {
        throw new Error(`Log rule ${LOG_RULE_UID} filter pattern must be CRITICAL_FAILURE`);
      }
      if (annotations.proliferate_log_region !== "us-east-1") {
        throw new Error(`Log rule ${LOG_RULE_UID} log region must be us-east-1`);
      }
    } else if (hasLog) {
      throw new Error(`Rule ${rule.uid} must not carry log-lookup annotations`);
    }
  }
}

export function assertContactTemplateSafe(contact) {
  const cp = contact.contactPoint;
  if (!cp) {
    throw new Error("Contact template is missing contactPoint");
  }
  if (cp.name !== CONTACT_POINT_NAME) {
    throw new Error(`Contact point name must be ${CONTACT_POINT_NAME}`);
  }
  if (cp.type !== "webhook") {
    throw new Error("Contact point must be a webhook");
  }
  const settings = cp.settings || {};
  if (settings.url !== "https://issues.proliferate.com/v1/ingest/grafana") {
    throw new Error("Contact point url is not the tracker ingest url");
  }
  if (settings.httpMethod !== "POST") {
    throw new Error("Contact point must POST");
  }
  if (settings.maxAlerts !== 0) {
    throw new Error("Contact point maxAlerts must be 0");
  }
  if (settings.authorization_scheme !== "Bearer") {
    throw new Error("Contact point auth scheme must be Bearer");
  }
  if (contact.delivery?.sendResolved !== true) {
    throw new Error("Contact point must send resolved notifications");
  }
  const secure = cp.secureSettings || {};
  const cred = secure.authorization_credentials;
  if (!cred || typeof cred !== "object" || cred.secretRef !== WEBHOOK_SECRET_REF) {
    throw new Error(`Contact point must reference ${WEBHOOK_SECRET_REF} by secretRef`);
  }
  // Nothing under the contact point may look like an inline credential value.
  const serialized = JSON.stringify(cp);
  if (/"authorization_credentials"\s*:\s*"/.test(serialized)) {
    throw new Error("Contact point contains an inline credential value, not a reference");
  }
  return true;
}

// Full offline validation of the checked-in artifacts.
export function validateOverlayDocument(overlay) {
  verifyTarget(overlay.target);
  if (overlay.component !== "proliferate-server") {
    throw new Error("Overlay component must be proliferate-server");
  }
  const rules = overlay.rules || [];
  verifyUidAllowlist(rules.map((r) => r.uid));
  for (const rule of rules) {
    assertApprovedMetadata(rule);
    // The checked-in file carries the complete safe rule definition. Its
    // checksum must reproduce from the checked-in model (drift detection works
    // from the reviewed artifact alone).
    if (!rule.queryModel || typeof rule.queryModel !== "object") {
      throw new Error(`Rule ${rule.uid} is missing its captured queryModel`);
    }
    if (rule.queryModel.title !== rule.title) {
      throw new Error(`Rule ${rule.uid} queryModel title does not match its identity title`);
    }
    const expected = sha256(canonicalize(rule.queryModel));
    if (rule.queryChecksum !== expected) {
      throw new Error(`Rule ${rule.uid} queryChecksum does not match its queryModel`);
    }
  }
  assertLogAnnotationsOnlyOnLogRule(rules);
  return true;
}

// Receipt handling lives in grafana-receipts.mjs; re-exported for callers.
export { assertPrivateReceiptPath, readReceipt, writeReceipt };

export function detectDrift(snapshotRules) {
  const mismatches = [];
  const byUid = new Map(snapshotRules.map((r) => [r.uid, r]));
  for (const known of KNOWN_RULES) {
    const live = byUid.get(known.uid);
    if (!live) {
      mismatches.push(`${known.uid}: absent from snapshot`);
      continue;
    }
    if (live.title !== known.title) {
      mismatches.push(`${known.uid}: title drift`);
    }
  }
  for (const uid of byUid.keys()) {
    if (!KNOWN_UIDS.includes(uid)) {
      mismatches.push(`${uid}: unexpected rule present`);
    }
  }
  return mismatches;
}

// Compare query checksums captured before vs after a write (must be identical).
export function assertQueryChecksumsUnchanged(before, after) {
  const drift = [];
  for (const uid of KNOWN_UIDS) {
    if (before[uid] !== after[uid]) {
      drift.push(uid);
    }
  }
  if (drift.length > 0) {
    throw new Error(`Query checksum changed for: ${drift.join(", ")}`);
  }
}

function assertLiveAllowed() {
  if (process.env.GRAFANA_ALERTING_LIVE !== "1") {
    throw new Error(
      "Live Grafana operations are Phase 2 (gated on slice A acceptance). " +
        "Set GRAFANA_ALERTING_LIVE=1 only after the access preflight is green.",
    );
  }
}

// The live client targets only the frozen TARGET workspace (URL is derived in
// grafana-client.mjs from TARGET, never from env/config) and reads the
// operator Admin token from its named 0600 path at request time.
function buildLiveClient() {
  return createGrafanaClient({ tokenProvider: () => adminTokenProvider() });
}

// Contract requirement 8: the webhook Bearer credential is read from its
// canonical secret reference (issue-tracker/app.grafanaWebhookSecret) at
// execution time and never printed.
function buildLiveSecretResolver() {
  return async (secretRef) => {
    if (secretRef !== WEBHOOK_SECRET_REF) {
      throw new Error(`Refusing to resolve a secret other than ${WEBHOOK_SECRET_REF}`);
    }
    return resolveWebhookSecret();
  };
}

// Operations. Each accepts injected deps so tests use fakes and no network.
export function runCheck({ repoRoot = REPO_ROOT, snapshotPath = null } = {}) {
  const overlay = JSON.parse(
    fs.readFileSync(path.join(repoRoot, OVERLAY_REL), "utf8"),
  );
  const contact = JSON.parse(
    fs.readFileSync(path.join(repoRoot, CONTACT_REL), "utf8"),
  );
  validateOverlayDocument(overlay);
  verifyTarget(contact.target);
  assertContactTemplateSafe(contact);

  let drift = [];
  if (snapshotPath) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const rules = snapshot.rules || snapshot.before?.rules || [];
    const rulesArray = Array.isArray(rules) ? rules : Object.values(rules);
    drift = detectDrift(rulesArray);
    if (drift.length > 0) {
      throw new Error(`Drift detected against snapshot:\n  ${drift.join("\n  ")}`);
    }
  }
  return { overlay, contact, drift };
}

// Fail-closed gate: every live rule's query checksum must equal the checked-in
// overlay checksum. Any mismatch (including a real ruler-vs-provisioning shape
// difference) stops the operation for reconciliation; it never proceeds.
export function assertLiveMatchesCheckedIn(liveRules, overlay) {
  const byUid = new Map(liveRules.map((r) => [r.uid, r]));
  const drifted = [];
  for (const rule of overlay.rules) {
    const live = byUid.get(rule.uid);
    if (!live || queryChecksum(live) !== rule.queryChecksum) {
      drifted.push(rule.uid);
    }
  }
  if (drifted.length > 0) {
    throw new Error(
      `Live rule model drifted from the checked-in definition (stop and reconcile; never proceed): ${drifted.join(", ")}`,
    );
  }
}

function loadOverlay(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, OVERLAY_REL), "utf8"));
}

// Export live rules/contacts/policy and write a private rollback receipt.
export async function runExport({ client, receiptPath, repoRoot = REPO_ROOT, now = () => new Date().toISOString() }) {
  const rawRules = await client.listAlertRules();
  const uids = rawRules.map((r) => r.uid);
  verifyUidAllowlist(uids);
  assertLiveMatchesCheckedIn(rawRules, loadOverlay(repoRoot));
  const contactPoints = await client.getContactPoints();
  const notificationPolicy = await client.getNotificationPolicy();
  // Full Alertmanager before-config for rollback context. Private (0600, never
  // committed); its secure fields are only secureFields/[REDACTED] markers.
  const alertmanagerConfig = await client.getAlertmanagerConfig();

  const normalizedRules = {};
  const checksums = {};
  for (const raw of rawRules) {
    normalizedRules[raw.uid] = normalizeRule(raw);
    checksums[raw.uid] = queryChecksum(raw);
  }

  const receipt = {
    schemaVersion: 1,
    kind: "grafana-alerting-rollback-receipt",
    createdAt: now(),
    target: { ...TARGET },
    before: {
      rules: normalizedRules,
      contactPoints,
      notificationPolicy,
      alertmanagerConfig,
    },
    checksums: {
      rules: checksums,
      notificationPolicy: sha256(canonicalize(notificationPolicy)),
    },
  };
  const resolved = writeReceipt(receiptPath, receipt, { repoRoot });
  return { receiptPath: resolved, checksums };
}

// Overlay approved metadata and create/update only the tracker contact point.
export async function runApply({ client, secretResolver, receiptPath, repoRoot = REPO_ROOT }) {
  const receipt = readReceipt(receiptPath, { repoRoot });
  verifyTarget(receipt.target);
  const overlay = loadOverlay(repoRoot);
  const contact = JSON.parse(
    fs.readFileSync(path.join(repoRoot, CONTACT_REL), "utf8"),
  );
  validateOverlayDocument(overlay);
  assertContactTemplateSafe(contact);

  const beforePolicyChecksum = sha256(canonicalize(await client.getNotificationPolicy()));
  const beforeChecksums = {};
  const afterChecksums = {};

  const live = await client.listAlertRules();
  verifyUidAllowlist(live.map((r) => r.uid));
  assertLiveMatchesCheckedIn(live, overlay);
  const liveByUid = new Map(live.map((r) => [r.uid, r]));

  for (const overlayRule of overlay.rules) {
    const current = liveByUid.get(overlayRule.uid);
    const expectedChecksum = receipt.checksums.rules[overlayRule.uid];
    const currentChecksum = queryChecksum(current);
    beforeChecksums[overlayRule.uid] = currentChecksum;
    // Hard reject on identity/query mismatch. Never recreate the rule.
    if (current.title !== overlayRule.title) {
      throw new Error(`Rule ${overlayRule.uid} title changed live; refusing to overlay`);
    }
    if (currentChecksum !== expectedChecksum) {
      throw new Error(`Rule ${overlayRule.uid} query drifted from receipt; refusing to overlay`);
    }
    // Preserve the query model byte-for-byte; overlay only labels/annotations.
    const next = JSON.parse(JSON.stringify(current));
    next.labels = { ...(current.labels || {}), ...overlayRule.labels };
    next.annotations = { ...(current.annotations || {}), ...overlayRule.annotations };
    await client.upsertAlertRule(overlayRule.uid, next);
    afterChecksums[overlayRule.uid] = queryChecksum(next);
  }
  assertQueryChecksumsUnchanged(beforeChecksums, afterChecksums);

  // Resolve the Bearer credential from its canonical reference at execution time.
  const credential = await secretResolver(WEBHOOK_SECRET_REF);
  await client.upsertContactPoint({
    name: contact.contactPoint.name,
    type: contact.contactPoint.type,
    disableResolveMessage: contact.contactPoint.disableResolveMessage,
    settings: { ...contact.contactPoint.settings },
    secureSettings: { authorization_credentials: credential },
  });

  // The notification policy must be untouched.
  const afterPolicyChecksum = sha256(canonicalize(await client.getNotificationPolicy()));
  if (beforePolicyChecksum !== afterPolicyChecksum) {
    throw new Error("Notification policy changed during apply; this operation must not mutate it");
  }

  return { beforeChecksums, afterChecksums, policyUnchanged: true };
}

export async function runRestore({ client, receiptPath, repoRoot = REPO_ROOT }) {
  const receipt = readReceipt(receiptPath, { repoRoot });
  verifyTarget(receipt.target);
  for (const [uid, rule] of Object.entries(receipt.before.rules)) {
    await client.upsertAlertRule(uid, rule);
  }
  await client.restoreContactPoints(receipt.before.contactPoints);
  return { restored: Object.keys(receipt.before.rules) };
}

// Bounded read-back output: only UIDs, metadata names, checksums, setting names.
export function printBoundedReadback({ checksums = {}, contactSettingNames = [] }) {
  safeLog("read-back:");
  for (const uid of KNOWN_UIDS) {
    const known = KNOWN_RULES.find((r) => r.uid === uid);
    const labelNames = ALLOWED_LABEL_KEYS.join(",");
    const annNames = (known.log ? ALLOWED_ANNOTATION_KEYS : ["runbook_url"]).join(",");
    safeLog(`  ${uid} checksum=${checksums[uid] || "<pending>"} labels=[${labelNames}] annotations=[${annNames}]`);
  }
  safeLog(`  contact-point ${CONTACT_POINT_NAME} settings=[${contactSettingNames.join(",")}]`);
}

function parseArgs(argv) {
  const parsed = { command: argv[0] || "", receipt: "", snapshot: "" };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--receipt") {
      parsed.receipt = argv[i + 1] || "";
      i += 1;
    } else if (argv[i] === "--snapshot") {
      parsed.snapshot = argv[i + 1] || "";
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return parsed;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "check": {
      runCheck({ snapshotPath: parsed.snapshot || null });
      safeLog("check passed: six-rule overlay + dark contact template are consistent and safe.");
      return;
    }
    case "export": {
      assertLiveAllowed();
      const client = buildLiveClient();
      const { checksums } = await runExport({ client, receiptPath: parsed.receipt });
      printBoundedReadback({ checksums });
      return;
    }
    case "apply": {
      assertLiveAllowed();
      const client = buildLiveClient();
      const result = await runApply({
        client,
        secretResolver: buildLiveSecretResolver(),
        receiptPath: parsed.receipt,
      });
      printBoundedReadback({
        checksums: result.afterChecksums,
        contactSettingNames: ["url", "httpMethod", "maxAlerts", "authorization_scheme"],
      });
      return;
    }
    case "restore": {
      assertLiveAllowed();
      const client = buildLiveClient();
      await runRestore({ client, receiptPath: parsed.receipt });
      safeLog("restore complete: before-export replayed to the locked target.");
      return;
    }
    default:
      throw new Error("Usage: grafana-alerting.mjs <check|export|apply|restore> [--receipt <path>] [--snapshot <path>]");
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
