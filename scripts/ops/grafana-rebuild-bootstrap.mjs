#!/usr/bin/env node

// Operator tooling for the NEW Grafana workspace (`proliferate-ops-rebuild`,
// id g-48655e6419), separate and independent from the OLD-workspace-only
// scripts/ops/grafana-alerting.mjs (which is hard-pinned to the OLD workspace
// g-e532d030d8 and can only overlay labels/annotations onto rules that
// already exist there -- it structurally cannot create a rule or an email/SNS
// contact point, and does not target this workspace).
//
// Contract: guides/operating/production-alerts.md (new-workspace section).
// `check` is offline. `apply` and `verify` are live and refuse the network
// unless GRAFANA_ALERTING_LIVE=1. Every write is idempotent: it verifies
// current state first and only creates what is missing; if something already
// exists but has drifted from the checked-in definition, it fails loudly
// rather than silently overwriting.
//
// Why this workspace needed more than a rule re-apply (discovered live,
// 2026-08-21): the workspace had `unifiedAlerting.enabled: false`
// (`aws grafana describe-workspace-configuration`), which blocks the entire
// alert-rules/contact-points/policies provisioning surface regardless of data
// source state. It also has no native Grafana "email" contact-point type
// available (AMG returns `no secrets configured for type 'email'`; AMG's
// supported path is SNS, and both this workspace's and the OLD workspace's
// IAM roles are already scoped to publish to one specific existing topic,
// arn:aws:sns:us-east-1:157466816238:grafana-proliferate-ops-alerts, which
// already carries a CONFIRMED email subscription for pablo@pablohansen.com).
// Both of those are workspace/account-level prerequisites this script does
// not attempt to fix; see guides/operating/production-alerts.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  KNOWN_RULES,
  KNOWN_UIDS,
  LOG_RULE_UID,
  ALLOWED_LABEL_KEYS,
  ALLOWED_ANNOTATION_KEYS,
  assertApprovedMetadata,
  assertLogAnnotationsOnlyOnLogRule,
  queryChecksum,
  redact,
} from "./grafana-alerting.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const OVERLAY_REL = "server/infra/observability/grafana/production-alerts-rebuild.json";
const DASHBOARD_REL = "server/infra/observability/grafana/production-overview-dashboard.json";

// Fixed new-workspace target. A different constant from grafana-client.mjs's
// TARGET (the OLD workspace) on purpose -- these two tools must never be able
// to write to each other's workspace.
export const NEW_TARGET = Object.freeze({
  awsAccount: "157466816238",
  awsRegion: "us-east-1",
  grafanaWorkspaceId: "g-48655e6419",
  grafanaWorkspaceName: "proliferate-ops-rebuild",
  grafanaVersion: "10.4",
});

export const WORKSPACE_BASE_URL = `https://${NEW_TARGET.grafanaWorkspaceId}.grafana-workspace.${NEW_TARGET.awsRegion}.amazonaws.com`;

// Deliberately a different file from the OLD workspace's
// ~/.proliferate-local/ops/grafana-admin.token. ADMIN role, minted via
// `aws grafana create-workspace-service-account[-token]` (not through a
// browser SSO session), scoped only to this workspace.
export const ADMIN_TOKEN_PATH = path.join(
  os.homedir(),
  ".proliferate-local/ops/grafana-admin-rebuild.token",
);
export const OBSERVABILITY_KEYS_PATH = path.join(
  os.homedir(),
  ".proliferate-local/observability-keys.env",
);

const SLACK_WEBHOOK_ENV = "SLACK_ALERTS_WEBHOOK_URL";
const SIGN_IN_RULE_UID = "ffvtx33lbo5c0e";
const SLACK_RULE_UIDS = Object.freeze([...KNOWN_UIDS, SIGN_IN_RULE_UID]);
const DEFAULT_GROUP_BY = Object.freeze(["grafana_folder", "alertname"]);
const SLACK_TITLE = "{{ template \"slack.default.title\" . }}";
const SLACK_TEXT = "{{ template \"slack.default.text\" . }}";

function safeLog(...parts) {
  console.log(parts.map((p) => redact(String(p))).join(" "));
}

export function loadOverlay(repoRoot = REPO_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, OVERLAY_REL), "utf8"));
}

export function loadDashboard(repoRoot = REPO_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, DASHBOARD_REL), "utf8"));
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

