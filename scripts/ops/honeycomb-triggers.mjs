#!/usr/bin/env node
// Honeycomb SLI trigger operator: check | apply | verify | synthetic-breach.
//
// Intent lives in server/infra/observability/honeycomb/triggers/*.json (one
// file per SLI, checksummed); the live provider is Honeycomb's own trigger
// engine. `check` is fully offline and runs in PR CI. `apply`/`verify` need
// HONEYCOMB_CONFIG_KEY (environment-scoped: the minted key is DOGFOOD-scoped,
// so --env production refuses until a production-scoped key exists) and the
// explicit HONEYCOMB_TRIGGERS_LIVE=1 flag. `synthetic-breach` sends bounded,
// clearly-marked failed terminals through the dogfood ingest key so a human
// can watch one trigger fire and resolve.
//
// Spec: specs/engineering/observability/honeycomb.md (the five SLIs).
// Frozen scope: delivery/observability/delivery-spec-slice-2-durable-slis.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalize, redact, sha256 } from "./grafana-alerting.mjs";

const __filename = fileURLToPath(import.meta.url);
export const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
export const TRIGGERS_DIR = path.join(
  REPO_ROOT,
  "server/infra/observability/honeycomb/triggers",
);

export const API_BASE = "https://api.honeycomb.io";
// The five slugs are the closed set; a sixth file is a spec change first.
export const EXPECTED_SLUGS = Object.freeze([
  "agent-start-failed",
  "launch-selection-invalid",
  "orphan-rate",
  "session-create-failed",
  "time-to-first-output",
]);
const ALLOWED_DATASETS = Object.freeze(["anyharness"]);
const ALLOWED_CALC_OPS = Object.freeze(["COUNT", "P95", "P99", "AVG", "MAX"]);
const ALLOWED_FILTER_OPS = Object.freeze(["=", "!=", "in", "exists"]);
// Only exported attribute names may appear in a query: the OTLP encoder's
// vocabulary, not arbitrary strings.
const ALLOWED_COLUMN_PREFIXES = Object.freeze(["proliferate."]);

function fail(message) {
  console.error(`FAIL: ${redact(message)}`);
  process.exitCode = 1;
}

export function loadIntents(dir = TRIGGERS_DIR) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => ({
    file: name,
    intent: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
  }));
}

export function intentChecksum(intent) {
  const { checksum: _dropped, ...rest } = intent;
  return sha256(canonicalize(rest));
}

export function validateIntent({ file, intent }) {
  const errors = [];
  const slug = file.replace(/\.json$/, "");
  if (intent.slug !== slug) errors.push(`${file}: slug must equal file name`);
  if (!ALLOWED_DATASETS.includes(intent.dataset))
    errors.push(`${file}: dataset ${intent.dataset} is not in the closed list`);
  if (intent.checksum !== intentChecksum(intent))
    errors.push(`${file}: checksum mismatch — run \`honeycomb-triggers.mjs stamp\` after editing`);
  if (!Number.isInteger(intent.frequency) || intent.frequency < 60)
    errors.push(`${file}: frequency must be an integer >= 60s`);
  if ((intent.query?.time_range ?? 0) > intent.frequency * 4)
    errors.push(`${file}: query time_range must be <= 4x frequency (Honeycomb constraint)`);
  const calcs = intent.query?.calculations ?? [];
  if (calcs.length !== 1)
    errors.push(`${file}: a trigger query has exactly one calculation`);
  for (const calc of calcs) {
    if (!ALLOWED_CALC_OPS.includes(calc.op))
      errors.push(`${file}: calculation op ${calc.op} is not allowed`);
    if (calc.column && !ALLOWED_COLUMN_PREFIXES.some((p) => calc.column.startsWith(p)))
      errors.push(`${file}: calculation column ${calc.column} is not an exported attribute`);
  }
  for (const filter of intent.query?.filters ?? []) {
    if (!ALLOWED_FILTER_OPS.includes(filter.op))
      errors.push(`${file}: filter op ${filter.op} is not allowed`);
    if (!ALLOWED_COLUMN_PREFIXES.some((p) => filter.column.startsWith(p)))
      errors.push(`${file}: filter column ${filter.column} is not an exported attribute`);
  }
  if (!intent.threshold || !([">", ">=", "<", "<="].includes(intent.threshold.op)))
    errors.push(`${file}: threshold.op must be a comparison`);
  if (intent.recipient?.type !== "slack")
    errors.push(`${file}: recipient.type must be slack (the alerting path)`);
  return errors;
}

