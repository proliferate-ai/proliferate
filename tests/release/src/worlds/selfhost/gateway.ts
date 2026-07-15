import { randomBytes } from "node:crypto";

import type { SshTransport } from "./world.js";
import { SELFHOST_DEPLOY_DIR } from "./install.js";

/**
 * Box-side operations for SELFHOST-QUAL-1's `SH-GATEWAY` cell (frozen tier-3
 * contract §`SH-GATEWAY`): boot the documented optional operator LiteLLM
 * profile, observe its pinned image, verify the enrolled actor's scoped virtual
 * key + its spend through the INSTANCE LiteLLM admin API, and prove capability
 * truth persists across a restart.
 *
 * Everything privileged runs over the world's `SshTransport` (never argv for a
 * secret — the run-scoped master key / upstream provider key are written into a
 * 0600 file scp'd to the box and appended to `.env.static`, and every admin
 * LiteLLM call reads `LITELLM_MASTER_KEY` from the litellm container's OWN env
 * inside the compose network, exactly like `scenarios/selfhost/t3-sh-3.ts`, so
 * the master key never rides a command line). The pure config/correlation
 * helpers below carry the decision logic the unit tests exercise offline; the
 * SSH-touching ops are faked in tests.
 *
 * Ruled inputs (tier-3 contract "Product Rulings"): Proliferate's managed
 * gateway is LiteLLM; a gateway session receives only the public inference URL
 * and its scoped virtual key — administrative credentials never enter a runtime
 * target; a direct master-key call is NOT product proof.
 */

/** Where the shipped installer put the deploy dir (single-sourced from install.ts). */
export const GATEWAY_DEPLOY_DIR = SELFHOST_DEPLOY_DIR;

/** The default LiteLLM image tag when `RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG` is unset. */
export const DEFAULT_LITELLM_IMAGE_TAG = "stable";

/** The public Caddy inference route the instance serves LiteLLM under (`handle_path /llm/*`). */
export function gatewayPublicBaseUrl(apiOrigin: string): string {
  return `${apiOrigin.replace(/\/+$/, "")}/llm`;
}

/**
 * The resolved gateway env block written into the instance `.env.static`. The
 * master key + postgres password are GENERATED per run (never a shared secret);
 * the upstream Anthropic key is the run-scoped BYOK manifest key; the image tag
 * is pinned from the manifest. `agentGatewayEnabled` is a literal so the block
 * always flips `capabilities.agentGateway` on.
 */
export interface GatewayEnvBlock {
  agentGatewayEnabled: true;
  litellmMasterKey: string;
  litellmPostgresPassword: string;
  litellmPublicBaseUrl: string;
  upstreamAnthropicKey: string;
  litellmImageTag: string;
}

export interface GatewayConfig {
  block: GatewayEnvBlock;
  /** The LiteLLM image tag pinned (recorded so evidence names the intended tag). */
  imageTag: string;
  /** Which manifest key the upstream provider credential came from (for diagnostics, never the value). */
  upstreamKeyEnvVar: string;
}

/** A minimal env getter so `resolveGatewayConfig` is pure + offline-testable. */
export interface GatewayEnvSource {
  get(name: string): string | undefined;
}

/** Generates a run-scoped LiteLLM master key (never a shared/static secret). */
export function generateGatewayMasterKey(): string {
  return `sk-${randomBytes(32).toString("hex")}`;
}