// Full offline validation of the checked-in rebuild overlay: target pins to
// the NEW workspace, the rule set is exactly the current (post-retirement)
// five-rule allowlist shared with the OLD-workspace tool, every checksum
// reproduces from its own queryModel, labels/annotations pass the same
// approved-metadata + log-annotation-scoping rules as the OLD workspace, and
// the CloudWatch datasource stanza used by each rule matches the declared
// dataSource.uid (catches a rule accidentally left pointing at the OLD
// workspace's datasource uid, or at no datasource at all).
export function validateOverlayDocument(overlay) {
  verifyTarget(overlay.target);
  if (overlay.component !== "proliferate-server") {
    throw new Error("Overlay component must be proliferate-server");
  }
  const rules = overlay.rules || [];
  const uids = rules.map((r) => r.uid);
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
    throw new Error(`Rebuild overlay is missing known rules: ${missing.join(", ")}`);
  }
  const dsUid = overlay.dataSource?.uid;
  if (!dsUid) {
    throw new Error("Overlay is missing dataSource.uid");
  }
  for (const rule of rules) {
    assertApprovedMetadata(rule);
    const qm = rule.queryModel;
    if (!qm || typeof qm !== "object") {
      throw new Error(`Rule ${rule.uid} is missing its queryModel`);
    }
    if (qm.title !== rule.title) {
      throw new Error(`Rule ${rule.uid} queryModel title does not match its identity title`);
    }
    if (qm.folderUID !== overlay.folder?.uid) {
      throw new Error(`Rule ${rule.uid} queryModel folderUID does not match overlay.folder.uid`);
    }
    const expected = queryChecksum(qm);
    if (rule.queryChecksum !== expected) {
      throw new Error(`Rule ${rule.uid} queryChecksum does not match its queryModel`);
    }
    for (const stanza of qm.data || []) {
      if (stanza.datasourceUid && stanza.datasourceUid !== "__expr__" && stanza.datasourceUid !== dsUid) {
        throw new Error(
          `Rule ${rule.uid} query stanza ${stanza.refId} points at datasourceUid ${stanza.datasourceUid}, expected ${dsUid}`,
        );
      }
    }
  }
  assertLogAnnotationsOnlyOnLogRule(
    rules.map((r) => ({ uid: r.uid, annotations: r.annotations })),
  );
  if (!overlay.notificationPolicy?.receiver) {
    throw new Error("Overlay is missing notificationPolicy.receiver");
  }
  if (overlay.contactPoint?.name !== overlay.notificationPolicy.receiver) {
    throw new Error("Overlay contactPoint.name must equal notificationPolicy.receiver (the root route target)");
  }
  if (overlay.contactPoint?.type !== "sns") {
    throw new Error("Overlay contactPoint.type must be sns (AMG has no usable native email contact-point type)");
  }
  if (overlay.contactPoint?.uid !== "bfvtw9if8c3cwd" || overlay.contactPoint?.integrationName !== "sns receiver" ||
      overlay.contactPoint?.disableResolveMessage !== false) {
    throw new Error("Overlay must pin the exact existing default SNS integration identity");
  }
  if (!/^arn:aws:sns:/.test(overlay.contactPoint?.settings?.topic || "")) {
    throw new Error("Overlay contactPoint.settings.topic must be a real SNS topic ARN, not the AMG placeholder");
  }
  if (overlay.slackContactPoint?.uid !== "efvuhlsl31mo0e" ||
      overlay.slackContactPoint?.name !== "grafana-default-sns" ||
      overlay.slackContactPoint?.partialName !== "sns receiver" ||
      overlay.slackContactPoint?.type !== "slack" ||
      overlay.slackContactPoint?.receiver !== overlay.contactPoint.name ||
      overlay.slackContactPoint?.legacyName !== "grafana-rebuild-slack" ||
      overlay.slackContactPoint?.legacyUid !== "dfvuf540l7ym8d" ||
      overlay.slackContactPoint?.testReceiverName !== "grafana-rebuild-slack-test") {
    throw new Error("Overlay must define the Slack integration inside the fixed default SNS receiver");
  }
  if (overlay.slackContactPoint?.webhookEnvironmentVariable !== SLACK_WEBHOOK_ENV) {
    throw new Error(`Overlay Slack webhook must be supplied only by ${SLACK_WEBHOOK_ENV}`);
  }
  assertCheckedInPolicy(overlay);
  return true;
}

