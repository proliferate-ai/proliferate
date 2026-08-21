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

const SLACK_WEBHOOK_ENV = "SLACK_ALERTS_WEBHOOK_URL";

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
  if (overlay.slackContactPoint?.name !== "sns receiver" || overlay.slackContactPoint?.type !== "slack" ||
      overlay.slackContactPoint?.receiver !== overlay.contactPoint.name ||
      overlay.slackContactPoint?.legacyName !== "grafana-rebuild-slack" ||
      overlay.slackContactPoint?.testReceiverName !== "grafana-rebuild-slack-test") {
    throw new Error("Overlay must define the Slack integration inside the fixed default SNS receiver");
  }
  if (overlay.slackContactPoint?.webhookEnvironmentVariable !== SLACK_WEBHOOK_ENV) {
    throw new Error(`Overlay Slack webhook must be supplied only by ${SLACK_WEBHOOK_ENV}`);
  }
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
    createContactPoint: (body) => request("POST", "/api/v1/provisioning/contact-points", body),
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

function slackPayload(overlay, webhook, uid) {
  return {
    ...(uid ? { uid } : {}),
    name: overlay.slackContactPoint.name,
    type: "slack",
    disableResolveMessage: false,
    settings: {
      url: webhook,
      title: "{{ template \"slack.default.title\" . }}",
      text: "{{ template \"slack.default.text\" . }}",
    },
  };
}

function findSlackContacts(points, overlay) {
  const slack = (points || []).filter((point) => point.type === "slack");
  const target = slack.filter((point) => point.name === overlay.slackContactPoint.name);
  const legacy = slack.filter((point) => point.name === overlay.slackContactPoint.legacyName);
  const unexpected = slack.filter(
    (point) => point.name !== overlay.slackContactPoint.name && point.name !== overlay.slackContactPoint.legacyName,
  );
  if (target.length > 1 || legacy.length > 1 || unexpected.length > 0) {
    throw new Error("Slack contact-point state is duplicate, ambiguous, or contains an unexpected integration");
  }
  return { target: target[0] || null, legacy: legacy[0] || null };
}

function flattenRoutes(route) {
  if (!route) return [];
  return [route, ...(route.routes || []).flatMap(flattenRoutes)];
}

function isCanonicalLegacyRoute(route, overlay) {
  const matchers = route?.object_matchers || [];
  return route?.receiver === overlay.slackContactPoint.legacyName &&
    matchers.length === 1 &&
    isDeepStrictEqual(matchers[0], ["__grafana_receiver__", "=", overlay.slackContactPoint.legacyName]) &&
    (route.routes == null || route.routes.length === 0) &&
    route.continue !== true;
}

function assertLegacyState(am, legacyContact, overlay) {
  const receivers = (am.receivers || []).filter(
    (receiver) => receiver.name === overlay.slackContactPoint.legacyName,
  );
  const routes = flattenRoutes(am.route).filter(
    (route) => route.receiver === overlay.slackContactPoint.legacyName,
  );
  if (!legacyContact) {
    if (receivers.length !== 0 || routes.length !== 0) {
      throw new Error("Standalone Slack receiver/route exists without its provisioning contact point");
    }
    return;
  }
  if (!legacyContact.uid || receivers.length !== 1 || routes.length !== 1 ||
      !isCanonicalLegacyRoute(routes[0], overlay)) {
    throw new Error("Standalone Slack migration state is missing, duplicate, or drifted");
  }
  const configs = receivers[0].grafana_managed_receiver_configs || [];
  if (configs.length !== 1 || configs[0].type !== "slack" || configs[0].uid !== legacyContact.uid) {
    throw new Error("Standalone Slack receiver config is missing, duplicate, or drifted");
  }
}

function stripLegacyRoute(route, overlay) {
  if (!route) return route;
  const clone = structuredClone(route);
  if (Array.isArray(clone.routes)) {
    clone.routes = clone.routes
      .filter((child) => child.receiver !== overlay.slackContactPoint.legacyName)
      .map((child) => stripLegacyRoute(child, overlay));
  }
  return clone;
}