/** Generates a run-scoped LiteLLM postgres password. */
export function generateLitellmPostgresPassword(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Resolves the SH-GATEWAY env block from the controller env + the box's public
 * API origin. The upstream provider credential prefers the `_B_` BYOK manifest
 * key (so gateway spend separates from the SH-BASE-TURN BYOK-regression cell's
 * `_A_` key) and falls back to `_A_`; when neither exists the cell fails closed.
 * The master key and postgres password are freshly generated here.
 */
export function resolveGatewayConfig(
  env: GatewayEnvSource,
  apiOrigin: string,
): { ok: true; value: GatewayConfig } | { ok: false; reason: string } {
  const bKey = env.get("RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY")?.trim();
  const aKey = env.get("RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY")?.trim();
  const upstreamKeyEnvVar = bKey
    ? "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY"
    : aKey
      ? "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY"
      : undefined;
  const upstreamAnthropicKey = bKey || aKey;
  if (!upstreamKeyEnvVar || !upstreamAnthropicKey) {
    return {
      ok: false,
      reason:
        "SH-GATEWAY: no upstream provider key configured — set RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY " +
        "(preferred) or RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY so the operator LiteLLM profile has a real backend.",
    };
  }
  const imageTag = env.get("RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG")?.trim() || DEFAULT_LITELLM_IMAGE_TAG;
  return {
    ok: true,
    value: {
      imageTag,
      upstreamKeyEnvVar,
      block: {
        agentGatewayEnabled: true,
        litellmMasterKey: generateGatewayMasterKey(),
        litellmPostgresPassword: generateLitellmPostgresPassword(),
        litellmPublicBaseUrl: gatewayPublicBaseUrl(apiOrigin),
        upstreamAnthropicKey,
        litellmImageTag: imageTag,
      },
    },
  };
}

/**
 * Renders the `.env.static` lines the gateway block appends. Secrets live only
 * in this string (which is written to a 0600 file, never argv). `AGENT_GATEWAY_
 * LITELLM_MASTER_KEY` MUST equal `LITELLM_MASTER_KEY` (the api and the litellm
 * container share the one master key — see `.env.production.example`).
 */
export function renderGatewayEnvLines(block: GatewayEnvBlock): string {
  return [
    "AGENT_GATEWAY_ENABLED=true",
    "AGENT_GATEWAY_LITELLM_BASE_URL=http://litellm:4000",
    `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=${block.litellmPublicBaseUrl}`,
    `AGENT_GATEWAY_LITELLM_MASTER_KEY=${block.litellmMasterKey}`,
    `LITELLM_MASTER_KEY=${block.litellmMasterKey}`,
    `LITELLM_POSTGRES_PASSWORD=${block.litellmPostgresPassword}`,
    `PROLIFERATE_LITELLM_IMAGE_TAG=${block.litellmImageTag}`,
    `ANTHROPIC_API_KEY=${block.upstreamAnthropicKey}`,
    "",
  ].join("\n");
}

/**
 * One LiteLLM per-request spend row (`/spend/logs?summarize=false`). `api_key`
 * is the request's virtual-key token id (or the master key's token id for a
 * direct master-key call). `total_tokens` distinguishes a real, token-consuming
 * request from a mocked/short-circuited one.
 */
export interface LitellmSpendRow {
  api_key: string;
  spend?: number;
  total_tokens?: number;
  model?: string;
}

/**
 * Pure correlation of a spend snapshot to the enrolled actor's virtual key.
 * `correlated` requires a REAL, token-consuming row under `api_key === token`.
 * `masterKeyNotUsed` holds only when the correlated spend belongs to the
 * virtual key AND no token-consuming spend rode a DIFFERENT key — i.e. the turn
 * went through the actor's scoped key, never the master key (a direct master-key
 * call is not product proof).
 */
export function correlateGatewaySpend(
  rows: readonly LitellmSpendRow[],
  virtualKeyTokenId: string,
): { correlated: boolean; masterKeyNotUsed: boolean } {
  const tokenConsuming = rows.filter((row) => (row.total_tokens ?? 0) > 0);
  const correlated = tokenConsuming.some((row) => row.api_key === virtualKeyTokenId);
  const spentUnderOtherKey = tokenConsuming.some((row) => row.api_key !== virtualKeyTokenId);
  return { correlated, masterKeyNotUsed: correlated && !spentUnderOtherKey };
}

// ── SSH-touching box operations (faked in unit tests) ───────────────────────

/** Bounded default timeout for a single on-box compose/docker step. */
const BOX_STEP_TIMEOUT_MS = 5 * 60_000;

/**
 * Writes the gateway env block into the instance `.env.static` and enables the
 * operator profile the documented way: a 0600 file scp'd to the box (secrets
 * never on argv), appended to `.env.static`, then the shipped `bootstrap.sh`
 * re-resolves + brings up the `agent-gateway` profile services with `--wait`.
 * `writeLocalTmp`/`removeLocalTmp` are injected so unit tests never touch disk.
 */
export async function configureAndEnableGatewayProfile(
  ssh: SshTransport,
  block: GatewayEnvBlock,
  io: {
    writeLocalTmp: (contents: string) => Promise<string>;
    removeLocalTmp: (path: string) => Promise<void>;
    log?: (message: string) => void;
  },
): Promise<void> {
  const log = io.log ?? (() => undefined);
  const remoteTmp = "proliferate-candidate/gateway.env";
  const localTmp = await io.writeLocalTmp(renderGatewayEnvLines(block));
  try {
    await ssh.scp(localTmp, remoteTmp);
    // Append the block to .env.static (0600), then rerun the shipped bootstrap
    // so it re-resolves .env.runtime and brings up the agent-gateway profile.
    log("appending gateway env block + running bootstrap.sh --wait");
    await ssh.run(`sudo bash -c 'cat ${remoteTmp} >> ${GATEWAY_DEPLOY_DIR}/.env.static && rm -f ${remoteTmp}'`, {
      timeoutMs: 60_000,
    });
    await ssh.run(`cd ${GATEWAY_DEPLOY_DIR} && sudo bash bootstrap.sh`, { timeoutMs: BOX_STEP_TIMEOUT_MS });
  } finally {
    await io.removeLocalTmp(localTmp).catch(() => undefined);
  }
}

/** Reads the running litellm container name on the box (empty if the profile is down). */
async function litellmContainer(ssh: SshTransport): Promise<string> {
  return (
    await ssh.run(
      "sudo docker ps --filter label=com.docker.compose.service=litellm --format '{{.Names}}' | head -n1",
      { timeoutMs: 60_000 },
    )
  ).trim();
}

/**
 * Observes the pinned LiteLLM image digest on the box (`sha256:...`) — the
 * evidence's honest record of what actually ran, regardless of the tag pinned.
 */
export async function observeLitellmImageDigest(ssh: SshTransport): Promise<string> {
  const container = await litellmContainer(ssh);
  if (!container) {
    throw new Error("SH-GATEWAY: no running litellm container — the agent-gateway profile did not come up.");
  }
  const image = (
    await ssh.run(`sudo docker inspect --format '{{.Image}}' ${container}`, { timeoutMs: 60_000 })
  ).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(image)) {
    throw new Error(`SH-GATEWAY: could not observe a valid litellm image digest (saw ${JSON.stringify(image)}).`);
  }
  return image;
}

