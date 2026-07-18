import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { QualificationLiteLlmConfig } from "../../services/qualification-litellm.js";
import {
  CALLBACK_RELAY_SCRIPT,
  DEFAULT_RELAY_LISTEN_PORT,
  RELAY_CHANNEL_PATHS,
  RELAY_DIRNAME,
  RELAY_SCRIPT_FILENAME,
} from "./callback-relay-agent.js";
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
/** Run-scoped 0600 env files carrying the candidate Server's Stripe/webhook secrets (PR 6, staged only when stripe present). */
const REMOTE_STRIPE_ENV_PATH = `${REMOTE_WORKDIR}/stripe.env`;
const REMOTE_STRIPE_WEBHOOK_ENV_PATH = `${REMOTE_WORKDIR}/stripe-webhook.env`;
/** On-box signed-callback relay dir + script (PR 6, staged only when callbackRelay present). */
const REMOTE_RELAY_DIR = `${REMOTE_WORKDIR}/${RELAY_DIRNAME}`;
const REMOTE_RELAY_SCRIPT_PATH = `${REMOTE_RELAY_DIR}/${RELAY_SCRIPT_FILENAME}`;
/** Pidfile the relay-start writes (`echo $!`) so cleanup can kill the exact process. */
const REMOTE_RELAY_PIDFILE = `${REMOTE_RELAY_DIR}/relay.pid`;
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

/**
 * Stripe TEST-mode config for the candidate Server (PR 6, append-only). When
 * present, `buildServerEnv` adds the Server's own Stripe env from these 0600
 * files so real Core-via-Stripe cloud checkout works (closing the fundCore 503
 * debt), plus the non-secret checkout redirect URLs. When ABSENT, no Stripe env
 * is emitted and the candidate Server keeps today's no-Stripe 503 posture — the
 * CLOUD-PROVISION-1 regression is untouched. Secret VALUES travel only via the
 * single-line 0600 env files (PEM-style multi-line staging is not needed for
 * these keys), never argv, never a field.
 */
export interface CandidateStripeConfig {
  /** Path to the mode-0600 env file holding STRIPE_SECRET_KEY (single line). */
  secretsEnvFilePath: string;
  /**
   * Path to the mode-0600 env file holding the two webhook signing secrets
   * (STRIPE_WEBHOOK_SECRET and E2B_WEBHOOK_SIGNATURE_SECRET) the Server verifies
   * signed deliveries against. The relay forwards signed bytes untouched; the
   * Server is the sole verifier, so these live in the SERVER env only.
   */
  webhookSecretEnvFilePath: string;
  /** Non-secret post-checkout redirect (STRIPE_CHECKOUT_SUCCESS_URL); typically the publicOrigin. */
  checkoutSuccessUrl: string;
  /** Non-secret cancelled-checkout redirect (STRIPE_CHECKOUT_CANCEL_URL). */
  checkoutCancelUrl: string;
}

/**
 * Signed-callback relay config for the candidate box (PR 6, append-only). When
 * present, `deployCandidateApi` stages the single-file relay process under the
 * remote workdir, starts it (pass-through by default), and wires the two signed
 * webhook paths through it in the Caddyfile. When ABSENT, no relay is staged and
 * the Caddyfile is byte-identical to today's (a single `reverse_proxy` to the
 * Server) — behaviour with the option unused is unchanged. The relay never reads
 * a signing secret; it forwards signed bytes byte-identically.
 */
export interface CandidateCallbackRelayConfig {
  /** Loopback port the relay http process binds on the box (default 8899). */
  listenPort?: number;
}