function captureProviderCore(config, contacts, overlay) {
  const am = config?.alertmanager_config;
  if (am?.route?.receiver !== overlay.notificationPolicy.receiver) {
    throw new Error("Root route receiver changed; refusing to alter the default SNS route");
  }
  assertLegacyState(am, contacts.legacy, overlay);
  const route = stripLegacyRoute(am.route, overlay);
  if (!isDeepStrictEqual(route, overlay.notificationPolicy)) {
    throw new Error("Root/default policy or a pre-existing route is missing or drifted");
  }
  const defaults = (am.receivers || []).filter((entry) => entry.name === overlay.contactPoint.name);
  if (defaults.length !== 1) {
    throw new Error("Default SNS receiver is missing or ambiguous");
  }
  const configs = defaults[0].grafana_managed_receiver_configs || [];
  const snsConfigs = configs.filter((entry) => entry.type === "sns");
  const slackConfigs = configs.filter((entry) => entry.type === "slack");
  if (snsConfigs.length !== 1 || snsConfigs[0].uid !== overlay.contactPoint.uid ||
      snsConfigs[0].name !== overlay.contactPoint.integrationName ||
      snsConfigs[0].disableResolveMessage !== overlay.contactPoint.disableResolveMessage ||
      !isDeepStrictEqual(snsConfigs[0].settings, overlay.contactPoint.settings)) {
    throw new Error("Default SNS receiver configuration is missing or drifted");
  }
  if (slackConfigs.length > 1 || configs.length !== snsConfigs.length + slackConfigs.length) {
    throw new Error("Default SNS receiver has duplicate Slack or unexpected integration config");
  }
  for (const receiver of am.receivers || []) {
    if (receiver.name === overlay.contactPoint.name || receiver.name === overlay.slackContactPoint.legacyName) continue;
    if ((receiver.grafana_managed_receiver_configs || []).some((entry) => entry.type === "slack")) {
      throw new Error("Unexpected Slack integration exists outside the default SNS receiver");
    }
  }
  const coreReceivers = (am.receivers || [])
    .filter((receiver) => receiver.name !== overlay.slackContactPoint.legacyName)
    .map((receiver) => receiver.name === overlay.contactPoint.name
      ? { ...structuredClone(receiver), grafana_managed_receiver_configs: structuredClone(snsConfigs) }
      : structuredClone(receiver));
  return {
    route,
    receivers: coreReceivers,
    defaultReceiver: defaults[0],
    slackConfig: slackConfigs[0] || null,
  };
}

function assertProviderCorePreserved(config, contacts, baseline, overlay) {
  const current = captureProviderCore(config, contacts, overlay);
  if (!isDeepStrictEqual(current.route, baseline.route)) {
    throw new Error("Root/default policy or a pre-existing route changed during Slack reconciliation");
  }
  if (!isDeepStrictEqual(current.receivers, baseline.receivers)) {
    throw new Error("SNS integration or an unowned receiver changed during Slack reconciliation");
  }
  return current;
}

function assertCombinedContact(core, contact, overlay) {
  const config = core.slackConfig;
  if (!contact?.uid || contact.name !== overlay.slackContactPoint.name || contact.type !== "slack" ||
      !config || config.uid !== contact.uid || config.name !== overlay.slackContactPoint.name ||
      config.disableResolveMessage !== false || config.secureFields?.url !== true ||
      config.settings?.title !== "{{ template \"slack.default.title\" . }}" ||
      config.settings?.text !== "{{ template \"slack.default.text\" . }}") {
    throw new Error("Combined default SNS + Slack contact point is missing or drifted");
  }
}

