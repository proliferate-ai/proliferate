import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { QualificationLiteLlmConfig } from "../../services/qualification-litellm.js";
import type { Ec2IngressBox, Route53Record } from "./ec2.js";

/**
 * Deploys the candidate Server onto the run-scoped EC2 box and terminates TLS
 * for the run subdomain (spec "World construction" step 2). On the box, over
 * SSH, it: installs docker + Caddy, loads the EXACT Server image archive
 * (`docker load`), runs `alembic upgrade head` with that exact image, starts
 * Postgres/Redis/Server, and configures Caddy to terminate TLS for
 * `<run>.qualification.proliferate.com` (fronted by the Route53 A record).
 *
 * It produces the `candidate-api/<subdomain>` DEPLOYMENT RECEIPT: the public
 * HTTPS origin, the Server image sha256 it runs, and the EC2 instance id. This
 * receipt is a composite artifact — it binds its inputs in its own record and
 * never mutates a sibling map entry — and is folded into evidence `artifact_ids`.
 *
 * Server env on the box (spec step 3): `SINGLE_ORG_MODE=true`, gateway enabled,
 * short backfill interval, qualification LiteLLM inputs via a 0600 env file on
 * the box (never argv), GitHub App credentials for the staging qualification App
 * (`proliferate-cloud-staging`, installed on `proliferate-e2e/e2e-fixture`), and
 * E2B credentials scoped to the qualification team. No raw provider keys.
 *
 * Every side effect is behind an injectable SSH/exec/HTTP seam so unit tests
 * drive it offline with no real box, network, or docker.
 */

/** Remote workspace on the box where all candidate inputs and env files live.
 * Bind-mounted into the `candidate-server` container at the same path, so files
 * written here on the host are readable by on-box `python` seeds (see
 * `box-exec.ts`). */
export const REMOTE_WORKDIR = "/home/ubuntu/candidate";
/** Container-writable path the Server writes its first-run setup token to. */
const REMOTE_SETUP_TOKEN_PATH = `${REMOTE_WORKDIR}/setup-token`;
/** The App private-key PEM on the box (mounted into the Server container via REMOTE_WORKDIR). */
const REMOTE_GITHUB_KEY_PATH = `${REMOTE_WORKDIR}/github-app-private-key.pem`;
/** Server container port Caddy reverse-proxies to. */
// The server image's uvicorn CMD listens on 8000 (Dockerfile: `--port 8000`,
// EXPOSE 8000). The host port mapping and the Caddy reverse_proxy must target
// 8000, not 8080, or Caddy proxies to a dead port and every request is a 502.
const SERVER_CONTAINER_PORT = 8000;

/**
 * The `candidate-api/<subdomain>` deployment receipt. Shaped like a
 * `MaterializedArtifact` (artifact_id / version / sha256 / and here the public
 * origin) so it folds into evidence uniformly. `sha256` is the Server image
 * digest it runs; `version` is the Server version reported by `/health`.
 */
export interface CandidateApiReceipt {
  /** `candidate-api/<run-scoped subdomain>`. */
  artifact_id: string;
  /** Server version reported over public TLS `/health`. */
  version: string;
  /** sha256 of the exact Server image archive loaded on the box. */
  sha256: string;
  /** Public HTTPS origin, e.g. `https://<run>.qualification.proliferate.com`. */
  publicOrigin: string;
  /** The EC2 instance the Server runs on (safe identifier). */
  ec2InstanceId: string;
}

/** The GitHub App credentials the candidate Server runs with (typed; no raw key values in fields). */
export interface CandidateGithubAppConfig {
  /** Staging qualification App slug (`proliferate-cloud-staging`). */
  appSlug: string;
  appId: string;
  clientId: string;
  /** Installation on `proliferate-e2e/e2e-fixture`. */
  installationId: string;
  /**
   * Path to the mode-0600 env file holding the single-line App client secret
   * (uploaded to the box, fed to `docker --env-file`).
   */
  secretsEnvFilePath: string;
  /**
   * Path to the mode-0600 PEM file holding the App private key. Uploaded to the
   * box and MOUNTED into the Server container (`docker --env-file` cannot carry a
   * multi-line PEM), referenced via `GITHUB_APP_PRIVATE_KEY_PATH`.
   */
  privateKeyPemPath: string;
}