export function runCheck({ repoRoot = REPO_ROOT } = {}) {
  const overlay = loadOverlay(repoRoot);
  const dashboard = loadDashboard(repoRoot);
  validateOverlayDocument(overlay);
  if (dashboard.folderUid !== overlay.folder?.uid) {
    throw new Error("Dashboard folderUid does not match overlay.folder.uid");
  }
  if (dashboard.dashboard?.uid !== overlay.dashboard?.uid) {
    throw new Error("Dashboard uid does not match overlay.dashboard.uid");
  }
  return { overlay, dashboard };
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

function assertMode0600(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at its named 0600 path (${filePath})`);
  }
  const mode = fs.statSync(filePath).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`${label} must be mode 0600`);
  }
}

export function assertSlackCredentialModes({
  adminTokenPath = ADMIN_TOKEN_PATH,
  observabilityKeysPath = OBSERVABILITY_KEYS_PATH,
} = {}) {
  assertMode0600(adminTokenPath, "Admin token file");
  assertMode0600(observabilityKeysPath, "Observability keys file");
  return true;
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
    getFolder: (uid) => request("GET", `/api/folders/${encodeURIComponent(uid)}`),
    createFolder: (uid, title) => request("POST", "/api/folders", { uid, title }),
    listDatasources: () => request("GET", "/api/datasources"),
    createDatasource: (body) => request("POST", "/api/datasources", body),
    getDatasourceHealth: (uid) => request("GET", `/api/datasources/uid/${encodeURIComponent(uid)}/health`),
    getAlertRule: (uid) => request("GET", `/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`),
    createAlertRule: (body) => request("POST", "/api/v1/provisioning/alert-rules", body),
    getAlertmanagerConfig: () => request("GET", "/api/alertmanager/grafana/config/api/v1/alerts"),
    postAlertmanagerConfig: (body) => request("POST", "/api/alertmanager/grafana/config/api/v1/alerts", body),
    listContactPoints: () => request("GET", "/api/v1/provisioning/contact-points"),
    updateContactPoint: (uid, body) => request("PUT", `/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`, body),
    deleteContactPoint: (uid) => request("DELETE", `/api/v1/provisioning/contact-points/${encodeURIComponent(uid)}`),
    testReceiver: (body) => request("POST", "/api/alertmanager/grafana/config/api/v1/receivers/test", body),
    getDashboard: (uid) => request("GET", `/api/dashboards/uid/${encodeURIComponent(uid)}`),
    createDashboard: (body) => request("POST", "/api/dashboards/db", body),
  };
}

export async function ensureFolder(client, overlay) {
  const existing = await client.getFolder(overlay.folder.uid);
  if (existing.status === 404) {
    await client.createFolder(overlay.folder.uid, overlay.folder.title);
    return "created";
  }
  if (existing.body.title !== overlay.folder.title) {
    throw new Error(
      `Folder ${overlay.folder.uid} exists with title "${existing.body.title}", expected "${overlay.folder.title}"`,
    );
  }
  return "present";
}

export async function ensureDatasource(client, overlay) {
  const list = await client.listDatasources();
  const found = (list.body || []).find((d) => d.uid === overlay.dataSource.uid);
  if (!found) {
    await client.createDatasource({
      name: "CloudWatch",
      type: overlay.dataSource.type,
      access: "proxy",
      isDefault: true,
      jsonData: { authType: overlay.dataSource.authType, defaultRegion: overlay.dataSource.defaultRegion },
    });
  } else if (found.type !== overlay.dataSource.type || found.jsonData?.authType !== overlay.dataSource.authType) {
    throw new Error(`Datasource ${overlay.dataSource.uid} exists but does not match the expected shape`);
  }
  const health = await client.getDatasourceHealth(overlay.dataSource.uid);
  if (health.body?.status !== "OK") {
    throw new Error(`Datasource ${overlay.dataSource.uid} health check did not return OK`);
  }
  return found ? "present" : "created";
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
          `Rule ${rule.uid} exists live but has drifted from the checked-in rebuild overlay ` +
            "(never overwritten automatically; reconcile by hand).",
        );
      }
      results[rule.uid] = "present";
    }
  }
  return results;
}

// Repoints the existing default SNS receiver at the real topic ARN if it is
// still on the AMG placeholder, and confirms the root route already sends to
// it. Never creates a second receiver, never touches the route tree: the only
// mutable field is the one receiver's settings.topic.
export async function ensureContactRouting(client, overlay) {
  const before = await client.getAlertmanagerConfig();
  const am = before.body.alertmanager_config;
  if (am.route?.receiver !== overlay.notificationPolicy.receiver) {
    throw new Error(
      `Root route receiver is "${am.route?.receiver}", expected "${overlay.notificationPolicy.receiver}"; ` +
        "refusing to change routing (out of scope for this script).",
    );
  }
  const receiver = (am.receivers || []).find((r) => r.name === overlay.contactPoint.name);
  if (!receiver) {
    throw new Error(`Receiver ${overlay.contactPoint.name} not found; refusing to create a new receiver here`);
  }
  const cfg = receiver.grafana_managed_receiver_configs?.[0];
  if (!cfg || cfg.type !== overlay.contactPoint.type) {
    throw new Error(`Receiver ${overlay.contactPoint.name} is not of type ${overlay.contactPoint.type}`);
  }
  if (cfg.settings?.topic === overlay.contactPoint.settings.topic) {
    return "present";
  }
  const next = JSON.parse(JSON.stringify(before.body));
  const nextReceiver = next.alertmanager_config.receivers.find((r) => r.name === overlay.contactPoint.name);
  nextReceiver.grafana_managed_receiver_configs[0].settings.topic = overlay.contactPoint.settings.topic;
  await client.postAlertmanagerConfig(next);
  const after = await client.getAlertmanagerConfig();
  const afterCfg = after.body.alertmanager_config.receivers
    .find((r) => r.name === overlay.contactPoint.name)
    ?.grafana_managed_receiver_configs?.[0];
  if (afterCfg?.settings?.topic !== overlay.contactPoint.settings.topic) {
    throw new Error("Post-write verification failed: contact point topic did not stick");
  }
  return "repointed";
}

function slackWebhook(env = process.env) {
  const webhook = env[SLACK_WEBHOOK_ENV];
  if (!webhook) {
    throw new Error(`${SLACK_WEBHOOK_ENV} must be present for a live Slack operation`);
  }
  let url;
  try {
    url = new URL(webhook);
  } catch {
    throw new Error(`${SLACK_WEBHOOK_ENV} must be a valid Slack incoming-webhook URL`);
  }
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/")) {
    throw new Error(`${SLACK_WEBHOOK_ENV} must be an https://hooks.slack.com/services/... URL`);
  }
  return webhook;
}