// Grafana generates a reserved matcher subtree whenever a receiver is added.
// Keep the policy tree byte-for-semantics unchanged by grouping Slack as a
// second integration inside the existing default SNS receiver. A legacy
// standalone receiver is deleted only after the combined contact is verified.
export async function ensureCombinedSlackContact(client, overlay, { env = process.env } = {}) {
  const webhook = slackWebhook(env);
  const beforeContacts = findSlackContacts((await client.listContactPoints()).body, overlay);
  const before = await client.getAlertmanagerConfig();
  const baseline = captureProviderCore(before.body, beforeContacts, overlay);
  let contact = beforeContacts.target;
  let contactPoint;
  if (!contact) {
    await client.createContactPoint(slackPayload(overlay, webhook));
    contactPoint = "created";
  } else {
    if (!contact.uid) {
      throw new Error("Slack contact point is missing its Grafana uid");
    }
    await client.updateContactPoint(contact.uid, slackPayload(overlay, webhook, contact.uid));
    contactPoint = "updated";
  }
  const stagedContacts = findSlackContacts((await client.listContactPoints()).body, overlay);
  contact = stagedContacts.target;
  if (!contact?.uid) {
    throw new Error("Post-write verification failed: Slack contact point is missing");
  }
  const staged = await client.getAlertmanagerConfig();
  const stagedCore = assertProviderCorePreserved(staged.body, stagedContacts, baseline, overlay);
  assertCombinedContact(stagedCore, contact, overlay);

  let legacyMigration = "not-needed";
  if (stagedContacts.legacy) {
    await client.deleteContactPoint(stagedContacts.legacy.uid);
    legacyMigration = "removed";
  }
  const finalContacts = findSlackContacts((await client.listContactPoints()).body, overlay);
  if (finalContacts.legacy || finalContacts.target?.uid !== contact.uid) {
    throw new Error("Standalone Slack migration did not converge to exactly one combined integration");
  }
  const finalConfig = await client.getAlertmanagerConfig();
  const finalCore = assertProviderCorePreserved(finalConfig.body, finalContacts, baseline, overlay);
  assertCombinedContact(finalCore, finalContacts.target, overlay);
  return { contactPoint, legacyMigration, uid: contact.uid };
}

export async function runSlackApply({ client, repoRoot = REPO_ROOT, env = process.env } = {}) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  slackWebhook(env);
  return ensureCombinedSlackContact(client, overlay, { env });
}

export async function runSlackVerify({ client, repoRoot = REPO_ROOT, env = process.env } = {}) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  slackWebhook(env);
  const contacts = findSlackContacts((await client.listContactPoints()).body, overlay);
  if (!contacts.target?.uid || contacts.legacy) {
    throw new Error("Combined Slack integration is missing or standalone migration is incomplete");
  }
  const config = await client.getAlertmanagerConfig();
  const core = captureProviderCore(config.body, contacts, overlay);
  assertCombinedContact(core, contacts.target, overlay);
  return { status: "verified" };
}

export async function runSlackTest({ client, repoRoot = REPO_ROOT, env = process.env } = {}) {
  const overlay = loadOverlay(repoRoot);
  validateOverlayDocument(overlay);
  const webhook = slackWebhook(env);
  const contacts = findSlackContacts((await client.listContactPoints()).body, overlay);
  if (!contacts.target?.uid || contacts.legacy) {
    throw new Error("Combined Slack integration is missing; run slack-apply first");
  }
  const config = await client.getAlertmanagerConfig();
  const core = captureProviderCore(config.body, contacts, overlay);
  assertCombinedContact(core, contacts.target, overlay);
  const result = await client.testReceiver({
    receivers: [{
      name: overlay.slackContactPoint.testReceiverName,
      grafana_managed_receiver_configs: [slackPayload(overlay, webhook, contacts.target.uid)],
    }],
  });
  const configs = result.body?.receivers?.[0]?.grafana_managed_receiver_configs ||
    result.body?.receivers?.[0]?.configs || [];
  if (!configs.some((entry) => entry.uid === contacts.target.uid && entry.status === "ok")) {
    throw new Error("Grafana Slack test delivery did not report status ok");
  }
  return { delivery: "ok" };
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
      safeLog("Slack apply:", JSON.stringify({ contactPoint: result.contactPoint, route: result.route }));
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
