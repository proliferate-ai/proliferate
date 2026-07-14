import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import { candidateChildEnvironment } from "../../artifacts/anyharness-smoke.js";

/**
 * Bounded host-process launch, readiness, and termination for the two
 * long-lived local processes this world owns directly: the exact host
 * AnyHarness binary and the static Desktop-renderer file server (spec "World
 * startup" steps 7–8, 10). The Docker-managed Server/Postgres/Redis live in
 * `docker.ts`.
 *
 * Every child receives a hermetic environment: no ambient provider credential,
 * no `ANTHROPIC_AUTH_TOKEN`, and no shared `RELEASE_E2E_GATEWAY_TEST_KEY`
 * process-env shortcut (spec "The single test cell"). Reuse
 * `candidateChildEnvironment()` from `../../artifacts/anyharness-smoke.ts` as
 * the operational-only base.
 */

/** Injectable process seam — real `spawn` in production, a fake in unit tests. */
export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** Injectable HTTP readiness seam — real `fetch` in production, fake under test. */
export type ReadinessFetch = (
  url: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Env keys that must never reach a candidate child (belt-and-suspenders on top
 * of the allowlisting `candidateChildEnvironment`). */
const FORBIDDEN_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "AGENT_GATEWAY_MANAGED_ANTHROPIC_API_KEY",
  "RELEASE_E2E_GATEWAY_TEST_KEY",
];
const FORBIDDEN_ENV_SUFFIXES = ["_API_KEY", "_AUTH_TOKEN", "_MASTER_KEY", "_SECRET"];

export interface LaunchedProcess {
  child: ChildProcess;
  /** Bounded, reverse-order-safe terminator (SIGTERM → SIGKILL fallback). */
  terminate(): Promise<void>;
}

export interface LaunchAnyharnessOptions {
  /** Absolute path to the materialized AnyHarness binary. */
  binaryPath: string;
  host: string;
  port: number;
  /** Isolated runtime home (spec: `--runtime-home` flag). */
  runtimeHome: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  log?: (message: string) => void;
  spawn?: SpawnLike;
  fetch?: ReadinessFetch;
}

/** AnyHarness `/health` (camelCase wire shape → snake_case here). */
export interface AnyharnessHealth {
  status: string;
  version: string;
  runtimeHome: string;
}

/**
 * Launches the exact AnyHarness binary with an isolated runtime home and a
 * hermetic env, waits for bounded `/health` readiness, and returns the process
 * handle plus the parsed health (version is verified against the candidate map
 * by the world constructor).
 */
export async function launchAnyharness(
  options: LaunchAnyharnessOptions,
): Promise<{ process: LaunchedProcess; health: AnyharnessHealth; baseUrl: string }> {
  const log = options.log ?? (() => undefined);
  const spawnImpl = options.spawn ?? (nodeSpawn as SpawnLike);
  const fetchImpl = options.fetch ?? defaultReadinessFetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const baseUrl = `http://${options.host}:${options.port}`;

  const env = assertHermeticEnv(candidateChildEnvironment(options.env ?? process.env));
  log(`launching anyharness on ${options.host}:${options.port} (runtime home ${options.runtimeHome})`);
  const child = spawnImpl(
    options.binaryPath,
    ["serve", "--host", options.host, "--port", String(options.port), "--runtime-home", options.runtimeHome],
    { stdio: ["ignore", "ignore", "pipe"], env },
  );
  const launched = wrapProcess(child);
  const stop = new AbortController();
  try {
    const exitedEarly = earlyExit(child, "anyharness");
    // The losing branch of the race stays pending; swallow its late rejection
    // (e.g. when `terminate()` later fires `exit`) so it is never unhandled.
    exitedEarly.catch(() => undefined);
    const health = await Promise.race([
      pollAnyharnessHealth(baseUrl, timeoutMs, fetchImpl, stop.signal),
      exitedEarly,
    ]);
    if (health.status !== "ok") {
      throw new Error(`anyharness /health status is "${health.status}", expected "ok".`);
    }
    return { process: launched, health, baseUrl };
  } catch (error) {
    await launched.terminate();
    throw error;
  } finally {
    // Whichever branch won, cancel the loser's poll loop so no timer lingers.
    stop.abort();
  }
}

export interface LaunchRendererServerOptions {
  /** Directory of the extracted Desktop renderer dist. */
  rootDir: string;
  host: string;
  port: number;
  timeoutMs?: number;
  log?: (message: string) => void;
  spawn?: SpawnLike;
  fetch?: ReadinessFetch;
}

/** Inline Node static file server: SPA-fallback to index.html, path-escape
 * guarded, served over the allocated port. Kept inline (no extra file) so the
 * whole renderer server is one hermetic child process. */
