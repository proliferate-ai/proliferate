import { scrubSecretText } from "../../fixtures/redact-diagnostics.js";
import { SELFHOST_DEPLOY_DIR, SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE } from "./install.js";
import type { SshTransport } from "./world.js";

/**
 * Box-side operations for SELFHOST-QUAL-1's `SH-CLOUD-ADDON` cell (frozen tier-3
 * contract §`SH-CLOUD-ADDON`): enable the OPTIONAL managed-cloud add-on on a
 * self-host box — the instance's own GitHub App + E2B account + immutable
 * self-built runtime template — provision one personal sandbox/workspace via the
 * REAL product GitHub authorization path, run one turn, prove pause/wake keeps
 * state intact, then DISABLE the add-on and prove capability truth drops
 * `cloudWorkspaces` while the base product stays healthy.
 *
 * Structurally the box-config twin of `gateway.ts`: everything privileged runs
 * over the world's `SshTransport` (never argv for a secret — the E2B key, GitHub
 * App client secret, and App private key are written into a 0600 file scp'd to
 * the box and appended to `.env.static`, with the pre-existing keys sed-stripped
 * first so `proliferate_read_env`'s `grep -m1` first-occurrence read resolves
 * OURS). The `cloud-workspaces` compose profile is gated by the shipped
 * `common.sh` on the `E2B_API_KEY` + `E2B_TEMPLATE_NAME` "complete pair"
 * (server/deploy/common.sh) — the same gate `preflight.sh` enforces — so writing
 * both plus the GitHub App config and rerunning `bootstrap.sh` brings the add-on
 * up exactly as a documented operator motion.
 *
 * The pure config/rendering helpers below carry the decision logic the unit
 * tests exercise offline; the SSH-touching ops are faked in tests. Live proof is
 * founder-gated (a self-host E2B account + self-built template + a GitHub App on
 * the fixed origin), so `resolveCloudAddonConfig` FAILS CLOSED — never a silent
 * skip — when any input is absent.
 */

/** Where the shipped installer put the deploy dir (single-sourced from install.ts). */
export const CLOUD_ADDON_DEPLOY_DIR = SELFHOST_DEPLOY_DIR;

/** Bounded default timeout for a single on-box compose/docker step. */
const BOX_STEP_TIMEOUT_MS = 5 * 60_000;

/**
 * The resolved cloud add-on env block written into the instance `.env.static`.
 * The E2B credentials scope the box's OWN provider account (a self-host add-on
 * provisions sandboxes under the instance's key, from inside its own server
 * process — NOT the qualification harness's managed-cloud account); the GitHub
 * App config is the box's OWN App (distinct from PR 2's managed-cloud staging
 * App); the template ref is the self-built immutable candidate template.
 */
export interface CloudAddonEnvBlock {
  e2bApiKey: string;
  e2bTemplateName: string;
  githubAppId: string;
  githubAppClientId: string;
  githubAppClientSecret: string;
  /**
   * The App's PEM private key, rendered SINGLE-LINE with `\n`-escaped newlines to
   * match the server's inline parse (`github_app_private_key()` does
   * `inline.replace("\\n", "\n")`, integrations/github/app_installations.py) and
   * `.env.production.example`'s documented "escape newlines as \n" form. A raw
   * multi-line value would depend on docker-compose env_file multiline parsing
   * and leave orphan lines the single-line sed strip cannot remove.
   */
  githubAppPrivateKey: string;
  /**
   * The box's public API BARE ORIGIN (e.g. `https://box…`). The server treats
   * `GITHUB_APP_CALLBACK_BASE_URL` as a bare origin — it `rstrip("/")`s it and
   * appends the full `/auth/github-app/...` route itself
   * (`_callback_base_url`/`_callback_url`, server/cloud/github_app/service.py), so
   * a trailing `/auth/` here would double the path and break the App callback.
   */
  githubAppCallbackBaseUrl: string;
}

export interface CloudAddonConfig {
  block: CloudAddonEnvBlock;
  /** The self-built E2B template ref pinned (recorded so evidence names the intended template). */
  e2bTemplateName: string;
  /** GitHub App id (safe token) recorded as a receipt — never the private key/secret. */
  githubAppId: string;
}

/** A minimal env getter so `resolveCloudAddonConfig` is pure + offline-testable. */
export interface CloudAddonEnvSource {
  get(name: string): string | undefined;
}