// The wire body Honeycomb's trigger API accepts, from one intent file.
// recipient.id === null means "no recipient yet" (Pablo creates the Slack
// recipient once in the UI and checks its id in) — the trigger still
// evaluates, verify reports the pending recipient.
export function apiBody(intent) {
  return {
    name: intent.name,
    description: intent.description,
    disabled: intent.disabled === true,
    query: intent.query,
    threshold: { op: intent.threshold.op, value: intent.threshold.value },
    frequency: intent.frequency,
    alert_type: intent.alert_type,
    recipients: intent.recipient.id ? [{ id: intent.recipient.id }] : [],
  };
}

// Field-by-field comparison of one live trigger against its intent. Returns
// human-readable mismatch lines; [] means the live object matches.
export function compareLive(intent, live) {
  const mismatches = [];
  const want = apiBody(intent);
  if (live.disabled !== want.disabled) mismatches.push("disabled differs");
  if (live.frequency !== want.frequency) mismatches.push("frequency differs");
  if (live.threshold?.op !== want.threshold.op || live.threshold?.value !== want.threshold.value)
    mismatches.push("threshold differs");
  // The evaluation window and the combinator define what the threshold was
  // tuned against; a UI widen is drift, not cosmetics.
  if ((live.query?.time_range ?? 0) !== (want.query.time_range ?? 0))
    mismatches.push("time_range differs");
  if ((live.query?.filter_combination ?? "AND") !== (want.query.filter_combination ?? "AND"))
    mismatches.push("filter_combination differs");
  // Project both sides to the fields we own before comparing, so an
  // API-normalized extra (a null column on COUNT, a null value on exists)
  // is not perpetual false drift.
  const normCalcs = (calcs) =>
    canonicalize(
      (calcs ?? []).map((c) => ({ op: c.op, ...(c.column != null ? { column: c.column } : {}) })),
    );
  if (normCalcs(live.query?.calculations) !== normCalcs(want.query.calculations))
    mismatches.push("calculation differs");
  const normFilters = (filters) =>
    canonicalize(
      (filters ?? [])
        .map((f) => ({ column: f.column, op: f.op, ...(f.value !== undefined && f.value !== null ? { value: f.value } : {}) }))
        .sort((a, b) => canonicalize(a).localeCompare(canonicalize(b))),
    );
  if (normFilters(live.query?.filters) !== normFilters(want.query.filters))
    mismatches.push("filters differ");
  if (want.recipients.length === 0) {
    mismatches.push("recipient pending (Pablo: create the Slack recipient, check its id into the intent)");
  } else if (!(live.recipients ?? []).some((r) => r.id === want.recipients[0].id)) {
    mismatches.push("recipient differs");
  }
  return mismatches;
}

function configKey(env) {
  if (env === "production") {
    const key = process.env.HONEYCOMB_CONFIG_KEY_PROD;
    if (!key)
      throw new Error(
        "refusing --env production: HONEYCOMB_CONFIG_KEY is dogfood-scoped; production trigger management needs HONEYCOMB_CONFIG_KEY_PROD (a Pablo mint)",
      );
    return key;
  }
  const key = process.env.HONEYCOMB_CONFIG_KEY;
  if (!key) throw new Error("HONEYCOMB_CONFIG_KEY is not set (see ~/.proliferate-local/observability-keys.env)");
  return key;
}

