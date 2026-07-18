import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { ReadinessFetch } from "../local-workspace/processes.js";
import type { Ec2Box } from "./ec2.js";
import type { SshTransport } from "./world.js";

/**
 * The install driver contract (frozen spec decisions 3 & 4, "World construction"
 * step 4). It runs the SHIPPED installer on candidate bytes — never a bypass and
 * never rolling `stable`/`latest`:
 *
 *   scp the server-image archive + the `proliferate-deploy.tar.gz` bundle to the
 *   box → `docker load` the archive → write/confirm `.env.static` with
 *   `PROLIFERATE_SERVER_IMAGE`/`_TAG` pinned to the DOCKER-LOADED candidate image
 *   tag → run the real `install.sh` against the local candidate bundle → Caddy
 *   issues TLS for the run subdomain → `wait-for-health.sh`/HTTPS `/health` →
 *   assert the running container image `RepoDigest` on the box equals the loaded
 *   archive's identity (the digest RECEIPT).
 *
 * `install.sh` today only fetches a published `server-v*` release asset. This
 * workstream adds the minimal SHIPPED flag `--bundle <path>` (install from a
 * local, checksum-verified bundle instead of downloading) — a real, disclosed
 * product change to `server/deploy/install.sh` — plus using `--image-repo` /
 * `--version` to pin the docker-loaded candidate image. The setup token is read
 * over SSH/SSM by the actor fixture, not here.
 */

export interface RunInstallerInputs {
  box: Ec2Box;
  ssh: SshTransport;
  /** Materialized `server/linux/<arch>` docker-save archive. */
  serverImageArchive: MaterializedArtifact;
  /** Materialized `selfhost-bundle/<platform>` proliferate-deploy.tar.gz. */
  bundle: MaterializedArtifact;
  /** The bundle's `self-hosted-assets.SHA256SUMS` bytes (or its resolved path). */
  bundleSha256SumsPath: string;
  /** Public hostname Caddy issues TLS for (the run subdomain FQDN). */
  siteAddress: string;
  /** Image repo string pinned into `.env.static` (the loaded candidate repo). */
  candidateImageRepo: string;
  /** Loaded candidate image tag — NEVER `stable`/`latest`. */
  candidateImageTag: string;
  /**
   * Extra browser origins the box's API must allow (CORS). The Desktop renderer
   * and the Connect-Server trust probe drive the API from a browser, so their
   * origins must be admitted or the browser blocks the cross-origin fetches.
   * Passed to the shipped installer's `--cors-allow-origins`; omitted when empty.
   */
  corsAllowOrigins?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
  /** Injectable HTTP readiness seam (real `fetch` in production, fake in tests). */
  fetchImpl?: ReadinessFetch;
}

/**
 * Remote layout the driver transports the candidate bytes into (all under the
 * SSH user's home so no `sudo` is needed to write them; only `docker`/the
 * installer run under `sudo`). The shipped `install.sh` is extracted FROM the
 * candidate bundle so the exact shipped script runs — never a checkout copy.
 */
export const SELFHOST_REMOTE_DIR = "proliferate-candidate";

/** Outer ssh budget for the shipped install.sh run (see call site). */
const INSTALL_SSH_TIMEOUT_MS = 25 * 60_000;
export const SELFHOST_REMOTE_IMAGE_ARCHIVE = `${SELFHOST_REMOTE_DIR}/server-image.tar`;
export const SELFHOST_REMOTE_BUNDLE = `${SELFHOST_REMOTE_DIR}/proliferate-deploy.tar.gz`;
export const SELFHOST_REMOTE_SHA256SUMS = `${SELFHOST_REMOTE_DIR}/self-hosted-assets.SHA256SUMS`;
export const SELFHOST_REMOTE_INSTALLER = `${SELFHOST_REMOTE_DIR}/proliferate-deploy/install.sh`;
/** Default install root (`install.sh` default); the deploy dir hangs off it. */
export const SELFHOST_DEPLOY_DIR = "/opt/proliferate/server/deploy";
/** First-run setup token path inside the api container (never served over HTTP). */
export const SELFHOST_SETUP_TOKEN_PATH = "/var/lib/proliferate/setup/setup-token";