/** The self-host cloud-addon manifest keys (the box's OWN add-on credentials). */
export const CLOUD_ADDON_E2B_API_KEY_ENV = "RELEASE_E2E_SELFHOST_CLOUD_E2B_API_KEY";
export const CLOUD_ADDON_E2B_TEMPLATE_ENV = "RELEASE_E2E_SELFHOST_CLOUD_E2B_TEMPLATE_NAME";
export const CLOUD_ADDON_GITHUB_APP_ID_ENV = "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_ID";
export const CLOUD_ADDON_GITHUB_APP_CLIENT_ID_ENV = "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_ID";
export const CLOUD_ADDON_GITHUB_APP_CLIENT_SECRET_ENV = "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_CLIENT_SECRET";
export const CLOUD_ADDON_GITHUB_APP_PRIVATE_KEY_ENV = "RELEASE_E2E_SELFHOST_CLOUD_GITHUB_APP_PRIVATE_KEY";

/**
 * The GitHub App callback base URL the box serves. This is a BARE ORIGIN: the
 * server appends the full `/auth/github-app/...` route itself (it `rstrip("/")`s
 * this value in `_callback_base_url`), so returning `origin/auth/` here would
 * double the path (`…/auth/auth/github-app/…`) and never match the App's
 * registered redirect URI. Mirrors `.env.production.example`
 * ("defaults to API_BASE_URL when unset").
 */
export function githubAppCallbackBaseUrl(apiOrigin: string): string {
  return apiOrigin.replace(/\/+$/, "");
}

/**
 * Resolves the SH-CLOUD-ADDON env block from the controller env + the box's
 * public API origin. Every input is a founder-provisioned add-on credential;
 * when ANY is absent the cell fails closed (the reason NAMES the missing vars,
 * never their values). No secret is generated here — unlike the gateway master
 * key, the add-on credentials are all externally-owned provider/App secrets.
 */
export function resolveCloudAddonConfig(
  env: CloudAddonEnvSource,
  apiOrigin: string,
): { ok: true; value: CloudAddonConfig } | { ok: false; reason: string } {
  const required: Array<[string, string | undefined]> = [
    [CLOUD_ADDON_E2B_API_KEY_ENV, env.get(CLOUD_ADDON_E2B_API_KEY_ENV)?.trim()],
    [CLOUD_ADDON_E2B_TEMPLATE_ENV, env.get(CLOUD_ADDON_E2B_TEMPLATE_ENV)?.trim()],
    [CLOUD_ADDON_GITHUB_APP_ID_ENV, env.get(CLOUD_ADDON_GITHUB_APP_ID_ENV)?.trim()],
    [CLOUD_ADDON_GITHUB_APP_CLIENT_ID_ENV, env.get(CLOUD_ADDON_GITHUB_APP_CLIENT_ID_ENV)?.trim()],
    [CLOUD_ADDON_GITHUB_APP_CLIENT_SECRET_ENV, env.get(CLOUD_ADDON_GITHUB_APP_CLIENT_SECRET_ENV)?.trim()],
    [CLOUD_ADDON_GITHUB_APP_PRIVATE_KEY_ENV, env.get(CLOUD_ADDON_GITHUB_APP_PRIVATE_KEY_ENV)?.trim()],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `SH-CLOUD-ADDON: missing required cloud add-on env: ${missing.join(", ")}. ` +
        "These are founder-provisioned instance credentials (a self-host E2B account + self-built " +
        "template + a GitHub App on the fixed origin); without them the add-on cannot be enabled and " +
        "the cell fails closed (never skipped).",
    };
  }
  const [e2bApiKey, e2bTemplateName, githubAppId, githubAppClientId, githubAppClientSecret, githubAppPrivateKey] =
    required.map(([, value]) => value as string);
  return {
    ok: true,
    value: {
      e2bTemplateName,
      githubAppId,
      block: {
        e2bApiKey,
        e2bTemplateName,
        githubAppId,
        githubAppClientId,
        githubAppClientSecret,
        githubAppPrivateKey,
        githubAppCallbackBaseUrl: githubAppCallbackBaseUrl(apiOrigin),
      },
    },
  };
}