function slackPayload(overlay, webhook, name = overlay.slackContactPoint.name) {
  return {
    uid: overlay.slackContactPoint.uid,
    name,
    type: "slack",
    disableResolveMessage: false,
    settings: {
      url: webhook,
      title: SLACK_TITLE,
      text: SLACK_TEXT,
    },
  };
}

function oneByName(receivers, name) {
  const matches = (receivers || []).filter((receiver) => receiver.name === name);
  if (matches.length > 1) {
    throw new Error(`Receiver group ${name} is ambiguous`);
  }
  return matches[0] || null;
}

function canonicalGeneratedRoute(receiverName) {
  return {
    receiver: receiverName,
    group_by: [...DEFAULT_GROUP_BY],
    object_matchers: [["__grafana_receiver__", "=", receiverName]],
  };
}

function canonicalAutogeneratedWrapper(overlay, children) {
  return {
    receiver: overlay.contactPoint.name,
    object_matchers: [["__grafana_autogenerated__", "=", "true"]],
    routes: children.map(canonicalGeneratedRoute),
  };
}

function canonicalPolicyForPhase(overlay, phase) {
  const children = phase === "original"
    ? [
        overlay.slackContactPoint.partialName,
        overlay.slackContactPoint.legacyName,
        overlay.contactPoint.name,
      ]
    : phase === "combined"
      ? [overlay.slackContactPoint.legacyName, overlay.contactPoint.name]
      : phase === "final"
        ? [overlay.contactPoint.name]
        : null;
  if (!children) throw new Error(`Unknown Slack reconciliation phase: ${phase}`);
  return {
    receiver: overlay.contactPoint.name,
    group_by: [...DEFAULT_GROUP_BY],
    routes: [canonicalAutogeneratedWrapper(overlay, children)],
  };
}

function assertCheckedInPolicy(overlay) {
  const expected = canonicalPolicyForPhase(overlay, "final");
  if (!isDeepStrictEqual(overlay.notificationPolicy, expected)) {
    throw new Error("Checked-in notification policy must pin the exact canonical final AMG route tree");
  }
}

function assertPhasePolicy(route, overlay, phase) {
  const expected = canonicalPolicyForPhase(overlay, phase);
  if (!isDeepStrictEqual(route, expected)) {
    throw new Error(`Notification policy is not the exact canonical ${phase} route tree`);
  }
}

function routeWithoutGeneratedReceiver(route, receiverName) {
  const clone = structuredClone(route);
  let removed = 0;
  function visit(node) {
    if (!Array.isArray(node.routes)) return;
    const next = [];
    for (const child of node.routes) {
      if (child.receiver === receiverName) {
        if (!isDeepStrictEqual(child, canonicalGeneratedRoute(receiverName))) {
          throw new Error(`Generated route for ${receiverName} is drifted`);
        }
        removed += 1;
      } else {
        visit(child);
        next.push(child);
      }
    }
    node.routes = next;
  }
  visit(clone);
  if (removed !== 1) {
    throw new Error(`Expected exactly one generated route for ${receiverName}, found ${removed}`);
  }
  return clone;
}

function assertSnsConfig(config, overlay) {
  const expected = {
    type: overlay.contactPoint.type,
    uid: overlay.contactPoint.uid,
    name: overlay.contactPoint.integrationName,
    disableResolveMessage: overlay.contactPoint.disableResolveMessage,
    secureFields: {},
    settings: overlay.contactPoint.settings,
  };
  if (!isDeepStrictEqual(config, expected)) {
    throw new Error("Default SNS receiver configuration is missing or drifted");
  }
}

