import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadCandidateBuildMap,
  toCandidateBuildEvidence,
  type CandidateBuildArtifactV1,
  type CandidateBuildMapV1,
} from "./build-map.js";
import { materializeLocalArtifact } from "./materialize-local.js";

/**
 * The narrow AnyHarness handoff consumer
 * (specs/developing/testing/candidate-build-handoff.md "Real handoff smoke"):
 * materialize the mapped bytes into run-owned storage, launch that exact
 * binary with an isolated runtime home and an ephemeral port, require
 * `/health` status/version/runtime-home to match, and terminate reliably.
 * Cleanup is registered directly in `finally` — deliberately not a generic
 * cleanup framework.
 */

export interface AnyharnessHealth {
  status: string;
  version: string;
  runtime_home: string;
}

export interface HandoffSmokeProof {
  artifact: { artifact_id: string; version: string; sha256: string };
  health: AnyharnessHealth;
}

export interface HandoffSmokeOptions {
  map: CandidateBuildMapV1;
  /** Defaults to the single `anyharness/...` artifact in the map. */
  artifactId?: string;
  /** Bounded readiness timeout for /health. */
  timeoutMs?: number;
  log?: (message: string) => void;
}

const CANDIDATE_CHILD_ENV_KEYS = [
  "PATH",
  "Path",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "RUST_LOG",
  "RUST_BACKTRACE",
  "NO_COLOR",
  "SYSTEMROOT",
  "WINDIR",
] as const;

/**
 * Candidate processes receive only operational environment settings. Provider,
 * billing, cloud, developer-home, and native-agent credentials stay in the
 * qualification controller that owns them rather than leaking into the exact
 * bytes under test.
 */
export function candidateChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CANDIDATE_CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

export async function runAnyharnessHandoffSmoke(options: HandoffSmokeOptions): Promise<HandoffSmokeProof> {
  const log = options.log ?? (() => undefined);
  const artifact = pickAnyharnessArtifact(options.map, options.artifactId);
  const timeoutMs = options.timeoutMs ?? 60_000;

  // Allocated inside the try so a partial allocation (e.g. the second
  // mkdtemp failing) still cleans up whatever was created.
  let storageDir: string | undefined;
  let runtimeHome: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "candidate-handoff-artifact-"));
    runtimeHome = await mkdtemp(path.join(os.tmpdir(), "candidate-handoff-home-"));
    const binary = await materializeLocalArtifact(artifact, storageDir);
    const port = await ephemeralPort();
    log(`launching ${artifact.artifact_id} on 127.0.0.1:${port} (runtime home ${runtimeHome})`);
    child = spawn(binary, ["serve", "--host", "127.0.0.1", "--port", String(port), "--runtime-home", runtimeHome], {
      stdio: ["ignore", "ignore", "pipe"],
      // A hermetic launch: no developer runtime home, port, provider setting,
      // or credential is consulted; stderr stays in memory for diagnostics.
      env: candidateChildEnvironment(),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exitedEarly = new Promise<never>((_, reject) => {
      child!.on("exit", (code) =>
        reject(new Error(`anyharness exited before becoming healthy (code ${code})`)),
      );
      child!.on("error", (error) => reject(new Error(`anyharness failed to launch: ${error.message}`)));
    });

    const health = await Promise.race([pollHealth(port, timeoutMs), exitedEarly]).catch((error) => {
      if (stderr.length > 0) {
        // Console diagnostics only; never propagated into evidence.
        console.error(stderr);
      }
      throw error;
    });

    if (health.status !== "ok") {
      throw new Error(`/health status is "${health.status}", expected "ok".`);
    }
    if (health.version !== artifact.version) {
      throw new Error(
        `/health version "${health.version}" does not match the build map version "${artifact.version}".`,
      );
    }
    const reportedHome = await realpath(health.runtime_home).catch(() => health.runtime_home);
    const expectedHome = await realpath(runtimeHome).catch(() => runtimeHome);
    if (reportedHome !== expectedHome) {
      throw new Error(
        `/health runtime_home "${health.runtime_home}" is not the isolated home this smoke launched.`,
      );
    }
    log(`healthy: status=ok version=${health.version}`);
    return {
      artifact: { artifact_id: artifact.artifact_id, version: artifact.version, sha256: artifact.sha256 },
      health,
    };
  } finally {
    if (child) {
      await terminate(child);
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (runtimeHome) {
      await rm(runtimeHome, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function pickAnyharnessArtifact(
  map: CandidateBuildMapV1,
  artifactId: string | undefined,
): CandidateBuildArtifactV1 {
  const candidates = map.artifacts.filter((artifact) =>
    artifactId ? artifact.artifact_id === artifactId : artifact.artifact_id.startsWith("anyharness/"),
  );
  if (candidates.length !== 1) {
    throw new Error(
      artifactId
        ? `Build map does not contain exactly one artifact "${artifactId}".`
        : `Build map must contain exactly one anyharness/<target> artifact, found ${candidates.length}.`,
    );
  }
  return candidates[0];
}

async function pollHealth(port: number, timeoutMs: number): Promise<AnyharnessHealth> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      // Each probe is individually bounded so a stalled response (accepted
      // socket, no body) cannot hang the smoke past its deadline.
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        // Wire shape is the camelCase HealthResponse contract
        // (anyharness-contract/src/v1/health.rs, rename_all = "camelCase").
        const body = (await response.json()) as { status?: unknown; version?: unknown; runtimeHome?: unknown };
        return {
          status: String(body.status ?? ""),
          version: String(body.version ?? ""),
          runtime_home: String(body.runtimeHome ?? ""),
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`/health did not become ready within ${timeoutMs}ms (last: ${lastError})`);
}

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)]);
  if (!graceful) {
    child.kill("SIGKILL");
    await exited;
  }
}