/**
 * Renders the `.env.static` lines the cloud add-on block appends. Secrets live
 * only in this string (which is written to a 0600 file, never argv). The
 * `E2B_API_KEY` + `E2B_TEMPLATE_NAME` pair is what `common.sh`
 * (`proliferate_enabled_profiles`) gates the `cloud-workspaces` compose profile
 * on; the GITHUB_APP_* keys configure the box's own App for the real product
 * GitHub authorization path.
 *
 * The PEM is rendered as a SINGLE `.env.static` line with literal `\n` escapes
 * (any real newlines in the input are escaped), matching the server's inline
 * parse (`github_app_private_key()` → `inline.replace("\\n", "\n")`) and
 * `.env.production.example`'s "escape newlines as \n". This keeps every add-on
 * key on exactly one line so `stripCloudAddonKeysSedProgram`'s `/^KEY=/d`
 * removes it cleanly on disable/re-enable (a multi-line value would orphan its
 * body lines). No surrounding quotes: the server reads the raw value and
 * unescapes it; quotes would become part of the key material.
 */
export function renderCloudAddonEnvLines(block: CloudAddonEnvBlock): string {
  const escapedPem = block.githubAppPrivateKey.replace(/\r?\n/g, "\\n");
  return [
    `E2B_API_KEY=${block.e2bApiKey}`,
    `E2B_TEMPLATE_NAME=${block.e2bTemplateName}`,
    `GITHUB_APP_ID=${block.githubAppId}`,
    `GITHUB_APP_CLIENT_ID=${block.githubAppClientId}`,
    `GITHUB_APP_CLIENT_SECRET=${block.githubAppClientSecret}`,
    `GITHUB_APP_CALLBACK_BASE_URL=${block.githubAppCallbackBaseUrl}`,
    `GITHUB_APP_PRIVATE_KEY=${escapedPem}`,
    "",
  ].join("\n");
}

/**
 * The env keys `renderCloudAddonEnvLines` sets. Like the gateway keys, the
 * shipped `.env.static` (copied from `.env.production.example`) already carries
 * blank defaults for some of these, and `proliferate_read_env` reads the FIRST
 * `KEY=` occurrence (`grep -m1`), so a blind append leaves the shipped blank
 * winning and the profile never enables. These must be stripped before the block
 * is appended so ours are the only occurrence.
 */