function assertSlackConfig(config, uid, name) {
  const expected = {
    uid,
    name,
    type: "slack",
    disableResolveMessage: false,
    secureFields: { url: true },
    settings: { title: SLACK_TITLE, text: SLACK_TEXT },
  };
  if (!isDeepStrictEqual(config, expected)) {
    throw new Error(`Slack receiver config ${uid} is missing or drifted`);
  }
}

function contactWithoutStableProvenance(contact) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return contact;
  const normalized = structuredClone(contact);
  if (Object.hasOwn(normalized, "provenance")) {
    if (normalized.provenance !== "api" && normalized.provenance !== "") {
      throw new Error("Provisioning contact has unexpected provenance");
    }
    delete normalized.provenance;
  }
  return normalized;
}

function assertSnsProvisioningContact(contact, overlay) {
  const expected = {
    uid: overlay.contactPoint.uid,
    name: overlay.contactPoint.integrationName,
    type: overlay.contactPoint.type,
    disableResolveMessage: overlay.contactPoint.disableResolveMessage,
    settings: overlay.contactPoint.settings,
    secureFields: {},
  };
  if (!isDeepStrictEqual(contactWithoutStableProvenance(contact), expected)) {
    throw new Error("Default SNS provisioning contact is missing or drifted");
  }
}

function assertProvisioningContact(contact, uid, name) {
  const expected = {
    uid,
    name,
    type: "slack",
    disableResolveMessage: false,
    settings: { title: SLACK_TITLE, text: SLACK_TEXT },
    secureFields: { url: true },
  };
  if (!isDeepStrictEqual(contactWithoutStableProvenance(contact), expected)) {
    throw new Error(`Slack provisioning contact ${uid} is missing or drifted`);
  }
}

function classifyContacts(points, overlay) {
  const contacts = points || [];
  const sns = contacts.filter((point) => point.uid === overlay.contactPoint.uid);
  if (sns.length !== 1) {
    throw new Error("Default SNS provisioning contact is missing or ambiguous");
  }
  assertSnsProvisioningContact(sns[0], overlay);
  const slack = contacts.filter((point) => point.type === "slack");
  const allowed = new Set([overlay.slackContactPoint.uid, overlay.slackContactPoint.legacyUid]);
  if (slack.some((point) => !allowed.has(point.uid))) {
    throw new Error("Unexpected Slack provisioning contact exists");
  }
  const target = slack.filter((point) => point.uid === overlay.slackContactPoint.uid);
  const legacy = slack.filter((point) => point.uid === overlay.slackContactPoint.legacyUid);
  if (target.length !== 1 || legacy.length > 1 || slack.length !== target.length + legacy.length) {
    throw new Error("Slack provisioning contact state is missing, duplicate, or ambiguous");
  }
  return { sns: sns[0], target: target[0], legacy: legacy[0] || null };
}

function assertRulesUnrouted(ruleReadbacks) {
  if (ruleReadbacks.length !== SLACK_RULE_UIDS.length) {
    throw new Error("Expected six Grafana rule readbacks");
  }
  for (let index = 0; index < SLACK_RULE_UIDS.length; index += 1) {
    const uid = SLACK_RULE_UIDS[index];
    const readback = ruleReadbacks[index];
    if (readback.status === 404 || !readback.body) {
      throw new Error(`Grafana rule ${uid} is missing`);
    }
    if (Object.hasOwn(readback.body, "notification_settings")) {
      throw new Error(`Grafana rule ${uid} has notification_settings; default routing is no longer authoritative`);
    }
  }
}

async function readSlackState(client) {
  const [contacts, config, ...rules] = await Promise.all([
    client.listContactPoints(),
    client.getAlertmanagerConfig(),
    ...SLACK_RULE_UIDS.map((uid) => client.getAlertRule(uid)),
  ]);
  if (!config.body?.alertmanager_config) {
    throw new Error("Grafana alertmanager configuration is missing");
  }
  return {
    contacts: contacts.body || [],
    am: config.body.alertmanager_config,
    rules,
  };
}

function receiverShell(receiver) {
  const clone = structuredClone(receiver);
  delete clone.grafana_managed_receiver_configs;
  return clone;
}

