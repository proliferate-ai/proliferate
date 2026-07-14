import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import { waitForHttpReady, type ReadinessFetch } from "./processes.js";

/**
 * Run-scoped Docker lifecycle for the exact candidate Server plus its fresh
 * Postgres and Redis (spec "World startup" steps 3–6). Everything is namespaced
 * by a run-scoped Docker project + network so two concurrent runs never
 * collide. The Server image is loaded from the exact `docker save` archive; its
 * running version is verified against the candidate map by the world.
 *
 * The Server container env is fixed by the spec:
 *   - SINGLE_ORG_MODE=true            (mounts `POST /setup`);
 *   - agent gateway enabled;
 *   - a short AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS (fast enrollment);
 *   - AGENT_GATEWAY_LITELLM_* passthrough (base/public/master — the master key
 *     stays inside the container env, never in evidence).
 * Migrations run via a separate `alembic upgrade head` one-off run of the same
 * image (its CMD is uvicorn only).
 */

/** Injectable exec seam — real `execFile` in production, a fake in unit tests. */
export type Exec = (
  file: string,
  args: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface DockerDeps {
  exec?: Exec;
  fetch?: ReadinessFetch;
}

/** Fixed local DB/Redis identities the run-scoped containers are created with;
 * mirrors the Server's default DSN so the values are familiar. The Server env's
 * DATABASE_URL/REDBEAT_REDIS_URL (built by the world) must reference these. */
export const POSTGRES_USER = "proliferate";
export const POSTGRES_PASSWORD = "localdev";
export const POSTGRES_DB = "proliferate";
const POSTGRES_IMAGE = "postgres:16-alpine";
const REDIS_IMAGE = "redis:7-alpine";
const SERVER_INTERNAL_PORT = 8000;

export interface DockerNaming {
  /** Run-scoped compose/project label, e.g. `plq-<run>-<shard>`. */
  project: string;
  /** Run-scoped user-defined network name. */
  network: string;
}

export interface DockerPorts {
  /** Host port mapped to the Server container's HTTP port. */
  server: number;
  postgres: number;
  redis: number;
}

export interface ServerContainerEnv {
  SINGLE_ORG_MODE: "true";
  AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS: string;
  AGENT_GATEWAY_LITELLM_BASE_URL: string;
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: string;
  AGENT_GATEWAY_LITELLM_MASTER_KEY: string;
  /** Additional required Server settings (DB/Redis URLs, gateway enable flag). */
  [key: string]: string;
}

export interface DockerStackOptions {
  naming: DockerNaming;
  ports: DockerPorts;
  serverArtifact: MaterializedArtifact;
  serverEnv: ServerContainerEnv;
  /** Registers each container/network releaser as it is created. */
  registerCleanup: (kind: DockerResourceKind, providerId: string, release: () => Promise<void>) => Promise<void>;
  timeoutMs?: number;
  log?: (message: string) => void;
  deps?: DockerDeps;
}

export type DockerResourceKind =
  | "postgres_container"
  | "redis_container"
  | "server_container"
  | "docker_network";

export interface RunningServer {
  baseUrl: string;
  /** Loaded image tag/ref used for the container and the migration one-off. */
  imageRef: string;
  /** Reported Server version, verified against the candidate map by the world. */
  version: string;
}

/** Container hostnames + connection URLs on the run network (built from naming
 * so the world can construct the Server's DATABASE_URL/REDBEAT_REDIS_URL). */
export function dockerInternalUrls(naming: DockerNaming): { databaseUrl: string; redisUrl: string } {
  const pgHost = `${naming.project}-postgres`;
  const redisHost = `${naming.project}-redis`;
  return {
    databaseUrl: `postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${pgHost}:5432/${POSTGRES_DB}`,
    redisUrl: `redis://${redisHost}:6379/0`,
  };
}

/** Loads the exact Server image archive; returns the local image ref/tag. */
export async function loadServerImage(archivePath: string, deps: DockerDeps = {}): Promise<string> {
  const exec = deps.exec ?? defaultExec;
  const { stdout } = await exec("docker", ["load", "-i", archivePath]);
  const ref = parseLoadedImageRef(stdout);
  if (!ref) {
    throw new Error(`Could not parse a loaded image ref from \`docker load\` output.`);
  }
  return ref;
}

/** Parses `Loaded image: <ref>` or `Loaded image ID: sha256:<hex>`. */
function parseLoadedImageRef(stdout: string): string | null {
  const named = stdout.match(/Loaded image:\s*(\S+)/);
  if (named) {
    return named[1];
  }
  const byId = stdout.match(/Loaded image ID:\s*(\S+)/);
  return byId ? byId[1] : null;
}

/**
 * Brings up the run-scoped network, Postgres, and Redis; runs `alembic upgrade
 * head` as a one-off of the exact image; then starts the Server container with
 * the fixed env and waits for bounded readiness. Each resource registers its
 * cleanup before creation.
 */
export async function startDockerStack(options: DockerStackOptions): Promise<RunningServer> {
  const exec = options.deps?.exec ?? defaultExec;
  const fetchImpl = options.deps?.fetch;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const { naming, ports } = options;

  const imageRef = await loadServerImage(options.serverArtifact.path, options.deps);
  log(`loaded server image ${imageRef}`);

  // Network first so it is registered first and therefore torn down LAST
  // (reverse order), after every container that attaches to it.
  await options.registerCleanup("docker_network", naming.network, () =>
    ignoreMissing(exec("docker", ["network", "rm", naming.network])),
  );
  await exec("docker", ["network", "create", naming.network]);

  const pgName = `${naming.project}-postgres`;
  await options.registerCleanup("postgres_container", pgName, () =>
    ignoreMissing(exec("docker", ["rm", "-f", pgName])),
  );
  await exec("docker", [
    "run", "-d", "--name", pgName, "--network", naming.network,
    "-e", `POSTGRES_USER=${POSTGRES_USER}`,
    "-e", `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    "-e", `POSTGRES_DB=${POSTGRES_DB}`,
    "-p", `127.0.0.1:${ports.postgres}:5432`,
    POSTGRES_IMAGE,
  ]);

  const redisName = `${naming.project}-redis`;
  await options.registerCleanup("redis_container", redisName, () =>
    ignoreMissing(exec("docker", ["rm", "-f", redisName])),
  );
  await exec("docker", [
    "run", "-d", "--name", redisName, "--network", naming.network,
    "-p", `127.0.0.1:${ports.redis}:6379`,
    REDIS_IMAGE,
  ]);

  await waitForPostgres(exec, pgName, timeoutMs, log);

  await runMigrations({ imageRef, naming, serverEnv: options.serverEnv, timeoutMs, log, deps: { exec } });
  log(`migrations applied via ${imageRef}`);

  const serverName = `${naming.project}-server`;
  await options.registerCleanup("server_container", serverName, () =>
    ignoreMissing(exec("docker", ["rm", "-f", serverName])),
  );
  await exec("docker", [
    "run", "-d", "--name", serverName, "--network", naming.network,
    "-p", `127.0.0.1:${ports.server}:${SERVER_INTERNAL_PORT}`,
    ...envFlags(options.serverEnv),
    imageRef,
  ]);

  const baseUrl = `http://127.0.0.1:${ports.server}`;
  await waitForHttpReady(`${baseUrl}/health`, {
    timeoutMs,
    expectOk: (status) => status === 200,
    log,
    fetch: fetchImpl,
  });
  const version = await readServerVersion(baseUrl, fetchImpl);
  log(`server healthy: version=${version}`);
  return { baseUrl, imageRef, version };
}

/** Runs `alembic upgrade head` as a one-off run of the exact image. */
export async function runMigrations(params: {
  imageRef: string;
  naming: DockerNaming;
  serverEnv: ServerContainerEnv;
  timeoutMs?: number;
  log?: (message: string) => void;
  deps?: DockerDeps;
}): Promise<void> {
  const exec = params.deps?.exec ?? defaultExec;
  await exec(
    "docker",
    [
      "run", "--rm", "--network", params.naming.network,
      ...envFlags(params.serverEnv),
      params.imageRef,
      "alembic", "upgrade", "head",
    ],
    { timeoutMs: params.timeoutMs },
  );
}

async function waitForPostgres(
  exec: Exec,
  containerName: string,
  timeoutMs: number,
  log: (message: string) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      await exec("docker", ["exec", containerName, "pg_isready", "-U", POSTGRES_USER]);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  log(`postgres did not become ready: ${lastError}`);
  throw new Error(`Postgres (${containerName}) did not become ready within ${timeoutMs}ms.`);
}

async function readServerVersion(baseUrl: string, fetchImpl?: ReadinessFetch): Promise<string> {
  const doFetch = fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) =>
    fetch(url, init as RequestInit) as unknown as ReturnType<ReadinessFetch>);
  const response = await doFetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Server /health returned HTTP ${response.status} while reading version.`);
  }
  const body = (await response.json()) as { version?: unknown };
  const version = typeof body.version === "string" ? body.version : "";
  if (!version) {
    throw new Error("Server /health did not report a version.");
  }
  return version;
}

function envFlags(env: Record<string, string>): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    flags.push("-e", `${key}=${value}`);
  }
  return flags;
}

async function ignoreMissing(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such|not found|is not running/i.test(message)) {
      return;
    }
    throw error;
  }
}

const execFileAsync = promisify(execFile);

const defaultExec: Exec = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], {
    timeout: options?.timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
