#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TERMINAL_STATES = new Set([
  "observed",
  "observed_empty",
  "last_good_after_failure",
  "failed_without_observation",
]);
const args = parseArgs(process.argv.slice(2));
const correlationId = randomUUID();

main().catch((error) => {
  console.error(JSON.stringify({
    status: "incomplete",
    correlationId,
    code: error.code ?? "VERIFIER_FAILED",
    detail: String(error.message ?? error),
  }));
  process.exitCode = 1;
});

async function main() {
  if (!args.profile || args.harnesses.length === 0) {
    fail("USAGE", "usage: verify-harness-launch-options.mjs --profile <name> --harness <kind> [--harness <kind>]");
  }
  const profileDir = join(homedir(), ".proliferate-local", "dev", "profiles", args.profile);
  const profileEnvPath = join(profileDir, "profile.env");
  const launchEnvPath = join(profileDir, "launch.env");
  if (!existsSync(profileEnvPath) || !existsSync(launchEnvPath)) {
    fail("PROFILE_NOT_RUNNING", `profile '${args.profile}' is not prepared with profile.env and launch.env`);
  }
  const profileEnv = parseEnvFile(profileEnvPath);
  const launchEnv = parseEnvFile(launchEnvPath);
  const port = launchEnv.ANYHARNESS_PORT ?? profileEnv.ANYHARNESS_PORT;
  const runtimeHome = launchEnv.ANYHARNESS_RUNTIME_HOME ?? profileEnv.ANYHARNESS_RUNTIME_HOME;
  if (!/^\d+$/.test(port ?? "") || !runtimeHome) {
    fail("PROFILE_INCOMPLETE", "profile does not declare ANYHARNESS_PORT and ANYHARNESS_RUNTIME_HOME");
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  await requestJson(baseUrl, "/v1/health");
  const workspaces = await requestJson(baseUrl, "/v1/workspaces");
  const workspace = Array.isArray(workspaces)
    ? workspaces.find((candidate) => candidate?.lifecycleState === "active") ?? workspaces[0]
    : null;
  if (!workspace?.id) {
    fail("NO_WORKSPACE", "running profile has no workspace available for a real session proof");
  }

  const adapterPath = resolve("apps/packages/product-client/dist/lib/domain/agents/cloud-launch-catalog.js");
  if (!existsSync(adapterPath)) {
    fail("PRODUCT_ADAPTER_NOT_BUILT", "ProductClient dist is absent; verifier never builds artifacts implicitly");
  }
  const { projectHarnessLaunchOptions } = await import(pathToFileURL(adapterPath).href);
  const receipts = [];
  const incomplete = [];
  for (const harnessKind of args.harnesses) {
    try {
      receipts.push(await verifyHarness({
        baseUrl,
        runtimeHome,
        workspaceId: workspace.id,
        harnessKind,
        projectHarnessLaunchOptions,
      }));
    } catch (error) {
      incomplete.push({
        harnessKind,
        code: error.code ?? "HARNESS_PROOF_FAILED",
        detail: String(error.message ?? error),
      });
    }
  }

  const receipt = {
    schemaVersion: 1,
    status: incomplete.length === 0 ? "passed" : "incomplete",
    profile: args.profile,
    targetId: args.profile,
    correlationId,
    harnesses: receipts,
    incomplete,
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (incomplete.length > 0) {
    process.exitCode = 1;
  }
}

async function verifyHarness(input) {
  const harnessVersion = readHarnessVersion(input.runtimeHome, input.harnessKind);
  const refreshPath = `/v1/agents/${encodeURIComponent(input.harnessKind)}/launch-options/refresh`;
  await requestJson(input.baseUrl, refreshPath, { method: "POST", body: {} });
  const response = await poll(async () => {
    const current = await requestJson(
      input.baseUrl,
      `/v1/agents/${encodeURIComponent(input.harnessKind)}/launch-options`,
    );
    return TERMINAL_STATES.has(current.state) ? current : null;
  }, 60_000, "LAUNCH_OPTIONS_TIMEOUT");

  if (response.state !== "observed" || !response.options) {
    fail(
      response.state === "observed_empty" ? "OBSERVED_EMPTY" : "OBSERVATION_FAILED",
      `${input.harnessKind} ended refresh in ${response.state}${response.probeFailureCode ? ` (${response.probeFailureCode})` : ""}`,
    );
  }
  const sanitizedOptions = optionKeys(response.options);
  console.log(JSON.stringify({
    harnessKind: input.harnessKind,
    basisRevision: response.basisRevision,
    revision: response.revision,
    state: response.state,
    ...sanitizedOptions,
  }));

  const projected = input.projectHarnessLaunchOptions(response);
  assertAdapterEquality(response.options, projected);
  const selection = chooseSelection(input.harnessKind, response.options);
  const session = await requestJson(input.baseUrl, "/v1/sessions", {
    method: "POST",
    body: {
      workspaceId: input.workspaceId,
      agentKind: input.harnessKind,
      modelId: selection.modelId,
      controlValues: selection.controlValues,
    },
  });
  if (!session?.id) {
    fail("CREATE_DID_NOT_RETURN_SESSION", `${input.harnessKind} create returned no session id`);
  }

  const intent = readIntent(input.runtimeHome, session.id);
  if (intent.modelId !== selection.modelId || !sameRecord(intent.controlValues, selection.controlValues)) {
    fail("PERSISTED_INTENT_MISMATCH", `${input.harnessKind} persisted intent differs from selection`);
  }
  const ready = await poll(async () => {
    const currentSession = await requestJson(
      input.baseUrl,
      `/v1/sessions/${encodeURIComponent(session.id)}`,
    );
    if (currentSession.status === "errored" || currentSession.status === "closed") {
      fail("SESSION_START_FAILED", `${input.harnessKind} session became ${currentSession.status}`);
    }
    const liveResponse = await requestJson(
      input.baseUrl,
      `/v1/sessions/${encodeURIComponent(session.id)}/live-config`,
    );
    const live = liveResponse.liveConfig;
    return live && selectionMatches(live.current, selection) ? live : null;
  }, 90_000, "SESSION_READY_TIMEOUT");

  const mutation = await proveMutation(input.baseUrl, session.id, ready);
  return {
    harnessKind: input.harnessKind,
    harnessVersion,
    basisRevision: response.basisRevision,
    revision: response.revision,
    optionKeyHash: hashJson(sanitizedOptions),
    modelCount: response.options.models.length,
    controlCount: response.options.controls.length,
    controlValueCount: response.options.controls.reduce((count, control) => count + control.values.length, 0),
    selectedKeys: {
      modelId: selection.modelId,
      controls: Object.keys(selection.controlValues).sort(),
    },
    intentId: session.id,
    sessionId: session.id,
    confirmation: {
      initial: true,
      mutated: mutation.confirmed,
      mutationControlId: mutation.controlId,
    },
    correlationId,
  };
}

function readHarnessVersion(runtimeHome, harnessKind) {
  const manifestPath = join(runtimeHome, "agents", harnessKind, "install-manifest.json");
  if (!existsSync(manifestPath)) {
    fail("HARNESS_NOT_INSTALLED", `${harnessKind} has no install manifest in the selected profile`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("HARNESS_MANIFEST_INVALID", `${harnessKind} install manifest is invalid`);
  }
  const processVersion = manifest.artifacts?.find(
    (artifact) => artifact?.role === "agent_process",
  )?.version;
  if (typeof processVersion !== "string" || !processVersion.trim()) {
    fail("HARNESS_VERSION_MISSING", `${harnessKind} install manifest has no agent-process version`);
  }
  return processVersion.trim();
}

function chooseSelection(harnessKind, options) {
  const modelId = options.defaults.modelId
    && options.models.some((model) => model.id === options.defaults.modelId)
      ? options.defaults.modelId
      : options.models[0]?.id ?? null;
  const controlValues = {};
  for (const control of options.controls) {
    const requested = options.defaults.controlValues[control.id];
    const value = requested && control.values.some((candidate) => candidate.value === requested)
      ? requested
      : control.values[0]?.value;
    if (value) controlValues[control.id] = value;
  }
  if (harnessKind === "codex") {
    requireValue(options, "collaboration_mode", "plan");
    requireValue(options, "mode", "agent-full-access");
    if (options.controls.find((control) => control.id === "mode")?.values.some((value) => value.value === "full-access")) {
      fail("OBSOLETE_CODEX_ACCESS", "Codex exposes obsolete full-access");
    }
    controlValues.collaboration_mode = "plan";
    controlValues.mode = "agent-full-access";
  }
  return { modelId, controlValues };
}

async function proveMutation(baseUrl, sessionId, live) {
  for (const control of live.controls ?? []) {
    const current = live.current?.controlValues?.[control.id];
    const alternative = control.values.find((candidate) => candidate.value !== current)?.value;
    if (!alternative) continue;
    await requestJson(baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}/config-options`, {
      method: "POST",
      body: { configId: control.id, value: alternative },
    });
    await poll(async () => {
      const next = (await requestJson(
        baseUrl,
        `/v1/sessions/${encodeURIComponent(sessionId)}/live-config`,
      )).liveConfig;
      return next?.sourceSeq > live.sourceSeq
        && next.current?.controlValues?.[control.id] === alternative
          ? next
          : null;
    }, 60_000, "LIVE_MUTATION_TIMEOUT");
    return { confirmed: true, controlId: control.id };
  }
  return { confirmed: null, controlId: null };
}

function readIntent(runtimeHome, sessionId) {
  const dbPath = join(runtimeHome, "db.sqlite");
  if (!existsSync(dbPath)) fail("RUNTIME_DB_MISSING", "profile runtime db.sqlite is absent");
  let output;
  try {
    output = execFileSync("sqlite3", [
      "-readonly", "-json", dbPath,
      "SELECT requested_model_id AS modelId, requested_controls_json AS controlValues FROM session_launch_intents WHERE session_id = ?;",
      sessionId,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    // macOS sqlite3 does not support parameter arguments in all packaged
    // versions. Session ids are UUIDs returned by the runtime, so validate and
    // embed only that closed grammar in the read-only fallback query.
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(sessionId)) fail("INVALID_SESSION_ID", "runtime returned an unsafe session id");
    output = execFileSync("sqlite3", [
      "-readonly", "-json", dbPath,
      `SELECT requested_model_id AS modelId, requested_controls_json AS controlValues FROM session_launch_intents WHERE session_id = '${sessionId}';`,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  const row = JSON.parse(output)[0];
  if (!row) fail("INTENT_NOT_FOUND", "session_launch_intents has no row for created session");
  return { modelId: row.modelId ?? null, controlValues: JSON.parse(row.controlValues) };
}

function assertAdapterEquality(options, projected) {
  if (!projected) fail("PRODUCT_ADAPTER_EMPTY", "ProductClient adapter returned no agent");
  const product = {
    models: projected.models.map((model) => model.id),
    controls: projected.launchControls.map((control) => ({
      id: control.key,
      values: control.values.map((value) => value.value),
    })),
    defaults: {
      modelId: projected.defaultModelId,
      controlValues: Object.fromEntries(projected.launchControls.flatMap((control) =>
        control.defaultValue ? [[control.key, control.defaultValue]] : [])),
    },
  };
  const runtime = {
    models: options.models.map((model) => model.id),
    controls: options.controls.map((control) => ({
      id: control.id,
      values: control.values.map((value) => value.value),
    })),
    defaults: options.defaults,
  };
  if (JSON.stringify(product) !== JSON.stringify(runtime)) {
    fail("PRODUCT_ADAPTER_MEMBERSHIP_MISMATCH", "ProductClient adapter changed executable keys or defaults");
  }
}

function selectionMatches(current, selection) {
  if (!current || current.modelId !== selection.modelId) return false;
  return Object.entries(selection.controlValues).every(([key, value]) => current.controlValues?.[key] === value);
}

function optionKeys(options) {
  return {
    modelIds: options.models.map((model) => model.id),
    controls: options.controls.map((control) => ({
      id: control.id,
      values: control.values.map((value) => value.value),
    })),
    defaults: options.defaults,
  };
}

async function requestJson(baseUrl, path, init = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? {} : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail("PROFILE_UNREACHABLE", "profile AnyHarness endpoint is not reachable");
  }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* sanitized below */ }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}${body?.code ? ` ${body.code}` : ""}`);
    error.code = body?.code ?? `HTTP_${response.status}`;
    throw error;
  }
  return body;
}

async function poll(read, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail(code, `condition was not confirmed within ${timeoutMs}ms`);
}

function requireValue(options, controlId, value) {
  const control = options.controls.find((candidate) => candidate.id === controlId);
  if (!control?.values.some((candidate) => candidate.value === value)) {
    fail("CODEX_CONTROL_MISSING", `Codex does not expose ${controlId}=${value}`);
  }
}

function sameRecord(left, right) {
  return JSON.stringify(Object.fromEntries(Object.entries(left).sort()))
    === JSON.stringify(Object.fromEntries(Object.entries(right).sort()));
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseEnvFile(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function parseArgs(argv) {
  const result = { profile: null, harnesses: [] };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--profile") result.profile = argv[++index] ?? null;
    else if (argv[index] === "--harness") result.harnesses.push(argv[++index] ?? "");
    else fail("USAGE", `unknown argument '${argv[index]}'`);
  }
  result.harnesses = [...new Set(result.harnesses.filter((value) => /^[a-z0-9_-]+$/.test(value)))];
  return result;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