function assertPhase(state, overlay, phase) {
  assertRulesUnrouted(state.rules);
  assertPhasePolicy(state.am.route, overlay, phase);
  const contacts = classifyContacts(state.contacts, overlay);
  const expectedTargetName = phase === "original"
    ? overlay.slackContactPoint.partialName
    : overlay.slackContactPoint.name;
  assertProvisioningContact(contacts.target, overlay.slackContactPoint.uid, expectedTargetName);
  if (phase === "final") {
    if (contacts.legacy) throw new Error("Legacy Slack provisioning contact still exists");
  } else {
    assertProvisioningContact(
      contacts.legacy,
      overlay.slackContactPoint.legacyUid,
      overlay.slackContactPoint.legacyName,
    );
  }

  const defaultReceiver = oneByName(state.am.receivers, overlay.contactPoint.name);
  if (!defaultReceiver) throw new Error("Default SNS receiver is missing");
  const defaultConfigs = defaultReceiver.grafana_managed_receiver_configs || [];
  const snsConfigs = defaultConfigs.filter((entry) => entry.type === "sns");
  const slackConfigs = defaultConfigs.filter((entry) => entry.type === "slack");
  if (snsConfigs.length !== 1) throw new Error("Default SNS receiver must contain exactly one SNS config");
  assertSnsConfig(snsConfigs[0], overlay);
  if (phase === "original") {
    if (defaultConfigs.length !== 1 || slackConfigs.length !== 0) {
      throw new Error("Default SNS receiver must not contain Slack before reconciliation");
    }
  } else {
    if (defaultConfigs.length !== 2 || slackConfigs.length !== 1) {
      throw new Error("Default receiver must contain exactly the SNS and reconciled Slack configs");
    }
    assertSlackConfig(slackConfigs[0], overlay.slackContactPoint.uid, overlay.slackContactPoint.name);
  }

  const partialReceiver = oneByName(state.am.receivers, overlay.slackContactPoint.partialName);
  const partialConfigs = partialReceiver?.grafana_managed_receiver_configs || [];
  const legacyReceiver = oneByName(state.am.receivers, overlay.slackContactPoint.legacyName);
  const legacyConfigs = legacyReceiver?.grafana_managed_receiver_configs || [];
  if (phase === "original") {
    if (partialConfigs.length !== 1) throw new Error("Partial standalone Slack receiver is missing or ambiguous");
    assertSlackConfig(partialConfigs[0], overlay.slackContactPoint.uid, overlay.slackContactPoint.partialName);
  } else if (partialConfigs.length !== 0) {
    throw new Error("Partial standalone Slack receiver is not empty after reconciliation");
  }
  if (phase === "final") {
    if (legacyConfigs.length !== 0) throw new Error("Legacy standalone Slack receiver still exists");
  } else {
    if (legacyConfigs.length !== 1) throw new Error("Legacy standalone Slack receiver is missing or ambiguous");
    assertSlackConfig(legacyConfigs[0], overlay.slackContactPoint.legacyUid, overlay.slackContactPoint.legacyName);
  }

  const expectedSlackCount = phase === "original" ? 2 : phase === "combined" ? 2 : 1;
  const allSlack = (state.am.receivers || []).flatMap(
    (receiver) => (receiver.grafana_managed_receiver_configs || []).filter((entry) => entry.type === "slack"),
  );
  if (allSlack.length !== expectedSlackCount) {
    throw new Error("Unexpected, duplicate, or missing Slack receiver config exists");
  }
  return {
    contacts,
    defaultReceiver,
    snsConfig: structuredClone(snsConfigs[0]),
    route: structuredClone(state.am.route),
  };
}

function receiverMapWithout(state, names) {
  return new Map((state.am.receivers || [])
    .filter((receiver) => !names.has(receiver.name))
    .map((receiver) => [receiver.name, structuredClone(receiver)]));
}

function assertTransitionPreserved(before, after, overlay, removedName) {
  const expectedRoute = routeWithoutGeneratedReceiver(before.am.route, removedName);
  if (!isDeepStrictEqual(after.am.route, expectedRoute)) {
    throw new Error("Generated route normalization changed more than the migrated standalone child");
  }
  const excluded = new Set([overlay.contactPoint.name, removedName]);
  const beforeUnowned = receiverMapWithout(before, excluded);
  const afterUnowned = receiverMapWithout(after, excluded);
  if (!isDeepStrictEqual(afterUnowned, beforeUnowned)) {
    throw new Error("An unowned receiver changed during Slack reconciliation");
  }
  const beforeDefault = oneByName(before.am.receivers, overlay.contactPoint.name);
  const afterDefault = oneByName(after.am.receivers, overlay.contactPoint.name);
  if (!isDeepStrictEqual(receiverShell(afterDefault), receiverShell(beforeDefault))) {
    throw new Error("Default receiver metadata changed during Slack reconciliation");
  }
  const beforeSns = (beforeDefault.grafana_managed_receiver_configs || []).find((entry) => entry.type === "sns");
  const afterSns = (afterDefault.grafana_managed_receiver_configs || []).find((entry) => entry.type === "sns");
  if (!isDeepStrictEqual(afterSns, beforeSns)) {
    throw new Error("Exact SNS integration changed during Slack reconciliation");
  }
}

function phaseForState(state, overlay) {
  const contacts = classifyContacts(state.contacts, overlay);
  if (contacts.target.name === overlay.slackContactPoint.partialName && contacts.legacy) return "original";
  if (contacts.target.name === overlay.slackContactPoint.name && contacts.legacy) return "combined";
  if (contacts.target.name === overlay.slackContactPoint.name && !contacts.legacy) return "final";
  throw new Error("Slack reconciliation state is not an exact original, combined, or final state");
}

