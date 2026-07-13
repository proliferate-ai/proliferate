/**
 * Spawns and stops a run-scoped local AnyHarness runtime process for the
 * `SH-BASE-TURN` scenario action. This mirrors packaged Desktop's own local
 * runtime (`make dev-runtime` / the Tauri sidecar): same binary
 * (`anyharness serve`), just given an isolated `--runtime-home` and
 * `--port` so this run never collides with a developer's own profile or
 * another concurrent run. Registered in the cleanup ledger immediately after
 * the process is spawned, before it is handed to any caller.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

import type { LocalFileLedger } from "./local-ledger.js";
import { ResourceAlreadyAbsentError } from "./local-ledger.js";

export interface LocalAnyharnessOptions {
  readonly binaryPath: string;
  readonly runtimeHome: string;
  readonly port: number;
  readonly runId: string;
  readonly ledger: LocalFileLedger;
  readonly owningWorld: string;
  readonly log?: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LocalAnyharnessProcess {
  readonly baseUrl: string;
  readonly runtimeHome: string;
  stop(): Promise<void>;
}

export async function startLocalAnyharness(options: LocalAnyharnessOptions): Promise<LocalAnyharnessProcess> {
  const log = options.log ?? (() => {});
  await mkdir(options.runtimeHome, { recursive: true });

  const child: ChildProcess = spawn(
    options.binaryPath,
    ["serve", "--port", String(options.port), "--runtime-home", options.runtimeHome],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env, ANYHARNESS_DEV_CORS: "1" },
    },
  );
  child.stdout?.on("data", (chunk) => log(`[anyharness] ${chunk.toString().trimEnd()}`));
  child.stderr?.on("data", (chunk) => log(`[anyharness] ${chunk.toString().trimEnd()}`));

  const pid = child.pid;
  if (!pid) throw new Error("startLocalAnyharness: spawn returned no pid");

  await options.ledger.registerResource(
    {
      runId: options.runId,
      shardId: "",
      provider: "local-process",
      resourceType: "anyharness-runtime",
      resourceId: `pid:${pid}`,
      owningWorld: options.owningWorld,
    },
    async () => {
      if (child.exitCode !== null || child.killed) {
        throw new ResourceAlreadyAbsentError();
      }
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
        sleep(5_000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await rm(options.runtimeHome, { recursive: true, force: true }).catch(() => {});
    },
  );

  const baseUrl = `http://127.0.0.1:${options.port}`;
  await waitForHealth(baseUrl, 60, 1_000);
  log(`[anyharness] ready at ${baseUrl} (pid ${pid}, home ${options.runtimeHome})`);

  return {
    baseUrl,
    runtimeHome: options.runtimeHome,
    stop: async () => {
      if (child.exitCode !== null || child.killed) return;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
        sleep(5_000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function waitForHealth(baseUrl: string, attempts: number, delayMs: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`GET /health -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(delayMs);
  }
  throw new Error(`waitForHealth: ${baseUrl}/health never became healthy: ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