/** The install receipt the `SH-INSTALL-CLAIM` cell asserts against. */
export interface InstallReceipt {
  /** `sha256:...` image id reported by `docker load`. */
  loadedImageId: string;
  /** RepoDigest of the running container asserted on the box (the receipt). */
  runningImageDigest: string;
  /** `/meta` serverVersion after the stack is healthy. */
  serverVersion: string;
  bundleSha256: string;
  siteAddress: string;
  /** The TLS API origin, e.g. `https://<run>.qualification.proliferate.com`. */
  apiOrigin: string;
  tlsVerified: boolean;
}

/**
 * The full install driver: transports bytes, loads the image, runs the shipped
 * installer pinned to the candidate image, waits for TLS + `/health`, and
 * returns the digest receipt. A digest mismatch is a hard fail before claim.
 */
export async function runShippedInstaller(inputs: RunInstallerInputs): Promise<InstallReceipt> {
  const { ssh, box } = inputs;
  const log = inputs.log ?? (() => {});
  const imageRef = `${inputs.candidateImageRepo}:${inputs.candidateImageTag}`;
  assertNotRollingTag(inputs.candidateImageTag);

  // 1. Transport the candidate bytes to the box (home dir; no sudo to write).
  log(`transporting candidate bytes to ${box.instanceId}`);
  await ssh.run(`mkdir -p ${SELFHOST_REMOTE_DIR}`);
  await ssh.scp(inputs.serverImageArchive.path, SELFHOST_REMOTE_IMAGE_ARCHIVE);
  await ssh.scp(inputs.bundle.path, SELFHOST_REMOTE_BUNDLE);
  await ssh.scp(inputs.bundleSha256SumsPath, SELFHOST_REMOTE_SHA256SUMS);

  // 2. docker-load the candidate server image; verify it restored the pinned ref.
  log(`docker load ${SELFHOST_REMOTE_IMAGE_ARCHIVE}`);
  const loaded = await dockerLoadCandidateImage(ssh, SELFHOST_REMOTE_IMAGE_ARCHIVE, imageRef);

  // 3. Extract ONLY the shipped install.sh out of the candidate bundle and run
  //    it against the local bundle — the real installer on candidate bytes.
  log("extracting shipped install.sh from the candidate bundle");
  await ssh.run(`tar xzf ${SELFHOST_REMOTE_BUNDLE} -C ${SELFHOST_REMOTE_DIR} proliferate-deploy/install.sh`);

  // Pin `.env.static` to the docker-loaded candidate image via --image-repo /
  // --version (never stable/latest). No secret ever rides on argv.
  log(`running shipped install.sh --bundle for ${inputs.siteAddress}`);
  const installArgs = [
    // Widen the shipped health gate from its 60×2s default: the gate covers
    // Caddy's cold Let's Encrypt issuance, and 2min is tight under CA load —
    // run 29631785126 died with `tlsv1 alert internal error` (no cert ever
    // logged) while the identical flow succeeded hours earlier. 210×2s = 7min.
    // `sudo VAR=… cmd` passes the assignment through to install.sh/bootstrap.
    "sudo PROLIFERATE_HEALTHCHECK_ATTEMPTS=210 bash",
    SELFHOST_REMOTE_INSTALLER,
    "--bundle",
    SELFHOST_REMOTE_BUNDLE,
    "--bundle-sha256sums",
    SELFHOST_REMOTE_SHA256SUMS,
    "--domain",
    inputs.siteAddress,
    "--image-repo",
    inputs.candidateImageRepo,
    "--version",
    inputs.candidateImageTag,
    "--telemetry-mode",
    "self_managed",
  ];
  // The CSV carries no spaces (renderer origins only), so it is a single argv
  // token in the space-joined command; no secret ever rides on argv.
  if (inputs.corsAllowOrigins && inputs.corsAllowOrigins.trim().length > 0) {
    installArgs.push("--cors-allow-origins", inputs.corsAllowOrigins.trim());
  }
  installArgs.push("--yes");
  // Bounded: callers historically passed no timeoutMs, which execFile treats
  // as NO timeout — a hung install.sh would then ride the whole 120min job
  // budget. 25min covers the slowest observed cold install (all compose image
  // pulls on a t3.small) with generous headroom while still failing a hang.
  try {
    await ssh.run(installArgs.join(" "), { timeoutMs: inputs.timeoutMs ?? INSTALL_SSH_TIMEOUT_MS });
  } catch (error) {
    // The dominant install failure is the health gate timing out on TLS —
    // curl only ever reports `tlsv1 alert internal error`, which is Caddy
    // answering WITHOUT a certificate. WHY there is no certificate (ACME
    // rate limit? DNS? CA outage?) lives only in Caddy's log on the box, so
    // capture its tail before the world tears down (run 29631785126 was
    // undiagnosable without it). Best-effort: never mask the real error.
    if (error instanceof Error) {
      let caddyTail = "(probe failed)";
      try {
        caddyTail = await ssh.run(
          `cd /opt/proliferate/server/deploy && sudo docker compose -f docker-compose.production.yml logs --no-color --tail 40 caddy 2>&1 | grep -iE 'acme|certificate|rate|error|obtain' | tail -20`,
          { timeoutMs: 60_000 },
        );
      } catch {
        // keep "(probe failed)"
      }
      error.message = `${error.message}\n--- caddy log tail (ACME diagnosis) ---\n${caddyTail.trim() || "none"}`;
    }
    throw error;
  }

  // 4. Wait for public HTTPS /health (Caddy TLS issuance + stack readiness).
  const apiOrigin = `https://${inputs.siteAddress}`;
  await waitForHealth(apiOrigin, { timeoutMs: inputs.timeoutMs, log, fetchImpl: inputs.fetchImpl });

  // 5. Assert the running container's image equals the loaded candidate — the
  //    digest RECEIPT. A mismatch is a hard fail BEFORE any claim.
  const runningImageDigest = await assertRunningImageDigest(ssh, {
    loadedImageId: loaded.imageId,
    loadedRepoDigest: loaded.repoDigest,
  });

  const serverVersion = await readServerVersion(apiOrigin, inputs.fetchImpl);

  return {
    loadedImageId: loaded.imageId,
    runningImageDigest,
    serverVersion,
    // The bundle bytes were already re-hashed at map materialization; reuse that
    // identity rather than re-reading the file here.
    bundleSha256: inputs.bundle.sha256,
    siteAddress: inputs.siteAddress,
    apiOrigin,
    tlsVerified: true,
  };
}