function testPayload(overlay, webhook) {
  return {
    receivers: [{
      name: overlay.slackContactPoint.testReceiverName,
      grafana_managed_receiver_configs: [slackPayload(overlay, webhook)],
    }],
  };
}

async function requireSlackTestOk(client, overlay, webhook) {
  const result = await client.testReceiver(testPayload(overlay, webhook));
  if (result.status !== 200) {
    throw new Error(`Grafana Slack receiver test returned HTTP ${result.status}, expected 200`);
  }
  const receiver = result.body?.receivers?.[0];
  const configs = receiver?.configs || receiver?.grafana_managed_receiver_configs || [];
  if (configs.length !== 1 || configs[0].uid !== overlay.slackContactPoint.uid || configs[0].status !== "ok") {
    throw new Error("Grafana Slack test delivery did not report status ok for the reconciled UID");
  }
  return true;
}

async function rollbackToOriginal(client, overlay, webhook, cause, baseline) {
  try {
    const response = await client.updateContactPoint(
      overlay.slackContactPoint.uid,
      slackPayload(overlay, webhook, overlay.slackContactPoint.partialName),
    );
    if (response.status !== 202) {
      throw new Error(`Grafana rollback PUT returned HTTP ${response.status}, expected 202`);
    }
  } catch {
    // A lost PUT response is resolved only by the exact readback below.
  }
  const restored = await readSlackState(client);
  try {
    assertPhase(restored, overlay, "original");
    if (baseline?.phase === "original") {
      if (!isDeepStrictEqual(restored.am.route, baseline.state.am.route)) {
        throw new Error("Rollback did not restore the exact original generated route tree");
      }
      const excluded = new Set([
        overlay.contactPoint.name,
        overlay.slackContactPoint.partialName,
      ]);
      if (!isDeepStrictEqual(
        receiverMapWithout(restored, excluded),
        receiverMapWithout(baseline.state, excluded),
      )) {
        throw new Error("Rollback changed an unowned receiver");
      }
    }
  } catch (rollbackError) {
    throw new Error(
      `Slack reconciliation failed and rollback did not restore the exact original state: ${rollbackError.message}`,
      { cause },
    );
  }
  throw new Error(`Slack reconciliation failed and was rolled back: ${cause.message}`, { cause });
}

// AMG's provisioning `name` selects the outer receiver group. Reconcile the
// exact existing partial UID by PUT; never create a new contact point or write
// the notification policy. Deletion is authorized only after exact structural
// readback and an isolated Slack-only test succeeds.
export async function ensureCombinedSlackContact(client, overlay, { env = process.env } = {}) {
  const webhook = slackWebhook(env);
  const before = await readSlackState(client);
  const phase = phaseForState(before, overlay);
  assertPhase(before, overlay, phase);
  const baseline = { phase, state: before };

  if (phase === "final") {
    return {
      contactPoint: "present",
      testDelivery: "already-proven",
      legacyMigration: "not-needed",
      uid: overlay.slackContactPoint.uid,
    };
  }

  let combined = before;
  let contactPoint = "present";
  if (phase === "original") {
    let putError = null;
    try {
      const response = await client.updateContactPoint(
        overlay.slackContactPoint.uid,
        slackPayload(overlay, webhook),
      );
      if (response.status !== 202) {
        throw new Error(`Grafana contact-point PUT returned HTTP ${response.status}, expected 202`);
      }
    } catch (error) {
      putError = error;
    }
    combined = await readSlackState(client);
    try {
      assertPhase(combined, overlay, "combined");
      assertTransitionPreserved(before, combined, overlay, overlay.slackContactPoint.partialName);
    } catch (verificationError) {
      try {
        assertPhase(combined, overlay, "original");
        if (putError) throw putError;
      } catch (originalError) {
        if (originalError === putError) throw putError;
      }
      return rollbackToOriginal(client, overlay, webhook, verificationError, baseline);
    }
    contactPoint = putError ? "updated-after-response-loss" : "updated";
  }

  try {
    await requireSlackTestOk(client, overlay, webhook);
  } catch (testError) {
    return rollbackToOriginal(client, overlay, webhook, testError, baseline);
  }

  let deleteError = null;
  try {
    const response = await client.deleteContactPoint(overlay.slackContactPoint.legacyUid);
    if (response.status !== 202) {
      throw new Error(`Grafana legacy DELETE returned HTTP ${response.status}, expected 202`);
    }
  } catch (error) {
    deleteError = error;
  }
  const final = await readSlackState(client);
  try {
    assertPhase(final, overlay, "final");
    assertTransitionPreserved(combined, final, overlay, overlay.slackContactPoint.legacyName);
  } catch (verificationError) {
    try {
      assertPhase(final, overlay, "combined");
      if (deleteError) throw deleteError;
    } catch (combinedError) {
      if (combinedError === deleteError) throw deleteError;
    }
    throw new Error(`Final Slack reconciliation readback failed: ${verificationError.message}`, {
      cause: verificationError,
    });
  }
  return {
    contactPoint,
    testDelivery: "ok",
    legacyMigration: deleteError ? "removed-after-response-loss" : "removed",
    uid: overlay.slackContactPoint.uid,
  };
}

