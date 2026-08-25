// Fixed-target Grafana client for operator writes and metadata inventory.
// TARGET alone derives the base URL; an injected fetch changes only transport,
// while request construction, authorization, parsing, and writes remain real.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { runContextualAwsCommand } from "./grafana-credential-process.mjs";
import { readMetadataInventoryInternal } from "./grafana-metadata-inventory.mjs";

const execFileAsync = promisify(execFile);

// Fixed production target. Shared single source of truth for the E1 tooling.
export const TARGET = Object.freeze({
  awsAccount: "157466816238",
  awsRegion: "us-east-1",
  grafanaWorkspaceId: "g-e532d030d8",
  grafanaWorkspaceName: "proliferate-ops",
  grafanaVersion: "10.4",
});
const { grafanaVersion: expectedGrafanaVersion, ...inventoryTarget } = TARGET;
const INVENTORY_TARGET = Object.freeze({ ...inventoryTarget, expectedGrafanaVersion });

// Derived exclusively from TARGET. Not configurable.
export const WORKSPACE_BASE_URL = `https://${TARGET.grafanaWorkspaceId}.grafana-workspace.${TARGET.awsRegion}.amazonaws.com`;

export const ADMIN_TOKEN_PATH = path.join(os.homedir(), ".proliferate-local/ops/grafana-admin.token");

const PROVISIONING = "/api/v1/provisioning";
export const ALERTMANAGER_CONFIG = "/api/alertmanager/grafana/config/api/v1/alerts";

function fixedWorkspaceUrl(apiPath) {
  if (typeof apiPath !== "string" || !apiPath.startsWith("/api/") || apiPath.startsWith("//")) {
    throw Object.assign(new Error("Invalid fixed Grafana API path"), { code: "GRAFANA_TARGET_MISMATCH" });
  }
  const absolute = `${WORKSPACE_BASE_URL}${apiPath}`;
  const url = new URL(absolute);
  if (url.origin !== WORKSPACE_BASE_URL || url.username || url.password || url.hash) {
    throw Object.assign(new Error("Invalid fixed Grafana API origin"), { code: "GRAFANA_TARGET_MISMATCH" });
  }
  return absolute;
}

function responseMatchesWorkspace(response) {
  try {
    const received = new URL(response.url);
    return received.origin === WORKSPACE_BASE_URL && !received.username && !received.password;
  } catch {
    return false;
  }
}

// Reads the ephemeral operator Admin token minted immediately before E1 ops.
// The token is used only as a request header and is never logged or returned
// through any printing path.
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

function hasAwsCredentialContext(signal, throwIfDeadlineExpired) {
  const contextual = signal !== undefined || throwIfDeadlineExpired !== undefined;
  if (contextual && (!signal || typeof throwIfDeadlineExpired !== "function")) {
    throw new Error("AWS credential context requires both signal and deadline guard");
  }
  return contextual;
}

// Hard identity gate before any secret resolution: the AWS caller must be in
// the fixed target account, or we refuse to read anything.
export async function assertOperatorAccount(
  execFileImpl = execFileAsync,
  { signal, throwIfDeadlineExpired } = {},
) {
  const contextual = hasAwsCredentialContext(signal, throwIfDeadlineExpired);
  let account;
  try {
    const args = ["sts", "get-caller-identity", "--output", "json"];
    const { stdout } = contextual
      ? await runContextualAwsCommand({ execFileImpl, args, signal, throwIfDeadlineExpired })
      : await execFileImpl("aws", args);
    account = JSON.parse(stdout).Account;
  } catch {
    throw new Error("Unable to determine the AWS caller identity; refusing to resolve secrets");
  }
  if (account !== TARGET.awsAccount) {
    throw new Error(`AWS caller account ${account} is not the fixed target account ${TARGET.awsAccount}`);
  }
}