/** E2B credentials scoped to the qualification team (path to a 0600 env file; no values in fields). */
export interface CandidateE2bConfig {
  teamId: string;
  /** Path to the mode-0600 file holding the E2B API key (uploaded to the box). */
  secretsEnvFilePath: string;
  /**
   * Run-scoped template alias the Server provisions sandboxes from
   * (`Sandbox.create(settings.e2b_template_name)`). Deterministic before the
   * template build, so it can be written into the boot env; without it the
   * Server's cloud-provisioning config gate 503s every /cloud-sandbox/ensure.
   */
  templateName: string;
}

export interface DeployCandidateApiOptions {
  box: Ec2IngressBox;
  record: Route53Record;
  /** The materialized (re-hashed) Server image archive. */
  serverArtifact: MaterializedArtifact;
  litellm: QualificationLiteLlmConfig;
  github: CandidateGithubAppConfig;
  e2b: CandidateE2bConfig;
  /** Public origin the receipt records (`https://<record.recordName>`). */
  publicOrigin: string;
  /** The local renderer origin the browser loads (added to the Server CORS allowlist). */
  rendererOrigin: string;
  /** Local mode-0700 dir where the generated 0600 server env file + Caddyfile are staged. */
  secretsDir: string;
  /** Local path the first-run setup token is copied down to (for the actor claim). */
  setupTokenHostPath: string;
  /** Injectable SSH-exec seam (fake in unit tests). */
  ssh: SshExec;
  /** Injectable readiness probe over public TLS (fake in unit tests). */
  probeHealth: (origin: string) => Promise<{ ok: boolean; version: string }>;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Minimal SSH/exec + file-copy seam for on-box deployment. */
export interface SshExec {
  run(destination: string, keyPath: string, command: string): Promise<{ stdout: string; stderr: string }>;
  copyFile(destination: string, keyPath: string, localPath: string, remotePath: string): Promise<void>;
}

/**
 * Deploys the candidate Server + Caddy TLS onto the box and returns the
 * `candidate-api/<subdomain>` receipt once `/health` responds over public TLS
 * with a version equal to the Server artifact's version.
 */
export async function deployCandidateApi(options: DeployCandidateApiOptions): Promise<CandidateApiReceipt> {
  const { box, ssh, serverArtifact } = options;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const dest = box.sshDestination;
  const key = box.keyPath;

  // Wait for cloud-init (docker installed + ready sentinel) before any deploy step.
  await waitForBox(ssh, dest, key, timeoutMs, log);

  // Build the mode-0600 Server env file LOCALLY (secret VALUES live only in this
  // file, never in an SSH command argv) and stage the Caddyfile beside it.
  await mkdir(options.secretsDir, { recursive: true, mode: 0o700 });
  const serverEnvLocalPath = path.join(options.secretsDir, "candidate-server.env");
  await writeFile(serverEnvLocalPath, buildServerEnv(options), { mode: 0o600 });
  const caddyLocalPath = path.join(options.secretsDir, "Caddyfile");
  await writeFile(caddyLocalPath, buildCaddyfile(options.record.recordName), { mode: 0o600 });

  // Stage all inputs on the box.
  await ssh.run(dest, key, `mkdir -p ${REMOTE_WORKDIR}`);
  const remoteEnvPath = `${REMOTE_WORKDIR}/candidate-server.env`;
  const remoteGithubEnvPath = `${REMOTE_WORKDIR}/github.env`;
  const remoteE2bEnvPath = `${REMOTE_WORKDIR}/e2b.env`;
  const remoteImagePath = `${REMOTE_WORKDIR}/server-image.tar`;
  await ssh.copyFile(dest, key, serverEnvLocalPath, remoteEnvPath);
  // The App client secret and the E2B key travel as their existing single-line
  // 0600 env files (copied, not read into argv or the receipt). The App private
  // key is a multi-line PEM that `docker --env-file` cannot parse, so it is
  // staged as a mounted file and referenced via GITHUB_APP_PRIVATE_KEY_PATH;
  // it is already visible inside the Server container via the REMOTE_WORKDIR mount.
  await ssh.copyFile(dest, key, options.github.secretsEnvFilePath, remoteGithubEnvPath);
  await ssh.copyFile(dest, key, options.github.privateKeyPemPath, REMOTE_GITHUB_KEY_PATH);
  await ssh.copyFile(dest, key, options.e2b.secretsEnvFilePath, remoteE2bEnvPath);
  await ssh.copyFile(dest, key, serverArtifact.path, remoteImagePath);

  // Install Caddy and load the EXACT Server image.
  log("installing caddy and loading the candidate Server image");
  await ssh.run(dest, key, "sudo apt-get update -y && sudo apt-get install -y debian-keyring debian-archive-keyring caddy");
  const loaded = await ssh.run(dest, key, `sudo docker load -i ${remoteImagePath}`);
  const imageRef = parseLoadedImage(loaded.stdout);

  const envFiles = `--env-file ${remoteEnvPath} --env-file ${remoteGithubEnvPath} --env-file ${remoteE2bEnvPath}`;

  // Run-scoped docker network + Postgres + Redis.
  await ssh.run(dest, key, "sudo docker network create candidate-net || true");
  await ssh.run(
    dest,
    key,
    "sudo docker run -d --name candidate-postgres --network candidate-net " +
      "-e POSTGRES_DB=proliferate -e POSTGRES_USER=proliferate -e POSTGRES_PASSWORD=proliferate postgres:16",
  );
  await ssh.run(dest, key, "sudo docker run -d --name candidate-redis --network candidate-net redis:7");
  await waitForPostgres(ssh, dest, key, timeoutMs, log);

  // Migrate with the EXACT image, then start the Server (gateway posture).
  log("running alembic upgrade head with the candidate image");
  await ssh.run(dest, key, `sudo docker run --rm --network candidate-net ${envFiles} ${imageRef} alembic upgrade head`);
  await ssh.run(
    dest,
    key,
    `sudo docker run -d --name candidate-server --network candidate-net ${envFiles} ` +
      `-v ${REMOTE_WORKDIR}:${REMOTE_WORKDIR} -p 127.0.0.1:${SERVER_CONTAINER_PORT}:${SERVER_CONTAINER_PORT} ${imageRef}`,
  );

  // Configure Caddy to terminate TLS for the run subdomain.
  await ssh.copyFile(dest, key, caddyLocalPath, `${REMOTE_WORKDIR}/Caddyfile`);
  await ssh.run(dest, key, `sudo cp ${REMOTE_WORKDIR}/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`);

  // Copy the first-run setup token DOWN to the runner for the actor `/setup`
  // claim. The command argv is a plain `cat <path>`; the token value transits
  // the SSH channel and lands in a mode-0600 local file — never argv, never a log.
  await waitForRemoteFile(ssh, dest, key, REMOTE_SETUP_TOKEN_PATH, timeoutMs, log);
  // The Server container writes this token as root through the REMOTE_WORKDIR
  // mount (mode 0600), so the non-root `ubuntu` user needs sudo to read it. The
  // value transits the SSH channel and lands in a mode-0600 local file — never
  // in argv, never in a log.
  const token = await ssh.run(dest, key, `sudo cat ${REMOTE_SETUP_TOKEN_PATH}`);
  await mkdir(path.dirname(options.setupTokenHostPath), { recursive: true });
  await writeFile(options.setupTokenHostPath, token.stdout.trim(), { mode: 0o600 });

  // Bounded readiness: public TLS `/health` must report the exact Server version.
  let version: string;
  try {
    version = await awaitHealthyVersion(options.probeHealth, options.publicOrigin, serverArtifact.version, timeoutMs, log);
  } catch (healthError) {
    // Capture box-side state before teardown so a public /health timeout is
    // diagnosable (DNS vs Caddy/LE cert vs Server 502) without re-provisioning.
    for (const [label, cmd] of [
      ["docker-ps", "sudo docker ps -a --format '{{.Names}} {{.Status}}'"],
      ["server-health-direct", `curl -s -o /dev/null -w '%{http_code}' http://localhost:${SERVER_CONTAINER_PORT}/health || true`],
      ["caddy-local-https", "curl -sk -o /dev/null -w '%{http_code}' https://localhost/health || true"],
      ["caddy-journal", "sudo journalctl -u caddy --no-pager 2>&1 | tail -40 || true"],
      ["server-logs", "sudo docker logs candidate-server 2>&1 | tail -30 || true"],
    ] as const) {
      try {
        const out = await ssh.run(dest, key, cmd);
        log(`[health-diag] ${label}: ${out.stdout.trim()}`);
      } catch (diagError) {
        log(`[health-diag] ${label}: diagnostic command failed: ${String(diagError)}`);
      }
    }
    throw healthError;
  }

  return {
    artifact_id: `candidate-api/${options.record.recordName}`,
    version,
    sha256: serverArtifact.sha256,
    publicOrigin: options.publicOrigin,
    ec2InstanceId: box.instanceId,
  };
}

/** Builds the mode-0600 Server env-file body (spec step 3). */
function buildServerEnv(options: DeployCandidateApiOptions): string {
  const lines = [
    "SINGLE_ORG_MODE=true",
    "AGENT_GATEWAY_ENABLED=true",
    "AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS=5",
    `AGENT_GATEWAY_LITELLM_BASE_URL=${options.litellm.adminBaseUrl}`,
    `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=${options.litellm.publicBaseUrl}`,
    `AGENT_GATEWAY_LITELLM_MASTER_KEY=${options.litellm.masterKey}`,
    // Production posture (debug=False) requires non-default instance secrets;
    // fresh run-scoped random values match production rather than flipping DEBUG.
    `JWT_SECRET=${randomBytes(32).toString("hex")}`,
    `CLOUD_SECRET_KEY=${randomBytes(32).toString("hex")}`,
    `SETUP_TOKEN_FILE=${REMOTE_SETUP_TOKEN_PATH}`,
    // The candidate server's own public HTTPS origin. Without it,
    // `launch_worker_sidecar` (worker_cloud_base_url → API_BASE_URL) short-
    // circuits and NO proliferate-worker is ever launched in the sandbox — so
    // the sandbox must be able to reach the server here to enroll + heartbeat.
    `API_BASE_URL=${options.publicOrigin}`,
    // asyncpg driver: the server image ships asyncpg, not psycopg2, and
    // alembic/env.py uses create_async_engine — a bare `postgresql://` URL
    // selects the (absent) psycopg2 sync driver and fails migration.
    "DATABASE_URL=postgresql+asyncpg://proliferate:proliferate@candidate-postgres:5432/proliferate",
    "REDBEAT_REDIS_URL=redis://candidate-redis:6379/0",
    `CORS_ALLOW_ORIGINS=${options.rendererOrigin}`,
    `GITHUB_APP_SLUG=${options.github.appSlug}`,
    `GITHUB_APP_ID=${options.github.appId}`,
    `GITHUB_APP_CLIENT_ID=${options.github.clientId}`,
    `GITHUB_APP_INSTALLATION_ID=${options.github.installationId}`,
    // Multi-line PEM cannot live in a docker --env-file; the server reads it
    // from this mounted path instead of an inline GITHUB_APP_PRIVATE_KEY.
    `GITHUB_APP_PRIVATE_KEY_PATH=${REMOTE_GITHUB_KEY_PATH}`,
    `E2B_TEAM_ID=${options.e2b.teamId}`,
    // The run-scoped template alias: the Server's provisioning gate requires it
    // (non-debug + E2B_API_KEY set), and Sandbox.create() spawns from it — so the
    // product provisions from exactly the immutable template this world builds.
    `E2B_TEMPLATE_NAME=${options.e2b.templateName}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Caddyfile that reverse-proxies the run subdomain to the Server container. */
function buildCaddyfile(subdomain: string): string {
  return `${subdomain} {\n  reverse_proxy 127.0.0.1:${SERVER_CONTAINER_PORT}\n}\n`;
}

/** Parses `Loaded image: <ref>` (or `Loaded image ID: <sha>`) from `docker load`. */
function parseLoadedImage(stdout: string): string {
  const match = stdout.match(/Loaded image(?: ID)?:\s*(\S+)/);
  if (!match) {
    throw new Error(`Could not parse a loaded image reference from docker load output: ${stdout.trim()}`);
  }
  return match[1];
}

async function waitForBox(
  ssh: SshExec,
  dest: string,
  key: string,
  timeoutMs: number,
  log: (m: string) => void,
): Promise<void> {
  await pollUntil(
    async () => {
      const result = await ssh.run(dest, key, "test -f /var/lib/cloud/ingress-ready && sudo docker --version");
      return result.stdout.toLowerCase().includes("docker");
    },
    timeoutMs,
    `SSH / docker never came up on ${dest}`,
    log,
  );
}

async function waitForPostgres(
  ssh: SshExec,
  dest: string,
  key: string,
  timeoutMs: number,
  log: (m: string) => void,
): Promise<void> {
  await pollUntil(
    async () => {
      const result = await ssh.run(
        dest,
        key,
        "sudo docker exec candidate-postgres pg_isready -U proliferate",
      );
      return result.stdout.includes("accepting connections");
    },
    timeoutMs,
    "candidate Postgres never accepted connections",
    log,
  );
}

async function waitForRemoteFile(
  ssh: SshExec,
  dest: string,
  key: string,
  remotePath: string,
  timeoutMs: number,
  log: (m: string) => void,
): Promise<void> {
  await pollUntil(
    async () => {
      const result = await ssh.run(dest, key, `test -s ${remotePath} && echo present`);
      return result.stdout.includes("present");
    },
    timeoutMs,
    `remote file ${remotePath} never appeared`,
    log,
  );
}

/** Polls public TLS `/health` until ok, then requires the exact Server version. */
async function awaitHealthyVersion(
  probeHealth: (origin: string) => Promise<{ ok: boolean; version: string }>,
  origin: string,
  expectedVersion: string,
  timeoutMs: number,
  log: (m: string) => void,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const health = await probeHealth(origin);
      if (health.ok) {
        if (health.version !== expectedVersion) {
          throw new Error(
            `candidate Server at ${origin} reported version "${health.version}", ` +
              `which does not match the candidate map version "${expectedVersion}".`,
          );
        }
        log(`candidate API healthy at ${origin} (version ${health.version})`);
        return health.version;
      }
      lastError = `not ok`;
    } catch (error) {
      // A version mismatch is terminal (it will not change); surface it now.
      if (error instanceof Error && error.message.includes("does not match the candidate map version")) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(3_000);
  }
  throw new Error(`public /health never became ready at ${origin} within ${timeoutMs}ms (last: ${lastError}).`);
}

async function pollUntil(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  failMessage: string,
  log: (m: string) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        return;
      }
      lastError = "probe returned false";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(5_000);
  }
  log(`${failMessage} (last: ${lastError})`);
  throw new Error(`${failMessage} within ${timeoutMs}ms (last: ${lastError}).`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SSH_OPTS = [
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "ConnectTimeout=10",
];

/** Default SSH exec seam (real `ssh`/`scp`). */
export const defaultSshExec: SshExec = {
  async run(destination, keyPath, command) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout, stderr } = await run("ssh", ["-i", keyPath, ...SSH_OPTS, destination, command], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  },
  async copyFile(destination, keyPath, localPath, remotePath) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    await run("scp", ["-i", keyPath, ...SSH_OPTS, localPath, `${destination}:${remotePath}`], {
      maxBuffer: 32 * 1024 * 1024,
    });
  },
};
