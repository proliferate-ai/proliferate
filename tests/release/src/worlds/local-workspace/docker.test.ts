import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import {
  dockerInternalUrls,
  loadServerImage,
  removeNetworkWithRetry,
  startDockerStack,
  type DockerResourceKind,
  type Exec,
  type ServerContainerEnv,
} from "./docker.js";
import type { ReadinessFetch } from "./processes.js";

function recordingExec(handlers: Record<string, () => { stdout: string; stderr: string }> = {}): {
  exec: Exec;
  argv: string[][];
} {
  const argv: string[][] = [];
  const exec: Exec = async (file, args) => {
    argv.push([file, ...args]);
    const joined = args.join(" ");
    for (const [needle, make] of Object.entries(handlers)) {
      if (joined.includes(needle)) {
        return make();
      }
    }
    return { stdout: "", stderr: "" };
  };
  return { exec, argv };
}

test("dockerInternalUrls builds run-scoped hostnames matching the container names", () => {
  const { databaseUrl, redisUrl } = dockerInternalUrls({ project: "plq-run-shard", network: "plq-run-shard-net" });
  assert.match(databaseUrl, /@plq-run-shard-postgres:5432\/proliferate$/);
  assert.match(redisUrl, /@?plq-run-shard-redis:6379\/0$/);
});

test("loadServerImage parses a named loaded image ref", async () => {
  const { exec } = recordingExec({ load: () => ({ stdout: "Loaded image: proliferate-server:candidate\n", stderr: "" }) });
  assert.equal(await loadServerImage("/tmp/server.tar", { exec }), "proliferate-server:candidate");
});

test("loadServerImage falls back to a loaded image ID", async () => {
  const { exec } = recordingExec({ load: () => ({ stdout: "Loaded image ID: sha256:abcdef\n", stderr: "" }) });
  assert.equal(await loadServerImage("/tmp/server.tar", { exec }), "sha256:abcdef");
});

const SERVER_ARTIFACT: MaterializedArtifact = {
  artifact_id: "server/linux-amd64",
  version: "1.2.3",
  sha256: "b".repeat(64),
  path: "/run/artifacts/server.tar",
};

const SERVER_ENV: ServerContainerEnv = {
  SINGLE_ORG_MODE: "true",
  AGENT_GATEWAY_ENABLED: "true",
  AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS: "5",
  AGENT_GATEWAY_LITELLM_BASE_URL: "http://admin",
  AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL: "http://public",
  AGENT_GATEWAY_LITELLM_MASTER_KEY: "sk-master",
  SETUP_TOKEN_FILE: "/tmp/proliferate-setup/setup-token",
  DATABASE_URL: "postgresql+asyncpg://proliferate:localdev@plq-postgres:5432/proliferate",
};

const SETUP_TOKEN = {
  setupTokenContainerPath: "/tmp/proliferate-setup/setup-token",
  setupTokenHostPath: "/run/setup-token",
};