const STATIC_SERVER_SOURCE = `
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[1]);
const host = process.argv[2];
const port = Number(process.argv[3]);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  try {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    let file = path.join(root, rel);
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end("forbidden"); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    const body = fs.readFileSync(file);
    res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(body);
  } catch (e) { res.statusCode = 500; res.end("error"); }
});
server.listen(port, host);
`;

/**
 * Serves the extracted renderer bytes over a bounded static file server on the
 * allocated port and waits until the root document is reachable.
 */
export async function launchRendererServer(
  options: LaunchRendererServerOptions,
): Promise<{ process: LaunchedProcess; baseUrl: string }> {
  const log = options.log ?? (() => undefined);
  const spawnImpl = options.spawn ?? (nodeSpawn as SpawnLike);
  const fetchImpl = options.fetch ?? defaultReadinessFetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const baseUrl = `http://${options.host}:${options.port}`;

  log(`serving renderer from ${options.rootDir} on ${options.host}:${options.port}`);
  const child = spawnImpl(
    process.execPath,
    ["-e", STATIC_SERVER_SOURCE, options.rootDir, options.host, String(options.port)],
    { stdio: ["ignore", "ignore", "pipe"], env: candidateChildEnvironment() },
  );
  const launched = wrapProcess(child);
  const stop = new AbortController();
  try {
    const exitedEarly = earlyExit(child, "renderer server");
    exitedEarly.catch(() => undefined);
    await Promise.race([
      waitForHttpReady(baseUrl, { timeoutMs, log, fetch: fetchImpl, signal: stop.signal }),
      exitedEarly,
    ]);
    return { process: launched, baseUrl };
  } catch (error) {
    await launched.terminate();
    throw error;
  } finally {
    stop.abort();
  }
}

/** Polls an HTTP URL until it responds OK or the bounded deadline elapses. */
export async function waitForHttpReady(
  url: string,
  options: {
    timeoutMs: number;
    expectOk?: (status: number) => boolean;
    log?: (m: string) => void;
    fetch?: ReadinessFetch;
    /** Cancels the poll loop early when the caller's race is decided elsewhere. */
    signal?: AbortSignal;
  },
): Promise<void> {
  const fetchImpl = options.fetch ?? defaultReadinessFetch;
  const expectOk = options.expectOk ?? ((status) => status >= 200 && status < 500);
  const deadline = Date.now() + options.timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline && !options.signal?.aborted) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(2_000) });
      if (expectOk(response.status)) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  if (options.signal?.aborted) {
    return; // Superseded by another branch; not a readiness failure.
  }
  throw new Error(`${url} did not become ready within ${options.timeoutMs}ms (last: ${lastError})`);
}

/** SIGTERM with a bounded grace period, then SIGKILL; resolves on exit. */
export async function terminateProcess(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
  if (!graceful) {
    child.kill("SIGKILL");
    await exited;
  }
}

function wrapProcess(child: ChildProcess): LaunchedProcess {
  return { child, terminate: () => terminateProcess(child) };
}

function earlyExit(child: ChildProcess, label: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    child.on("exit", (code) => reject(new Error(`${label} exited before becoming healthy (code ${code})`)));
    child.on("error", (error) => reject(new Error(`${label} failed to launch: ${error.message}`)));
  });
}

async function pollAnyharnessHealth(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: ReadinessFetch,
  signal?: AbortSignal,
): Promise<AnyharnessHealth> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      // Superseded (the process-exit branch won); park forever without a timer
      // so this loser never rejects and never holds the event loop open.
      return new Promise<AnyharnessHealth>(() => undefined);
    }
    try {
      const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        // Wire shape is the camelCase HealthResponse contract
        // (anyharness-contract/src/v1/health.rs, rename_all = "camelCase").
        const body = (await response.json()) as { status?: unknown; version?: unknown; runtimeHome?: unknown };
        return {
          status: String(body.status ?? ""),
          version: String(body.version ?? ""),
          runtimeHome: String(body.runtimeHome ?? ""),
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`anyharness /health did not become ready within ${timeoutMs}ms (last: ${lastError})`);
}

/** Rejects an env that carries any provider/gateway credential. */
function assertHermeticEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (FORBIDDEN_ENV_KEYS.includes(upper) || FORBIDDEN_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix))) {
      throw new Error(`Hermetic candidate env must not contain "${key}".`);
    }
  }
  return env;
}

const defaultReadinessFetch: ReadinessFetch = (url, init) =>
  fetch(url, init as RequestInit) as unknown as ReturnType<ReadinessFetch>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