// Resolves one field of a JSON secret from AWS Secrets Manager at execution
// time. The value is returned to the caller and never printed; stderr from a
// failed call is discarded so no secret material can leak through error text.
export async function resolveSecretField(
  secretId,
  field,
  { execFileImpl = execFileAsync, signal, throwIfDeadlineExpired } = {},
) {
  const contextual = hasAwsCredentialContext(signal, throwIfDeadlineExpired);
  await assertOperatorAccount(execFileImpl, { signal, throwIfDeadlineExpired });
  let stdout;
  try {
    const args = [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      secretId,
      "--region",
      TARGET.awsRegion,
      "--query",
      "SecretString",
      "--output",
      "text",
    ];
    ({ stdout } = contextual
      ? await runContextualAwsCommand({ execFileImpl, args, signal, throwIfDeadlineExpired })
      : await execFileImpl("aws", args));
  } catch {
    throw new Error(`Failed to read secret ${secretId} from AWS Secrets Manager`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`Secret ${secretId} is not a JSON object`);
  }
  const value = parsed[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Secret ${secretId} is missing field ${field}`);
  }
  return value;
}

// Maps one ruler-API rule entry ({for, grafana_alert}) onto the provisioning
// rule shape, so query models normalize identically regardless of which read
// surface produced them.
export function ruleFromRulerEntry(entry) {
  const ga = entry.grafana_alert || {};
  return {
    uid: ga.uid,
    title: ga.title,
    condition: ga.condition ?? null,
    data: ga.data ?? null,
    noDataState: ga.no_data_state ?? null,
    execErrState: ga.exec_err_state ?? null,
    for: entry.for ?? null,
    ruleGroup: ga.rule_group ?? null,
    folderUID: ga.namespace_uid ?? null,
    isPaused: ga.is_paused ?? false,
    labels: entry.labels ?? {},
    annotations: entry.annotations ?? {},
  };
}

// A fetch-like function is the only transport seam. Legacy calls resolve a
// bearer per request; inventory keeps one snapshot only in its invocation.
export function createGrafanaClient({ fetchImpl = fetch, tokenProvider }) {
  if (typeof tokenProvider !== "function") {
    throw new Error("createGrafanaClient requires a tokenProvider function");
  }

  async function request(method, apiPath, body = undefined, extraHeaders = {}) {
    const url = fixedWorkspaceUrl(apiPath);
    const headers = {
      Authorization: `Bearer ${tokenProvider()}`,
      Accept: "application/json",
      ...extraHeaders,
    };
    const init = { method, headers, redirect: "manual" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      // Redacted by construction: path + status only. No host, no auth, no body.
      throw new Error(`Grafana ${method} ${apiPath} failed with HTTP ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function prepareAuthorizedGet({ signal, guard, staticPaths, credentialBytes }) {
    for (const apiPath of staticPaths) fixedWorkspaceUrl(apiPath);
    guard();
    let removeAbort = () => {};
    const aborted = new Promise((_, reject) => {
      const onAbort = () => reject(signal.reason || new Error("Inventory credential acquisition aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", onAbort);
    });
    let provided;
    try {
      provided = tokenProvider({ signal, throwIfDeadlineExpired: guard });
      provided = await Promise.race([Promise.resolve(provided), aborted]);
      guard();
    } catch {
      throw new Error("Inventory credential is unavailable");
    } finally {
      removeAbort();
    }
    if (
      typeof provided !== "string" ||
      Buffer.byteLength(provided, "utf8") > credentialBytes ||
      !/^[A-Za-z0-9._~+/-]+={0,}$/.test(provided)
    ) {
      throw new Error("Inventory credential is unavailable");
    }
    return async (apiPath, requestSignal) => {
      const url = fixedWorkspaceUrl(apiPath);
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${provided}`, Accept: "application/json" },
        redirect: "manual",
        signal: requestSignal,
      });
      return { response, targetMatches: responseMatchesWorkspace(response) };
    };
  }

  return {
    async readMetadataInventory() {
      return readMetadataInventoryInternal({ target: INVENTORY_TARGET, prepareAuthorizedGet });
    },
    // --- reads (GET only) ---
    async listAlertRules() {
      return request("GET", `${PROVISIONING}/alert-rules`);
    },
    // Read-only rule listing over the ruler API, the surface the dedicated
    // Viewer service account can read (P0 read proof). Mapped to the same
    // provisioning shape so normalization/checksums are surface-independent.
    async listAlertRulesViaRuler() {
      const namespaces = await request("GET", "/api/ruler/grafana/api/v1/rules");
      const rules = [];
      for (const groups of Object.values(namespaces || {})) {
        for (const group of groups || []) {
          for (const entry of group.rules || []) {
            rules.push(ruleFromRulerEntry(entry));
          }
        }
      }
      return rules;
    },
    async getAlertRule(uid) {
      return request("GET", `${PROVISIONING}/alert-rules/${encodeURIComponent(uid)}`);
    },
    async getContactPoints() {
      return request("GET", `${PROVISIONING}/contact-points`);
    },
    async getNotificationPolicy() {
      return request("GET", `${PROVISIONING}/policies`);
    },

    // --- writes (apply/restore only; guarded by the caller) ---
    async upsertAlertRule(uid, rule) {
      return request("PUT", `${PROVISIONING}/alert-rules/${encodeURIComponent(uid)}`, rule, {
        "X-Disable-Provenance": "true",
      });
    },

    // Full Alertmanager config read/write surface (receipt capture and the
    // rebuild bootstrap use it; it retains encrypted secure fields).
    async getAlertmanagerConfig() {
      return request("GET", ALERTMANAGER_CONFIG);
    },
    async postAlertmanagerConfig(config) {
      return request("POST", ALERTMANAGER_CONFIG, config);
    },
  };
}