test("startDockerStack registers each resource before creating it and verifies readiness", async () => {
  const { exec, argv } = recordingExec({
    load: () => ({ stdout: "Loaded image: srv:candidate\n", stderr: "" }),
    "pg_isready": () => ({ stdout: "accepting connections", stderr: "" }),
  });
  const registered: Array<{ kind: DockerResourceKind; providerId: string }> = [];
  const fetch: ReadinessFetch = async () => ({ ok: true, status: 200, json: async () => ({ version: "1.2.3" }) });
  const runDir = await mkdtemp(path.join(os.tmpdir(), "q1-docker-"));

  try {
  const running = await startDockerStack({
    naming: { project: "plq-run-shard", network: "plq-run-shard-net" },
    ports: { server: 8100, postgres: 8101, redis: 8102 },
    serverArtifact: SERVER_ARTIFACT,
    serverEnv: SERVER_ENV,
    runDir,
    ...SETUP_TOKEN,
    registerCleanup: async (kind, providerId) => {
      registered.push({ kind, providerId });
    },
    deps: { exec, fetch },
  });

  assert.equal(running.version, "1.2.3");
  assert.equal(running.imageRef, "srv:candidate");

  // The master key never appears in `docker run` argv; it is passed via a
  // mode-0600 `--env-file` in the run dir, registered for cleanup.
  const secretEnvFilePath = path.join(runDir, "server-secret.env");
  for (const cmd of argv) {
    assert.ok(!cmd.some((arg) => arg.includes("sk-master")), `master key leaked into argv: ${cmd.join(" ")}`);
  }
  const serverRun = argv.find((cmd) => cmd.includes("--name") && cmd.includes("plq-run-shard-server"));
  assert.ok(serverRun);
  assert.ok(serverRun!.includes("--env-file"));
  assert.equal(serverRun![serverRun!.indexOf("--env-file") + 1], secretEnvFilePath);
  const envFileBody = await readFile(secretEnvFilePath, "utf8");
  assert.match(envFileBody, /^AGENT_GATEWAY_LITELLM_MASTER_KEY=sk-master$/m);
  assert.equal(((await stat(secretEnvFilePath)).mode & 0o777).toString(8), "600");
  assert.deepEqual(registered[0], { kind: "secret_env_file", providerId: secretEnvFilePath });

  // The real first-run setup token is copied out of the running Server via
  // `docker cp` — the world/fixture consumes the real product path, not a bypass.
  const cp = argv.find((cmd) => cmd[0] === "docker" && cmd[1] === "cp");
  assert.ok(cp, "expected a `docker cp` of the setup token");
  assert.equal(cp![2], "plq-run-shard-server:/tmp/proliferate-setup/setup-token");
  assert.equal(cp![3], "/run/setup-token");

  // Secret env-file registered first (torn down last); network next; server
  // registered after migration.
  assert.deepEqual(
    registered.map((entry) => entry.kind),
    ["secret_env_file", "docker_network", "postgres_container", "redis_container", "server_container"],
  );

  // A `docker network create` happened AFTER the network was registered.
  const networkRegisteredAt = registered.findIndex((entry) => entry.kind === "docker_network");
  assert.equal(networkRegisteredAt, 1);
  const ranNetworkCreate = argv.some((cmd) => cmd.includes("network") && cmd.includes("create"));
  assert.ok(ranNetworkCreate);

  // The migration one-off ran `alembic upgrade head` on the loaded image, also
  // via `--env-file` (no secret in argv).
  const migration = argv.find((cmd) => cmd.includes("alembic"));
  assert.ok(migration);
  assert.ok(migration!.includes("--rm"));
  assert.ok(migration!.includes("--env-file"));
  assert.ok(migration!.includes("srv:candidate"));
  assert.deepEqual(migration!.slice(-3), ["alembic", "upgrade", "head"]);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("removeNetworkWithRetry retries through transient 'active endpoints' failures while containers detach", async () => {
  let calls = 0;
  const exec: Exec = async (_file, args) => {
    if (args[0] === "network" && args[1] === "rm") {
      calls += 1;
      if (calls < 3) {
        throw new Error(`network plq-run-net has active endpoints`);
      }
      return { stdout: "", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  const sleeps: number[] = [];
  await removeNetworkWithRetry(exec, "plq-run-net", async (ms) => {
    sleeps.push(ms);
  });
  assert.equal(calls, 3);
  // Two retries were needed, so two backoff sleeps happened before success.
  assert.deepEqual(sleeps, [500, 1000]);
});

test("removeNetworkWithRetry treats an already-removed network as success without retrying", async () => {
  let calls = 0;
  const exec: Exec = async () => {
    calls += 1;
    throw new Error("Error: No such network: plq-run-net");
  };
  await removeNetworkWithRetry(exec, "plq-run-net", async () => {
    throw new Error("should not sleep for a not-found network");
  });
  assert.equal(calls, 1);
});

test("removeNetworkWithRetry exhausts its retry budget and throws the last error", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    removeNetworkWithRetry(
      async () => {
        calls += 1;
        throw new Error("network plq-run-net has active endpoints");
      },
      "plq-run-net",
      async (ms) => {
        sleeps.push(ms);
      },
    ),
    /active endpoints/,
  );
  // 5 backoff delays between 6 attempts (1 initial + 5 retries).
  assert.equal(calls, 6);
  assert.deepEqual(sleeps, [500, 1000, 2000, 3000, 3000]);
});

test("startDockerStack fails when the server never reports version-bearing health", async () => {
  const { exec } = recordingExec({
    load: () => ({ stdout: "Loaded image: srv:candidate\n", stderr: "" }),
    "pg_isready": () => ({ stdout: "ok", stderr: "" }),
  });
  const fetch: ReadinessFetch = async () => {
    throw new Error("refused");
  };
  const runDir = await mkdtemp(path.join(os.tmpdir(), "q1-docker-"));
  try {
    await assert.rejects(
      startDockerStack({
        naming: { project: "plq-r", network: "plq-r-net" },
        ports: { server: 8100, postgres: 8101, redis: 8102 },
        serverArtifact: SERVER_ARTIFACT,
        serverEnv: SERVER_ENV,
        runDir,
        ...SETUP_TOKEN,
        registerCleanup: async () => undefined,
        timeoutMs: 300,
        deps: { exec, fetch },
      }),
      /did not become ready/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