async function api(method, key, route, body) {
  const response = await fetch(`${API_BASE}${route}`, {
    method,
    headers: { "X-Honeycomb-Team": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${route} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function listLive(key, dataset) {
  return (await api("GET", key, `/1/triggers/${dataset}`)) ?? [];
}

// Every column an intent's query touches. A trigger referencing a column the
// dataset has never seen 422s, and the columns an SLI needs may only start
// flowing with the slice that emits them — so apply creates missing ones
// (the config key's columns scope exists for this). *_ms names are integers.
export function referencedColumns(intent) {
  const columns = new Map();
  for (const calc of intent.query.calculations ?? []) {
    if (calc.column) columns.set(calc.column, calc.column.endsWith("_ms") ? "integer" : "string");
  }
  for (const filter of intent.query.filters ?? []) {
    columns.set(filter.column, filter.column.endsWith("_ms") ? "integer" : "string");
  }
  return columns;
}

async function ensureColumns(key, intent) {
  const existing = (await api("GET", key, `/1/columns/${intent.dataset}`)) ?? [];
  const known = new Set(existing.map((column) => column.key_name));
  for (const [name, type] of referencedColumns(intent)) {
    if (known.has(name)) continue;
    await api("POST", key, `/1/columns/${intent.dataset}`, {
      key_name: name,
      type,
      description: "created by honeycomb-triggers.mjs for SLI trigger intent",
    });
    console.log(`created column: ${name} (${type})`);
  }
}

async function applyAll(env) {
  requireLiveFlag();
  const key = configKey(env);
  for (const { file, intent } of loadIntents()) {
    const errors = validateIntent({ file, intent });
    if (errors.length) throw new Error(errors.join("; "));
    await ensureColumns(key, intent);
    const live = await listLive(key, intent.dataset);
    const existing = live.find((t) => t.name === intent.name);
    const body = apiBody(intent);
    if (existing) {
      await api("PUT", key, `/1/triggers/${intent.dataset}/${existing.id}`, body);
      console.log(`applied (update): ${intent.slug}`);
    } else {
      await api("POST", key, `/1/triggers/${intent.dataset}`, body);
      console.log(`applied (create): ${intent.slug}`);
    }
  }
}

// Every trigger this tool manages carries the prefix, so a live trigger
// wearing it without a matching intent is a stray (a renamed intent's
// orphan, a deleted intent's survivor) and fails verify.
export const MANAGED_PREFIX = "SLI: ";

export function strayNames(intents, liveNames) {
  const wanted = new Set(intents.map(({ intent }) => intent.name));
  return liveNames.filter((name) => name.startsWith(MANAGED_PREFIX) && !wanted.has(name));
}

async function verifyAll(env) {
  const key = configKey(env);
  let clean = true;
  const intents = loadIntents();
  const datasets = [...new Set(intents.map(({ intent }) => intent.dataset))];
  for (const dataset of datasets) {
    const live = await listLive(key, dataset);
    for (const stray of strayNames(intents, live.map((t) => t.name))) {
      console.log(`STRAY: ${stray} (live in ${dataset}, no intent — delete it or restore its file)`);
      clean = false;
    }
  }
  for (const { file, intent } of loadIntents()) {
    const errors = validateIntent({ file, intent });
    if (errors.length) throw new Error(errors.join("; "));
    const live = await listLive(key, intent.dataset);
    const match = live.find((t) => t.name === intent.name);
    if (!match) {
      console.log(`MISSING: ${intent.slug}`);
      clean = false;
      continue;
    }
    const mismatches = compareLive(intent, match).filter(
      (m) => !m.startsWith("recipient pending"),
    );
    const pending = compareLive(intent, match).some((m) => m.startsWith("recipient pending"));
    if (mismatches.length) {
      console.log(`MISMATCH: ${intent.slug}: ${mismatches.join(", ")}`);
      clean = false;
    } else {
      console.log(`ok: ${intent.slug}${pending ? " (recipient pending)" : ""}`);
    }
  }
  if (!clean) process.exitCode = 1;
}

function requireLiveFlag() {
  if (process.env.HONEYCOMB_TRIGGERS_LIVE !== "1")
    throw new Error("live verb requires HONEYCOMB_TRIGGERS_LIVE=1 (apply is deliberate, never ambient)");
}

// A bounded, clearly-marked burst of failed session.create terminals into the
// DOGFOOD environment only, so the session-create trigger observably fires
// and resolves. Every field is from the closed export vocabulary; the marker
// argument makes the records unmistakably synthetic.
export function syntheticBreachPayload(count, nowNanos) {
  const records = Array.from({ length: count }, (_, index) => ({
    timeUnixNano: String(nowNanos + BigInt(index)),
    observedTimeUnixNano: String(nowNanos + BigInt(index)),
    severityNumber: 17,
    severityText: "ERROR",
    body: { stringValue: "anyharness.session.create" },
    attributes: [
      ["proliferate.name", "anyharness.session.create"],
      ["proliferate.record_class", "lifecycle"],
      ["proliferate.component", "anyharness"],
      ["proliferate.source", "anyharness"],
      ["proliferate.producer_boot_id", "synthetic-breach"],
      ["proliferate.privacy", "operational"],
      ["proliferate.redaction", "none"],
      ["proliferate.operation_id", `synthetic-breach-${index}`],
      ["proliferate.lifecycle.phase", "terminal"],
      ["proliferate.lifecycle.outcome", "failed"],
      ["proliferate.lifecycle.finalizer", "producer"],
      ["proliferate.error_classification", "internal_error"],
      ["proliferate.argument.origin", "synthetic_breach_o2"],
    ].map(([key, value]) => ({ key, value: { stringValue: value } })),
  }));
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "anyharness" } },
            { key: "service.version", value: { stringValue: "anyharness@0.0.0-synthetic" } },
            { key: "service.instance.id", value: { stringValue: "synthetic-breach" } },
            { key: "deployment.environment.name", value: { stringValue: "dogfood" } },
            { key: "telemetry.sdk.name", value: { stringValue: "proliferate-diagnostics" } },
            { key: "dev.user", value: { stringValue: "synthetic-breach" } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "proliferate-diagnostics", version: "1.1" },
            logRecords: records,
          },
        ],
      },
    ],
  };
}