export interface DeployCandidateApiOptions {
  box: Ec2IngressBox;
  record: Route53Record;
  /** The materialized (re-hashed) Server image archive. */
  serverArtifact: MaterializedArtifact;
  litellm: QualificationLiteLlmConfig;
  github: CandidateGithubAppConfig;
  e2b: CandidateE2bConfig;
  /** Exact qualification ownership stamped onto external LiteLLM resources. */
  qualificationRun: { runId: string; shardId: string };
  /**
   * PR 6 (append-only): Stripe TEST-mode config for the candidate Server. Absent
   * (the default) preserves today's no-Stripe 503 checkout posture exactly.
   */
  stripe?: CandidateStripeConfig;
  /**
   * PR 6 (append-only): on-box signed-callback relay in front of the two signed
   * webhook paths. Absent (the default) produces the byte-identical single-proxy
   * Caddyfile and stages no relay.
   */
  callbackRelay?: CandidateCallbackRelayConfig;
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
  /**
   * PR 6 (append-only): registered-before-create cleanup seam, threaded from the
   * world's cleanup stack (same shape `world.ts` uses for every other resource).
   * When `callbackRelay` is present it is used to register `callback_relay_process`
   * (kill by pidfile) and `callback_relay_spool` (rm -rf the spool dir) BEFORE the
   * relay is started, so a dead/half-started relay is still torn down and
   * `relayStopped` reports the truth. Absent → no relay resources are registered
   * (today's behaviour; the relay is only staged when callbackRelay is present).
   */
  registerCleanup?: (
    kind: "callback_relay_process" | "callback_relay_spool",
    providerId: string,
    release: () => Promise<void>,
  ) => Promise<void>;
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
  const relayPort = options.callbackRelay?.listenPort ?? DEFAULT_RELAY_LISTEN_PORT;
  const caddyLocalPath = path.join(options.secretsDir, "Caddyfile");
  await writeFile(
    caddyLocalPath,
    buildCaddyfile(options.record.recordName, options.callbackRelay ? relayPort : undefined),
    { mode: 0o600 },
  );

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

  // PR 6 (append-only): the Stripe secret + webhook-secret 0600 env files ride
  // as their own `docker --env-file`s (single-line, no PEM staging needed), so
  // the secret VALUES never enter argv or the receipt. Only when stripe config
  // is present — absent, no Stripe env file is copied or referenced.
  const stripeEnvFiles: string[] = [];
  if (options.stripe) {
    await ssh.copyFile(dest, key, options.stripe.secretsEnvFilePath, REMOTE_STRIPE_ENV_PATH);
    await ssh.copyFile(dest, key, options.stripe.webhookSecretEnvFilePath, REMOTE_STRIPE_WEBHOOK_ENV_PATH);
    stripeEnvFiles.push(`--env-file ${REMOTE_STRIPE_ENV_PATH}`, `--env-file ${REMOTE_STRIPE_WEBHOOK_ENV_PATH}`);
  }

  // Install Caddy and load the EXACT Server image.
  log("installing caddy and loading the candidate Server image");
  await ssh.run(dest, key, "sudo apt-get update -y && sudo apt-get install -y debian-keyring debian-archive-keyring caddy");
  const loaded = await ssh.run(dest, key, `sudo docker load -i ${remoteImagePath}`);
  const imageRef = parseLoadedImage(loaded.stdout);

  const envFiles = [
    `--env-file ${remoteEnvPath}`,
    `--env-file ${remoteGithubEnvPath}`,
    `--env-file ${remoteE2bEnvPath}`,
    ...stripeEnvFiles,
  ].join(" ");

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

