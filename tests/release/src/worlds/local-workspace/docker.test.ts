import assert from "node:assert/strict";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import {
  dockerInternalUrls,
  loadServerImage,
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

  const running = await startDockerStack({
    naming: { project: "plq-run-shard", network: "plq-run-shard-net" },
    ports: { server: 8100, postgres: 8101, redis: 8102 },
    serverArtifact: SERVER_ARTIFACT,
    serverEnv: SERVER_ENV,
    ...SETUP_TOKEN,
    registerCleanup: async (kind, providerId) => {
      registered.push({ kind, providerId });
    },
    deps: { exec, fetch },
  });

  assert.equal(running.version, "1.2.3");
  assert.equal(running.imageRef, "srv:candidate");

  // The real first-run setup token is copied out of the running Server via
  // `docker cp` — the world/fixture consumes the real product path, not a bypass.
  const cp = argv.find((cmd) => cmd[0] === "docker" && cmd[1] === "cp");
  assert.ok(cp, "expected a `docker cp` of the setup token");
  assert.equal(cp![2], "plq-run-shard-server:/tmp/proliferate-setup/setup-token");
  assert.equal(cp![3], "/run/setup-token");

  // Network registered first (torn down last); server registered after migration.
  assert.deepEqual(
    registered.map((entry) => entry.kind),
    ["docker_network", "postgres_container", "redis_container", "server_container"],
  );

  // A `docker network create` happened AFTER the network was registered.
  const networkRegisteredAt = registered.findIndex((entry) => entry.kind === "docker_network");
  assert.equal(networkRegisteredAt, 0);
  const ranNetworkCreate = argv.some((cmd) => cmd.includes("network") && cmd.includes("create"));
  assert.ok(ranNetworkCreate);

  // The migration one-off ran `alembic upgrade head` on the loaded image.
  const migration = argv.find((cmd) => cmd.includes("alembic"));
  assert.ok(migration);
  assert.ok(migration!.includes("--rm"));
  assert.ok(migration!.includes("srv:candidate"));
  assert.deepEqual(migration!.slice(-3), ["alembic", "upgrade", "head"]);
});

test("startDockerStack fails when the server never reports version-bearing health", async () => {
  const { exec } = recordingExec({
    load: () => ({ stdout: "Loaded image: srv:candidate\n", stderr: "" }),
    "pg_isready": () => ({ stdout: "ok", stderr: "" }),
  });
  const fetch: ReadinessFetch = async () => {
    throw new Error("refused");
  };
  await assert.rejects(
    startDockerStack({
      naming: { project: "plq-r", network: "plq-r-net" },
      ports: { server: 8100, postgres: 8101, redis: 8102 },
      serverArtifact: SERVER_ARTIFACT,
      serverEnv: SERVER_ENV,
      ...SETUP_TOKEN,
      registerCleanup: async () => undefined,
      timeoutMs: 300,
      deps: { exec, fetch },
    }),
    /did not become ready/,
  );
});