function prepareSlackCommand(repoRoot, env, credentialModeCheck) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  const webhook = slackWebhook(env);
  credentialModeCheck();
  return { overlay, webhook };
}

export async function runSlackApply({
  client,
  repoRoot = REPO_ROOT,
  env = process.env,
  credentialModeCheck = assertSlackCredentialModes,
} = {}) {
  const { overlay } = prepareSlackCommand(repoRoot, env, credentialModeCheck);
  return ensureCombinedSlackContact(client, overlay, { env });
}

export async function runSlackVerify({
  client,
  repoRoot = REPO_ROOT,
  env = process.env,
  credentialModeCheck = assertSlackCredentialModes,
} = {}) {
  const { overlay } = prepareSlackCommand(repoRoot, env, credentialModeCheck);
  const state = await readSlackState(client);
  assertPhase(state, overlay, "final");
  return { status: "verified", uid: overlay.slackContactPoint.uid };
}

export async function runSlackTest({
  client,
  repoRoot = REPO_ROOT,
  env = process.env,
  credentialModeCheck = assertSlackCredentialModes,
} = {}) {
  const { overlay, webhook } = prepareSlackCommand(repoRoot, env, credentialModeCheck);
  const state = await readSlackState(client);
  assertPhase(state, overlay, "final");
  await requireSlackTestOk(client, overlay, webhook);
  return { delivery: "ok", uid: overlay.slackContactPoint.uid };
}

export async function ensureDashboard(client, overlay, dashboard) {
  const existing = await client.getDashboard(overlay.dashboard.uid);
  if (existing.status === 404) {
    await client.createDashboard(dashboard);
    return "created";
  }
  return "present";
}

export async function runApply({ client, repoRoot = REPO_ROOT } = {}) {
  const overlay = loadOverlay(repoRoot);
  const dashboard = loadDashboard(repoRoot);
  validateOverlayDocument(overlay);
  const folder = await ensureFolder(client, overlay);
  const datasource = await ensureDatasource(client, overlay);
  const rules = await ensureRules(client, overlay);
  const contactRouting = await ensureContactRouting(client, overlay);
  const dashboardResult = await ensureDashboard(client, overlay, dashboard);
  return { folder, datasource, rules, contactRouting, dashboard: dashboardResult };
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
  const amConfig = await client.getAlertmanagerConfig();
  const receiver = (amConfig.body.alertmanager_config.receivers || []).find(
    (r) => r.name === overlay.contactPoint.name,
  );
  const topicWired = receiver?.grafana_managed_receiver_configs?.[0]?.settings?.topic === overlay.contactPoint.settings.topic;
  const dash = await client.getDashboard(overlay.dashboard.uid);
  return {
    checksums,
    routeReceiver: amConfig.body.alertmanager_config.route?.receiver,
    topicWired,
    dashboardPresent: dash.status !== 404,
  };
}

function buildLiveClient() {
  return createClient({ tokenProvider: () => adminTokenProvider() });
}

function printBoundedReadback(result) {
  safeLog("read-back:");
  for (const [uid, state] of Object.entries(result.checksums || {})) {
    safeLog(`  ${uid} ${state}`);
  }
  if ("routeReceiver" in result) {
    safeLog(`  route receiver: ${result.routeReceiver}`);
    safeLog(`  topic wired: ${result.topicWired}`);
    safeLog(`  dashboard present: ${result.dashboardPresent}`);
  }
}

async function main() {
  const command = process.argv[2] || "";
  switch (command) {
    case "check": {
      runCheck();
      safeLog("check passed: rebuild overlay + dashboard are consistent with the five-rule allowlist.");
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
    case "slack-apply": {
      assertLiveAllowed();
      const result = await runSlackApply({ client: buildLiveClient() });
      safeLog("Slack apply:", JSON.stringify(result));
      return;
    }
    case "slack-verify": {
      assertLiveAllowed();
      safeLog("Slack verify:", JSON.stringify(await runSlackVerify({ client: buildLiveClient() })));
      return;
    }
    case "slack-test": {
      assertLiveAllowed();
      safeLog("Slack test:", JSON.stringify(await runSlackTest({ client: buildLiveClient() })));
      return;
    }
    default:
      throw new Error("Usage: grafana-rebuild-bootstrap.mjs <check|apply|verify|slack-apply|slack-verify|slack-test>");
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