/**
 * `docker load`s the candidate server-image archive on the box and returns its
 * identity. When `expectedImageRef` is supplied, asserts the archive restored
 * exactly that `repo:tag` (so the install cannot silently run a different
 * image than the one the map pins). RepoDigests are empty for a locally loaded
 * image, so `repoDigest` is normally `null` and the image `.Id` is the receipt.
 */
export async function dockerLoadCandidateImage(
  ssh: SshTransport,
  archiveRemotePath: string,
  expectedImageRef?: string,
): Promise<{ imageId: string; repoDigest: string | null }> {
  const output = await ssh.run(`sudo docker load -i ${archiveRemotePath}`);
  const match = output.match(/Loaded image:\s*(\S+)/);
  if (!match) {
    throw new Error("could not parse the loaded image ref from 'docker load' output.");
  }
  const loadedRef = match[1];
  if (expectedImageRef && loadedRef !== expectedImageRef) {
    throw new Error(
      `docker load restored ${loadedRef}, but the candidate map pins ${expectedImageRef}; refusing to install a mismatched image.`,
    );
  }
  const inspected = (
    await ssh.run(`sudo docker image inspect --format '{{.Id}}|{{range .RepoDigests}}{{.}} {{end}}' ${loadedRef}`)
  ).trim();
  const [imageId, repoDigestRaw = ""] = inspected.split("|");
  if (!/^sha256:[0-9a-f]{64}$/.test(imageId.trim())) {
    throw new Error(`docker image inspect returned an unexpected image id for ${loadedRef}.`);
  }
  const repoDigest = repoDigestRaw.trim().length > 0 ? repoDigestRaw.trim().split(/\s+/)[0] : null;
  return { imageId: imageId.trim(), repoDigest };
}