/**
 * Asserts the operator gateway is UP + healthy on the box: the profiled litellm
 * container is healthy and the api reports `AGENT_GATEWAY_ENABLED=true`. Used
 * both after bring-up and after the restart persistence check.
 */
export async function assertGatewayHealthyOnBox(
  ssh: SshTransport,
): Promise<{ healthy: boolean; agentGatewayEnabled: boolean }> {
  const container = await litellmContainer(ssh);
  if (!container) {
    return { healthy: false, agentGatewayEnabled: false };
  }
  const health = (
    await ssh.run(
      `sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' ${container}`,
      { timeoutMs: 60_000 },
    )
  ).trim();
  const apiContainer = (
    await ssh.run(
      "sudo docker ps --filter label=com.docker.compose.service=api --format '{{.Names}}' | head -n1",
      { timeoutMs: 60_000 },
    )
  ).trim();
  const enabled = apiContainer
    ? (
        await ssh.run(`sudo docker exec ${apiContainer} printenv AGENT_GATEWAY_ENABLED 2>/dev/null || true`, {
          timeoutMs: 60_000,
        })
      ).trim()
    : "";
  return { healthy: health === "healthy", agentGatewayEnabled: enabled === "true" };
}

/**
 * A tiny in-container python one-liner against the instance LiteLLM admin API
 * (`http://127.0.0.1:4000`) authenticated with the master key read from the
 * container's OWN env — never printed, never on argv (mirrors t3-sh-3.ts). The
 * `path` + optional query are interpolated into the request URL.
 */
async function litellmAdminGet(ssh: SshTransport, path: string): Promise<unknown> {
  const container = await litellmContainer(ssh);
  if (!container) {
    throw new Error("SH-GATEWAY: litellm container not running for an admin query.");
  }
  const py =
    "import os,json,urllib.request;" +
    `req=urllib.request.Request('http://127.0.0.1:4000${path}',` +
    "headers={'Authorization':'Bearer '+os.environ['LITELLM_MASTER_KEY']});" +
    "print(urllib.request.urlopen(req,timeout=10).read().decode())";
  const out = await ssh.run(`sudo docker exec ${container} python3 -c "${py}"`, { timeoutMs: 60_000 });
  return JSON.parse(out.trim());
}

/**
 * Resolves the enrolled actor's virtual-key token id on the instance LiteLLM
 * (`/user/info?user_id=user-<uuid>` — the enrollment mints the key under
 * litellm user id `user-<uuid>`, see `enrollment.py`). Returns the first key's
 * token id (`api_key` in spend rows). Throws if the actor has no minted key.
 */
export async function litellmResolveActorKeyToken(ssh: SshTransport, productUserId: string): Promise<string> {
  const info = (await litellmAdminGet(
    ssh,
    `/user/info?user_id=${encodeURIComponent(`user-${productUserId}`)}`,
  )) as { keys?: Array<{ token?: string }> };
  const token = info.keys?.map((key) => key.token).find((value): value is string => Boolean(value));
  if (!token) {
    throw new Error(
      "SH-GATEWAY: the enrolled actor has no minted virtual key on the instance LiteLLM (lazy signup mint missing).",
    );
  }
  return token;
}

/**
 * Snapshots the instance LiteLLM per-request spend rows for the day window
 * (`/spend/logs?summarize=false&start_date=&end_date=`). The caller correlates
 * them to the actor's virtual key with `correlateGatewaySpend`.
 */
export async function litellmSpendRows(
  ssh: SshTransport,
  window: { startDate: string; endDate: string },
): Promise<LitellmSpendRow[]> {
  const rows = (await litellmAdminGet(
    ssh,
    `/spend/logs?summarize=false&start_date=${window.startDate}&end_date=${window.endDate}`,
  )) as Array<{ api_key?: string; spend?: number; total_tokens?: number; model?: string }>;
  if (!Array.isArray(rows)) {
    throw new Error("SH-GATEWAY: /spend/logs did not return an array.");
  }
  return rows.map((row) => ({
    api_key: String(row.api_key ?? ""),
    spend: row.spend,
    total_tokens: row.total_tokens,
    model: row.model,
  }));
}

/** The inclusive UTC day window (`YYYY-MM-DD`) covering a turn, for a spend-log query. */
export function spendWindowUtc(now = new Date()): { startDate: string; endDate: string } {
  const day = now.toISOString().slice(0, 10);
  return { startDate: day, endDate: day };
}