  // PR 6 (append-only): stage + start the signed-callback relay BEFORE Caddy
  // reloads, so the routes Caddy points at the relay have a live listener. The
  // relay is a stdlib-only single-file Python http process (no third-party deps
  // on the box); it starts in pass-through mode — behaviourally invisible until
  // the controller flips a channel to hold. Only when callbackRelay is present;
  // absent, none of this runs and the Caddyfile has no relay routes.
  if (options.callbackRelay) {
    const relayScriptLocalPath = path.join(options.secretsDir, RELAY_SCRIPT_FILENAME);
    await writeFile(relayScriptLocalPath, CALLBACK_RELAY_SCRIPT, { mode: 0o600 });
    // Owner-only spool dir: it holds spooled signed payloads/headers (replay-
    // capable credential material), so create it 0700 (install -d -m 700, then a
    // belt-and-suspenders chmod for install variants that ignore -m).
    await ssh.run(dest, key, `install -d -m 700 ${REMOTE_RELAY_DIR} || mkdir -p ${REMOTE_RELAY_DIR}; chmod 700 ${REMOTE_RELAY_DIR}`);
    await ssh.copyFile(dest, key, relayScriptLocalPath, REMOTE_RELAY_SCRIPT_PATH);

    // Register cleanup BEFORE starting the process (registered-before-create):
    // the spool dir (holds spooled signed payloads/headers) and the process
    // (killed by pidfile). Registered even if the start/readiness below fails,
    // so a dead/half-started relay is still torn down and `relayStopped` is
    // truthful. Durable identity: the process entry's providerId is
    // `<box-ip>:<pidfile>` so a RECOVERED runner can act from the ledger alone.
    await options.registerCleanup?.("callback_relay_spool", REMOTE_RELAY_DIR, async () => {
      await ssh.run(dest, key, `rm -rf ${REMOTE_RELAY_DIR}`);
    });
    await options.registerCleanup?.(
      "callback_relay_process",
      `${box.publicIp}:${REMOTE_RELAY_PIDFILE}`,
      async () => {
        await stopRelayProcess(ssh, dest, key);
      },
    );

    // The relay forwards to the Server container's host-mapped loopback port.
    // Detached via nohup so it survives the SSH session; stdlib only, so the
    // box's system python3 runs it with no venv/deps. The upstream + spool dir +
    // port ride as its env (no secrets — the relay never reads a signing secret).
    //
    // The pidfile records an OWNERSHIP DISCRIMINATOR, not a bare PID: the PID,
    // its `/proc/<pid>/stat` starttime (field 22 — unique per boot+pid so a PID
    // reused after this process dies has a DIFFERENT starttime), and the exact
    // run-scoped relay script path. `stopRelayProcess` re-checks both before
    // signalling, so recovery never kills an innocent process that reused the PID.
    // Written 0600 as a JSON object (tmp+mv keeps it atomic-ish for a reader).
    await ssh.run(
      dest,
      key,
      `RELAY_SPOOL_DIR=${REMOTE_RELAY_DIR} RELAY_UPSTREAM=http://127.0.0.1:${SERVER_CONTAINER_PORT} ` +
        `RELAY_PORT=${relayPort} nohup python3 ${REMOTE_RELAY_SCRIPT_PATH} serve ` +
        `>${REMOTE_RELAY_DIR}/relay.log 2>&1 & ` +
        `RELAY_PID=$!; ` +
        // /proc/<pid>/stat: `pid (comm) state ppid ...`; starttime is field 22.
        // Take the substring after the LAST ") " so a comm containing spaces or
        // parens never shifts the field count, then starttime is field 20 of the
        // remainder (fields 1-2 are pid + (comm)).
        `RELAY_START=$(sed 's/.*) //' /proc/$RELAY_PID/stat 2>/dev/null | awk '{print $20}'); ` +
        `umask 077; ` +
        `printf '{"pid":%s,"starttime":"%s","script":"%s"}' "$RELAY_PID" "$RELAY_START" ${REMOTE_RELAY_SCRIPT_PATH} ` +
        `> ${REMOTE_RELAY_PIDFILE}.tmp && mv ${REMOTE_RELAY_PIDFILE}.tmp ${REMOTE_RELAY_PIDFILE}`,
    );

    // Bounded readiness: poll the relay's own loopback health endpoint until it
    // answers 200, BEFORE Caddy routes signed callbacks through it. A relay that
    // never comes up fails the deploy loudly rather than letting world
    // construction "succeed" with a dead relay (public /health bypasses it).
    await waitForRelayHealth(ssh, dest, key, relayPort, timeoutMs, log);
  }

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
  const runId = requireQualificationIdentity(options.qualificationRun.runId, "run id");
  const shardId = requireQualificationIdentity(options.qualificationRun.shardId, "shard id");
  const lines = [
    "SINGLE_ORG_MODE=true",
    "AGENT_GATEWAY_ENABLED=true",
    "AGENT_GATEWAY_BACKFILL_INTERVAL_SECONDS=5",
    `AGENT_GATEWAY_LITELLM_BASE_URL=${options.litellm.adminBaseUrl}`,
    `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=${options.litellm.publicBaseUrl}`,
    `AGENT_GATEWAY_LITELLM_MASTER_KEY=${options.litellm.masterKey}`,
    `AGENT_GATEWAY_QUALIFICATION_RUN_ID=${runId}`,
    `AGENT_GATEWAY_QUALIFICATION_SHARD_ID=${shardId}`,
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
  // PR 6 (append-only): only when Stripe test-mode config is present. The secret
  // Stripe keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, E2B_WEBHOOK_SIGNATURE_
  // SECRET) ride their OWN 0600 --env-files (see deployCandidateApi), never this
  // file; only the NON-secret checkout redirect URLs go here. Absent stripe →
  // none of these are emitted and the Server keeps today's no-Stripe 503 posture.
  if (options.stripe) {
    lines.push(
      `STRIPE_CHECKOUT_SUCCESS_URL=${options.stripe.checkoutSuccessUrl}`,
      `STRIPE_CHECKOUT_CANCEL_URL=${options.stripe.checkoutCancelUrl}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function requireQualificationIdentity(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`managed-cloud qualification ${label} is malformed.`);
  }
  return value;
}

/**
 * Caddyfile that reverse-proxies the run subdomain to the Server container. When
 * a relay port is given (PR 6, callbackRelay present), the two signed webhook
 * paths are routed through the on-box relay instead, with everything else still
 * proxied straight to the Server. When it is undefined the output is
 * byte-identical to today's single-proxy Caddyfile.
 */
function buildCaddyfile(subdomain: string, relayPort?: number): string {
  if (relayPort === undefined) {
    return `${subdomain} {\n  reverse_proxy 127.0.0.1:${SERVER_CONTAINER_PORT}\n}\n`;
  }
  // `handle` blocks are matched in order; the two signed webhook paths go to the
  // relay, and the trailing catch-all `handle` proxies everything else to the
  // Server exactly as before. Caddy matches the most specific path handler first.
  const relayRoutes = [RELAY_CHANNEL_PATHS.stripe, RELAY_CHANNEL_PATHS.e2b]
    .map((webhookPath) => `  handle ${webhookPath} {\n    reverse_proxy 127.0.0.1:${relayPort}\n  }`)
    .join("\n");
  return (
    `${subdomain} {\n` +
    `${relayRoutes}\n` +
    `  handle {\n    reverse_proxy 127.0.0.1:${SERVER_CONTAINER_PORT}\n  }\n` +
    `}\n`
  );
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

/**
 * Stops the on-box signed-callback relay SAFELY against PID reuse. The pidfile
 * records {pid, starttime, script}; before signalling, this re-reads
 * `/proc/<pid>/stat` starttime AND `/proc/<pid>/cmdline` and requires BOTH to
 * match the recorded discriminator:
 *
 *   - pidfile missing / pid not running   → already gone (RELAY_STOP_ABSENT).
 *   - pid running but starttime OR cmdline mismatch → the original relay is dead
 *     and this PID was REUSED by an unrelated process → do NOT kill it; remove
 *     the stale pidfile and report RELAY_STOP_STALE_PID (a clean, non-killing
 *     success).
 *   - full match → kill, verify absence via `kill -0`, remove the pidfile;
 *     failed-to-stop is RELAY_STOP_FAILED (a non-green cleanup error). No `||
 *     true` masks the outcome.
 */
async function stopRelayProcess(ssh: SshExec, dest: string, key: string): Promise<void> {
  const pidfile = REMOTE_RELAY_PIDFILE;
  // POSIX sh: parse the JSON pidfile with sed (no jq dependency on the box),
  // recompute the live starttime the same way the start command did, and compare
  // both discriminators before signalling. Prints exactly one sentinel.
  const script =
    `if [ ! -f ${pidfile} ]; then echo RELAY_STOP_ABSENT; exit 0; fi; ` +
    `PF="$(cat ${pidfile})"; ` +
    `PID=$(printf '%s' "$PF" | sed 's/.*"pid":\\([0-9]*\\).*/\\1/'); ` +
    `WANT_START=$(printf '%s' "$PF" | sed 's/.*"starttime":"\\([^"]*\\)".*/\\1/'); ` +
    `WANT_SCRIPT=$(printf '%s' "$PF" | sed 's/.*"script":"\\([^"]*\\)".*/\\1/'); ` +
    `if [ -z "$PID" ]; then rm -f ${pidfile}; echo RELAY_STOP_ABSENT; exit 0; fi; ` +
    // Not running at all → clean stop.
    `if ! kill -0 "$PID" 2>/dev/null; then rm -f ${pidfile}; echo RELAY_STOP_ABSENT; exit 0; fi; ` +
    // Recompute live starttime + read cmdline; a reused PID differs on either.
    `LIVE_START=$(sed 's/.*) //' /proc/$PID/stat 2>/dev/null | awk '{print $20}'); ` +
    `LIVE_CMD=$(tr '\\0' ' ' < /proc/$PID/cmdline 2>/dev/null); ` +
    `if [ "$LIVE_START" != "$WANT_START" ] || ! printf '%s' "$LIVE_CMD" | grep -q "$WANT_SCRIPT"; then ` +
    `rm -f ${pidfile}; echo RELAY_STOP_STALE_PID; exit 0; fi; ` +
    // Ownership confirmed → kill and verify absence.
    `kill "$PID" 2>/dev/null; sleep 1; ` +
    `if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID" 2>/dev/null; sleep 1; fi; ` +
    `if kill -0 "$PID" 2>/dev/null; then echo "RELAY_STOP_FAILED:$PID"; else rm -f ${pidfile}; echo RELAY_STOP_OK; fi`;
  const result = await ssh.run(dest, key, script);
  const out = result.stdout.trim();
  if (out.includes("RELAY_STOP_FAILED")) {
    throw new Error(
      `callback-relay cleanup: failed to stop the relay process (${out}); the signed-callback relay is still ` +
        "running. Cleanup failure is non-green.",
    );
  }
  if (
    !out.includes("RELAY_STOP_OK") &&
    !out.includes("RELAY_STOP_ABSENT") &&
    !out.includes("RELAY_STOP_STALE_PID")
  ) {
    throw new Error(`callback-relay cleanup: unexpected relay-stop result "${out.slice(0, 120)}".`);
  }
}

/**
 * Bounded readiness for the on-box signed-callback relay: polls its own loopback
 * health endpoint (`GET /__relay/health`) over SSH+curl until it returns 200,
 * BEFORE Caddy routes signed callbacks through it. Fails the deploy loudly on
 * timeout — a relay that never listens must not be papered over by the public
 * `/health` (which bypasses the relay). Uses a shorter, bounded window than the
 * full deploy timeout since the relay is a local process that comes up in
 * seconds.
 */
async function waitForRelayHealth(
  ssh: SshExec,
  dest: string,
  key: string,
  relayPort: number,
  timeoutMs: number,
  log: (m: string) => void,
): Promise<void> {
  await pollUntil(
    async () => {
      const result = await ssh.run(
        dest,
        key,
        `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:${relayPort}/__relay/health || true`,
      );
      return result.stdout.trim() === "200";
    },
    Math.min(timeoutMs, 60_000),
    `signed-callback relay never became ready on 127.0.0.1:${relayPort}`,
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