export const CLOUD_ADDON_ENV_KEYS = [
  "E2B_API_KEY",
  "E2B_TEMPLATE_NAME",
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_CALLBACK_BASE_URL",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

/**
 * A `sed -i` program that deletes every existing `KEY=` line for the cloud add-on
 * keys from an env file, so the appended block's values are the only occurrences
 * `proliferate_read_env` (grep -m1) can read. Anchored to the line start with an
 * escaped literal key; no secret value appears (keys only).
 */
export function stripCloudAddonKeysSedProgram(): string {
  return CLOUD_ADDON_ENV_KEYS.map((key) => `/^${key}=/d`).join(";");
}

/** IO seam for scp'ing the secret env block (a 0600 tmp file, never argv). */
export interface CloudAddonEnvIo {
  writeLocalTmp: (contents: string) => Promise<string>;
  removeLocalTmp: (path: string) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * Writes the cloud add-on env block into the instance `.env.static` and enables
 * the `cloud-workspaces` profile the documented way: a 0600 file scp'd to the
 * box (secrets never on argv), the pre-existing add-on keys sed-stripped, the
 * block appended, then the shipped `bootstrap.sh` re-resolves + brings up the
 * profile services with `--wait`. Mirrors `configureAndEnableGatewayProfile`.
 */
export async function configureAndEnableCloudAddonProfile(
  ssh: SshTransport,
  block: CloudAddonEnvBlock,
  io: CloudAddonEnvIo,
): Promise<void> {
  const log = io.log ?? (() => undefined);
  const remoteTmp = "proliferate-candidate/cloud-addon.env";
  const localTmp = await io.writeLocalTmp(renderCloudAddonEnvLines(block));
  try {
    await ssh.scp(localTmp, remoteTmp);
    log("overriding cloud add-on env keys in .env.static + running bootstrap.sh --wait");
    const sedProgram = stripCloudAddonKeysSedProgram();
    await ssh.run(
      `sudo bash -c 'sed -i "${sedProgram}" ${CLOUD_ADDON_DEPLOY_DIR}/.env.static && ` +
        `cat ${remoteTmp} >> ${CLOUD_ADDON_DEPLOY_DIR}/.env.static && rm -f ${remoteTmp}'`,
      { timeoutMs: 60_000 },
    );
    try {
      await ssh.run(
        `cd ${CLOUD_ADDON_DEPLOY_DIR} && sudo env PROLIFERATE_COMPOSE_OVERRIDE_FILE=${SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE} ` +
          `bash bootstrap.sh > /tmp/cloud-addon-bootstrap.log 2>&1`,
        { timeoutMs: BOX_STEP_TIMEOUT_MS },
      );
    } catch (error) {
      const diag = await captureCloudAddonBootstrapDiag(ssh).catch(() => "(diagnostic capture failed)");
      const base = error instanceof Error ? error.message : String(error);
      throw new Error(`SH-CLOUD-ADDON: bootstrap.sh failed to bring up the cloud-workspaces profile. ${diag} (${base})`);
    }
  } finally {
    await io.removeLocalTmp(localTmp).catch(() => undefined);
  }
}

/**
 * DISABLES the cloud add-on: strips the add-on env keys from `.env.static` and
 * reruns `bootstrap.sh`, which re-resolves `proliferate_enabled_profiles`
 * (now missing the E2B pair) and `--wait`s the base profile only. Because
 * `bootstrap.sh`'s bring-up does not itself stop the now-deprofiled containers,
 * we explicitly `down --remove-orphans` the cloud-workspaces services first so
 * the running redis/materializer stop and the API re-reports `cloudWorkspaces`
 * false. The base stack (db/migrate/api/caddy) is brought back with `--wait`.
 */
export async function disableCloudAddonProfile(ssh: SshTransport, io: CloudAddonEnvIo): Promise<void> {
  const log = io.log ?? (() => undefined);
  log("stripping cloud add-on env keys from .env.static + rerunning bootstrap.sh to disable the add-on");
  const sedProgram = stripCloudAddonKeysSedProgram();
  // Strip the add-on keys so the resolved config no longer enables the profile.
  await ssh.run(`sudo sed -i "${sedProgram}" ${CLOUD_ADDON_DEPLOY_DIR}/.env.static`, { timeoutMs: 60_000 });
  // Stop the now-deprofiled cloud-workspaces services explicitly (bootstrap's
  // up -d does not remove services that dropped out of the active profile set).
  try {
    await ssh.run(
      `cd ${CLOUD_ADDON_DEPLOY_DIR} && sudo docker compose --env-file .env.runtime ` +
        "-f docker-compose.production.yml --profile cloud-workspaces stop redis 2>/dev/null || true",
      { timeoutMs: 60_000 },
    );
  } catch {
    // Best-effort: the reassert below is the real truth check.
  }
  try {
    await ssh.run(
      `cd ${CLOUD_ADDON_DEPLOY_DIR} && sudo env PROLIFERATE_COMPOSE_OVERRIDE_FILE=${SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE} ` +
        `bash bootstrap.sh > /tmp/cloud-addon-disable.log 2>&1`,
      {
        timeoutMs: BOX_STEP_TIMEOUT_MS,
      },
    );
  } catch (error) {
    const diag = await captureCloudAddonBootstrapDiag(ssh).catch(() => "(diagnostic capture failed)");
    const base = error instanceof Error ? error.message : String(error);
    throw new Error(`SH-CLOUD-ADDON: bootstrap.sh failed to re-converge after disabling the add-on. ${diag} (${base})`);
  }
}

/**
 * Bounded, secret-free on-box snapshot for a cloud add-on bootstrap failure: the
 * compose service states (redis/api/migrate) and a secret-scrubbed, allowlisted
 * tail of bootstrap's own output. Raw container logs (which can echo the E2B key
 * or App secret) are intentionally excluded.
 */
async function captureCloudAddonBootstrapDiag(ssh: SshTransport): Promise<string> {
  const composePs = (
    await ssh
      .run(
        `cd ${CLOUD_ADDON_DEPLOY_DIR} && sudo docker compose --env-file .env.runtime ` +
          "-f docker-compose.production.yml --profile cloud-workspaces ps " +
          "--format '{{.Service}}:{{.State}}:{{.Health}}' 2>/dev/null | tr '\\n' ' '",
        { timeoutMs: 60_000 },
      )
      .catch(() => "")
  ).trim();
  const bootstrapTail = (
    await ssh
      .run(
        "grep -aiE 'error|err:|warn|preflight|redis|e2b|health|cannot|failed|denied|" +
          "pull|no space|unhealthy|exited|dependency|profile' " +
          "/tmp/cloud-addon-bootstrap.log /tmp/cloud-addon-disable.log 2>/dev/null | tail -n 20 | tr '\\n' '|'",
        { timeoutMs: 60_000 },
      )
      .catch(() => "")
  ).trim();
  const scrubbedTail = bootstrapTail ? scrubSecretText(bootstrapTail) : "";
  return `compose states: [${composePs || "none"}]` + (scrubbedTail ? `; bootstrap tail: [${scrubbedTail}]` : "");
}