async function syntheticBreach() {
  requireLiveFlag();
  const key = process.env.HONEYCOMB_INGEST_KEY_DOGFOOD;
  if (!key) throw new Error("HONEYCOMB_INGEST_KEY_DOGFOOD is not set; the breach is dogfood-only by design");
  // The Honeycomb environment is a property of the KEY, not of the payload's
  // environment attribute — confirm before sending, so a production key
  // pasted into the dogfood variable cannot land a synthetic breach in prod.
  const auth = await api("GET", key, "/1/auth");
  const slug = auth?.environment?.slug;
  if (slug !== "dogfood")
    throw new Error(`refusing: the key's environment is ${slug ?? "unconfirmable"}, not dogfood`);
  const payload = syntheticBreachPayload(8, BigInt(Date.now()) * 1_000_000n);
  await api("POST", key, "/v1/logs", payload);
  console.log("synthetic breach sent: 8 failed session.create terminals to dogfood (marker: synthetic_breach_o2)");
}

// Recomputes and writes every intent file's checksum. The offline pair of
// check: a threshold tune is edit + stamp + commit, no hand-hashing.
export function stamp(dir = TRIGGERS_DIR) {
  for (const { file, intent } of loadIntents(dir)) {
    const { checksum: _old, ...rest } = intent;
    const stamped = { ...rest, checksum: intentChecksum(intent) };
    const sorted = Object.fromEntries(Object.keys(stamped).sort().map((k) => [k, stamped[k]]));
    fs.writeFileSync(path.join(dir, file), `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`stamped: ${file}`);
  }
}

function check() {
  const intents = loadIntents();
  const slugs = intents.map(({ intent }) => intent.slug).sort();
  if (canonicalize(slugs) !== canonicalize([...EXPECTED_SLUGS])) {
    fail(`trigger set differs from the five SLIs: ${slugs.join(", ")}`);
  }
  for (const entry of intents) {
    for (const error of validateIntent(entry)) fail(error);
  }
  if (process.exitCode !== 1) console.log(`check ok: ${intents.length} trigger intents`);
}

const invokedAsMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url ===
      pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href
    );
  } catch {
    return false;
  }
})();
if (invokedAsMain) {
  const [, , verb, ...rest] = process.argv;
  const envArg = rest.includes("--env") ? rest[rest.indexOf("--env") + 1] : "dogfood";
  try {
    if (verb === "check") check();
    else if (verb === "stamp") stamp();
    else if (verb === "apply") await applyAll(envArg);
    else if (verb === "verify") await verifyAll(envArg);
    else if (verb === "synthetic-breach") await syntheticBreach();
    else {
      console.error(
        "usage: honeycomb-triggers.mjs check|stamp|apply|verify|synthetic-breach [--env dogfood|production]",
      );
      process.exitCode = 2;
    }
  } catch (error) {
    fail(error.message);
  }
}