/** Reads the one-time first-run setup token from the api container over SSH/SSM. */
export async function readSetupTokenOverSsh(ssh: SshTransport): Promise<string> {
  const token = (
    await ssh.run(
      `sudo docker compose --env-file ${SELFHOST_DEPLOY_DIR}/.env.runtime ` +
        `-f ${SELFHOST_DEPLOY_DIR}/docker-compose.production.yml ` +
        `exec -T api cat ${SELFHOST_SETUP_TOKEN_PATH}`,
    )
  ).trim();
  if (token.length === 0) {
    throw new Error(
      "the first-run setup token file was empty or missing; the instance may already be claimed.",
    );
  }
  // The raw token is a secret: it is returned to the actor fixture and never
  // logged or embedded in an error message here.
  return token;
}

/**
 * Asserts the running container's image on the box equals the docker-loaded
 * candidate image id (the digest RECEIPT). Throws — a hard fail before any
 * claim — when no running container descends from the candidate image or the
 * running image id differs.
 */
export async function assertRunningImageDigest(
  ssh: SshTransport,
  expected: { loadedImageId: string; loadedRepoDigest: string | null },
): Promise<string> {
  const running = (await ssh.run(`sudo docker ps -q --filter ancestor=${expected.loadedImageId}`)).trim();
  const containerId = running.split(/\s+/)[0] ?? "";
  if (containerId.length === 0) {
    throw new Error(
      "no running container descends from the candidate image; the stack did not come up on the candidate bytes.",
    );
  }
  const runningImageId = (await ssh.run(`sudo docker inspect --format '{{.Image}}' ${containerId}`)).trim();
  if (runningImageId !== expected.loadedImageId) {
    throw new Error(
      `running image digest mismatch: the api container runs ${runningImageId}, ` +
        `the candidate archive loaded ${expected.loadedImageId}. Refusing to claim.`,
    );
  }
  if (expected.loadedRepoDigest) {
    const runningRepoDigest = (
      await ssh.run(`sudo docker inspect --format '{{index .RepoDigests 0}}' ${runningImageId}`)
    ).trim();
    if (runningRepoDigest && runningRepoDigest !== expected.loadedRepoDigest) {
      throw new Error(
        `running image RepoDigest ${runningRepoDigest} does not match the candidate receipt ${expected.loadedRepoDigest}.`,
      );
    }
  }
  return runningImageId;
}

/** Bounded wait for the public HTTPS `/health` endpoint (TLS issuance + readiness). */
export async function waitForHealth(
  baseUrl: string,
  options: { timeoutMs?: number; log?: (message: string) => void; fetchImpl?: ReadinessFetch },
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultReadinessFetch;
  const timeoutMs = options.timeoutMs ?? 600_000;
  const url = `${baseUrl.replace(/\/$/, "")}/health`;
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
      if (response.status >= 200 && response.status < 300) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2_000);
  }
  throw new Error(`${url} did not become healthy within ${timeoutMs}ms (last: ${lastError}).`);
}

/** Reads `serverVersion` off the public `/meta` document (best-effort, bounded). */
async function readServerVersion(baseUrl: string, fetchImpl?: ReadinessFetch): Promise<string> {
  const impl = fetchImpl ?? defaultReadinessFetch;
  const response = await impl(`${baseUrl.replace(/\/$/, "")}/meta`, { signal: AbortSignal.timeout(5_000) });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`/meta returned HTTP ${response.status} after the stack reported healthy.`);
  }
  const body = (await response.json()) as { serverVersion?: unknown; version?: unknown };
  const version = body.serverVersion ?? body.version;
  return typeof version === "string" ? version : "";
}

/** Guards the frozen "never roll stable/latest" rule at the driver boundary. */
function assertNotRollingTag(tag: string): void {
  const lower = tag.trim().toLowerCase();
  if (lower === "stable" || lower === "latest") {
    throw new Error(`refusing to pin the candidate image to a rolling tag ("${tag}").`);
  }
}

const defaultReadinessFetch: ReadinessFetch = (url, init) =>
  fetch(url, init as RequestInit) as unknown as ReturnType<ReadinessFetch>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