function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("could not allocate an ephemeral port")));
      }
    });
    server.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * CLI entry for `make qualification-candidate-handoff-smoke`: load + validate
 * the assembled map, launch/verify/terminate the exact binary, then run the
 * diagnostic runner with the same map and require the report's candidate
 * artifact identity to equal the launched identity.
 */
async function mainFromCli(): Promise<void> {
  const rawMapPath = argValue("--map");
  if (!rawMapPath) {
    throw new Error("usage: anyharness-smoke --map <candidate-build-map.json>");
  }
  // Resolved once: the same path string is later handed to the child runner,
  // whose working directory differs, so a relative path would change meaning.
  const mapPath = path.resolve(rawMapPath);
  const sourceSha = (await execCapture("git", ["rev-parse", "HEAD"])).trim();
  const map = await loadCandidateBuildMap(mapPath, sourceSha);
  const proof = await runAnyharnessHandoffSmoke({ map, log: (message) => console.log(`[smoke] ${message}`) });

  const outputDir = await mkdtemp(path.join(os.tmpdir(), "candidate-handoff-report-"));
  try {
    const packageDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    await runRunner(packageDir, mapPath, outputDir);
    const report = JSON.parse(await readFile(await findReport(outputDir), "utf8")) as {
      schema_version: number;
      candidate_build: { artifacts: Array<{ artifact_id: string; version: string; sha256: string }> } | null;
      selected_cells?: unknown[];
    };
    // The smoke consumes report V3 only — a runner emitting an older schema
    // (or an empty exact-cell plan) is a regression, not acceptable evidence.
    if (report.schema_version !== 3 || !Array.isArray(report.selected_cells) || report.selected_cells.length === 0) {
      throw new Error("Runner did not produce a valid schema_version 3 report with a non-empty exact-cell plan.");
    }
    const expected = toCandidateBuildEvidence(map);
    if (JSON.stringify(report.candidate_build) !== JSON.stringify(expected)) {
      throw new Error("Report candidate_build does not equal the launched build map identity.");
    }
    console.log(
      `[smoke] report evidence matches launched artifact ` +
        `${proof.artifact.artifact_id}@${proof.artifact.version} (${proof.artifact.sha256.slice(0, 12)}…)`,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function execCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function runRunner(packageDir: string, mapPath: string, outputDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/cli/run.ts",
        "--behavior",
        "diagnostic",
        "--dry-run",
        "--candidate-build-map",
        mapPath,
        "--output-dir",
        outputDir,
      ],
      { cwd: packageDir, stdio: ["ignore", "inherit", "inherit"] },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`diagnostic runner exited ${code}`)),
    );
  });
}

async function findReport(outputDir: string): Promise<string> {
  const stack = [outputDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === "qualification-evidence.json") {
        return full;
      }
    }
  }
  throw new Error("diagnostic runner wrote no qualification-evidence.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mainFromCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
