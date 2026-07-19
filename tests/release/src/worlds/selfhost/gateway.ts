import { randomBytes } from "node:crypto";

import type { ApiClient } from "../../fixtures/http.js";
import { scrubSecretText } from "../../fixtures/redact-diagnostics.js";
import { SELFHOST_DEPLOY_DIR, SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE } from "./install.js";
import type { SshTransport } from "./world.js";

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

/**
 * Qualification-only headroom for the one bounded gateway turn. LiteLLM's
 * pre-call budget reservation prices Claude's maximum possible response at
 * $5.00. A key capped at the product fallback of exactly $5 is first reserved
 * to $5 and then rejected by LiteLLM's `spend >= max_budget` auth check before
 * any provider call. The disposable qualification actor therefore uses a $10
 * cap: enough to clear that reservation edge while remaining bounded and
 * leaving the shipped product default unchanged.
 */
export const QUALIFICATION_GATEWAY_USER_BUDGET_USD = "10";

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
  agentGatewayDefaultUserBudgetUsd: typeof QUALIFICATION_GATEWAY_USER_BUDGET_USD;
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
 * API origin. The upstream provider credential uses the scenario-required
 * `_A_` BYOK key (the same bounded self-host provider capacity already proven
 * by SH-BASE-TURN) and falls back to optional `_B_` only when `_A_` is absent.
 * Gateway spend is correlated to the actor's INSTANCE LiteLLM virtual key, so
 * sharing upstream provider capacity cannot create a false correlation. When
 * neither key exists the cell fails closed. The master key and postgres
 * password are freshly generated here.
 */
export function resolveGatewayConfig(
  env: GatewayEnvSource,
  apiOrigin: string,
): { ok: true; value: GatewayConfig } | { ok: false; reason: string } {
  const bKey = env.get("RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY")?.trim();
  const aKey = env.get("RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY")?.trim();
  const upstreamKeyEnvVar = aKey
    ? "RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY"
    : bKey
      ? "RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY"
      : undefined;
  const upstreamAnthropicKey = aKey || bKey;
  if (!upstreamKeyEnvVar || !upstreamAnthropicKey) {
    return {
      ok: false,
      reason:
        "SH-GATEWAY: no upstream provider key configured — set RELEASE_E2E_BYOK_ANTHROPIC_A_API_KEY " +
        "(preferred) or RELEASE_E2E_BYOK_ANTHROPIC_B_API_KEY so the operator LiteLLM profile has a real backend.",
    };
  }
  // The LiteLLM image MUST be pinned to an immutable tag (PR7-CONTROL-010):
  // falling back to the mutable `stable` tag would let an unpinned run silently
  // exercise a rolling image, so a green SH-GATEWAY could not attest which bytes
  // ran. Absent (or a `stable`/`latest` rolling value) → fail closed, matching
  // frozen decision 8 ("SH-GATEWAY pins via PROLIFERATE_LITELLM_IMAGE_TAG").
  const imageTag = env.get("RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG")?.trim();
  if (!imageTag) {
    return {
      ok: false,
      reason:
        "SH-GATEWAY: RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG is not set — the LiteLLM image must be pinned to an " +
        "immutable tag (no mutable `stable` fallback, PR7-CONTROL-010); failing closed.",
    };
  }
  if (imageTag.toLowerCase() === "stable" || imageTag.toLowerCase() === "latest") {
    return {
      ok: false,
      reason: `SH-GATEWAY: RELEASE_E2E_SELFHOST_LITELLM_IMAGE_TAG="${imageTag}" is a mutable rolling tag; pin an immutable tag/digest.`,
    };
  }
  return {
    ok: true,
    value: {
      imageTag,
      upstreamKeyEnvVar,
      block: {
        agentGatewayEnabled: true,
        agentGatewayDefaultUserBudgetUsd: QUALIFICATION_GATEWAY_USER_BUDGET_USD,
        litellmMasterKey: generateGatewayMasterKey(),
        litellmPostgresPassword: generateLitellmPostgresPassword(),
        litellmPublicBaseUrl: gatewayPublicBaseUrl(apiOrigin),
        upstreamAnthropicKey,
        litellmImageTag: imageTag,
      },
    },
  };
}

// ── Gateway-route auth selection (the product PUT that routes a harness) ─────

/**
 * The managed-gateway `sourceKind`. The server's ONE selection vocabulary is
 * `Literal["gateway", "api_key"]`
 * (server/proliferate/server/cloud/agent_gateway/models.py:33
 * `AgentAuthSourceKind`). SH-GATEWAY selects the managed route, so the enabled
 * source is the single `"gateway"` kind — it carries NO `apiKeyId`/`envVarName`
 * (those belong only to the BYOK `"api_key"` route; the gateway recipe's key +
 * base URL are minted/rendered server-side from the user's enrollment, see
 * `materialize/agent_auth.py` `_render_gateway_source`). The per-harness
 * legality validator (`selection_rules.py`) admits a lone gateway source for
 * every GATEWAY_CAPABLE_HARNESS (claude included).
 */
export const GATEWAY_SOURCE_KIND = "gateway" as const;

export interface GatewayAuthSelectionBody {
  sources: Array<{ sourceKind: typeof GATEWAY_SOURCE_KIND; enabled: true }>;
}

/**
 * Pure builder of the full-desired-state selection PUT body that routes a
 * harness through the managed gateway — the gateway twin of BYOK's
 * `{ sourceKind: "api_key", apiKeyId, envVarName, enabled }` payload
 * (`fixtures/byok.ts`). Offline-testable so the exact wire shape the product
 * sends is asserted without a live Server.
 */
export function gatewayAuthSelectionBody(): GatewayAuthSelectionBody {
  return { sources: [{ sourceKind: GATEWAY_SOURCE_KIND, enabled: true }] };
}

/** The product-API side effect of the gateway-route selection, injectable for offline tests. */
export interface GatewaySelectionTransport {
  putSelection(api: ApiClient, harnessKind: string, body: GatewayAuthSelectionBody): Promise<void>;
}

export const defaultGatewaySelectionTransport: GatewaySelectionTransport = {
  async putSelection(api, harnessKind, body) {
    await api.put(`/v1/cloud/agent-gateway/selections/${encodeURIComponent(harnessKind)}?surface=local`, body);
  },
};

/**
 * Selects the managed-gateway route for a harness on the LOCAL surface exactly
 * the way the product does — `PUT /v1/cloud/agent-gateway/selections/{harness}?
 * surface=local` with the single gateway source. The enrolled actor's own API
 * client is passed (the selection is per-user; the Desktop later fetches
 * `GET /state?surface=local` for THIS user and pushes the rendered gateway
 * source into the controller-local runtime).
 */
export async function selectGatewayRouteForHarness(
  api: ApiClient,
  harnessKind: string,
  transport: GatewaySelectionTransport = defaultGatewaySelectionTransport,
): Promise<void> {
  await transport.putSelection(api, harnessKind, gatewayAuthSelectionBody());
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
    `AGENT_GATEWAY_DEFAULT_USER_BUDGET_USD=${block.agentGatewayDefaultUserBudgetUsd}`,
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
 * The env keys `renderGatewayEnvLines` sets. The shipped `.env.static` (copied
 * from `.env.production.example` by install.sh) already carries defaults for
 * some of these — notably `AGENT_GATEWAY_ENABLED=false`. `proliferate_read_env`
 * reads the FIRST `KEY=` occurrence (`grep -m1`), so a blind append leaves the
 * shipped `false` winning and the profile never comes up. These keys must be
 * stripped from `.env.static` before the block is appended so ours are the only
 * occurrence.
 */
export const GATEWAY_ENV_KEYS = [
  "AGENT_GATEWAY_ENABLED",
  "AGENT_GATEWAY_DEFAULT_USER_BUDGET_USD",
  "AGENT_GATEWAY_LITELLM_BASE_URL",
  "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
  "AGENT_GATEWAY_LITELLM_MASTER_KEY",
  "LITELLM_MASTER_KEY",
  "LITELLM_POSTGRES_PASSWORD",
  "PROLIFERATE_LITELLM_IMAGE_TAG",
  "ANTHROPIC_API_KEY",
] as const;

/**
 * A `sed -i` program that deletes every existing `KEY=` line for the gateway
 * keys from an env file, so the appended block's values are the only
 * occurrences `proliferate_read_env` (grep -m1) can read. Anchored to the line
 * start with an escaped literal key; no secret value appears (keys only).
 */
export function stripGatewayKeysSedProgram(): string {
  return GATEWAY_ENV_KEYS.map((key) => `/^${key}=/d`).join(";");
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
 * Bounded timeout for the full bootstrap.sh re-run that enables the
 * agent-gateway profile. This single ssh call nests a cold litellm image pull
 * (first time the profiled service is touched on the box — minutes on a
 * t3.small's baseline network credits) PLUS compose's own
 * `up -d --wait --wait-timeout 300` health wait with litellm's 180s
 * start_period. The outer ssh budget must exceed that inner 300s wait or the
 * local timeout SIGTERMs ssh mid-pull with an empty, content-free error
 * (observed on run 29622211632: bare "Command failed: ssh ..." and an empty
 * compose-states diag because the containers were never created).
 */
const BOOTSTRAP_TIMEOUT_MS = 12 * 60_000;

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
    // Strip any pre-existing gateway keys from .env.static (the shipped example
    // seeds AGENT_GATEWAY_ENABLED=false, and proliferate_read_env reads the
    // FIRST occurrence), THEN append the block, so our values are the only ones
    // bootstrap resolves. Finally rerun the shipped bootstrap so it re-resolves
    // .env.runtime and brings up the agent-gateway profile.
    log("overriding gateway env keys in .env.static + running bootstrap.sh --wait");
    const sedProgram = stripGatewayKeysSedProgram();
    await ssh.run(
      `sudo bash -c 'sed -i "${sedProgram}" ${GATEWAY_DEPLOY_DIR}/.env.static && ` +
        `cat ${remoteTmp} >> ${GATEWAY_DEPLOY_DIR}/.env.static && rm -f ${remoteTmp}'`,
      { timeoutMs: 60_000 },
    );
    try {
      // Capture bootstrap's own stdout+stderr to a box file so a failure's
      // on-box cause (preflight err/warn lines, compose pull/health errors) is
      // recoverable — the ssh transport otherwise discards the remote stderr.
      await ssh.run(
        `cd ${GATEWAY_DEPLOY_DIR} && sudo env PROLIFERATE_COMPOSE_OVERRIDE_FILE=${SELFHOST_PERSISTED_TLS_COMPOSE_OVERRIDE} ` +
          `bash bootstrap.sh > /tmp/gw-bootstrap.log 2>&1`,
        { timeoutMs: BOOTSTRAP_TIMEOUT_MS },
      );
    } catch (error) {
      // bootstrap.sh runs `up -d --wait litellm`; if litellm never reaches
      // healthy it exits non-zero and the raw ssh error withholds the on-box
      // cause. Capture a bounded, SECRET-FREE snapshot of the compose service
      // states + the litellm container's status/health/exit code, plus a
      // secret-scrubbed tail of the bootstrap log (allowlisted diagnostic lines
      // only — never raw container logs, which can echo the master key).
      const diag = await captureGatewayBootstrapDiag(ssh).catch(() => "(diagnostic capture failed)");
      const base = error instanceof Error ? error.message : String(error);
      throw new Error(`SH-GATEWAY: bootstrap.sh failed to bring up the agent-gateway profile. ${diag} (${base})`);
    }
  } finally {
    await io.removeLocalTmp(localTmp).catch(() => undefined);
  }
}

/**
 * Bounded, secret-free on-box snapshot for a gateway bootstrap failure: the
 * compose service states and the litellm container's status/health/exit code.
 * States/health/exit codes carry no secrets; raw container logs (which can echo
 * the master key) are intentionally excluded.
 */
async function captureGatewayBootstrapDiag(ssh: SshTransport): Promise<string> {
  // A probe that errors is reported "(probe failed)" — distinct from a probe
  // that ran and genuinely had nothing to show ("none"). Collapsing both to the
  // same empty string made run 29622211632's failure undiagnosable.
  const probe = (cmd: string): Promise<string> =>
    ssh
      .run(cmd, { timeoutMs: 60_000 })
      .then((out) => out.trim() || "none")
      .catch(() => "(probe failed)");
  const composePs = await probe(
    `cd ${GATEWAY_DEPLOY_DIR} && sudo docker compose --env-file .env.runtime ` +
      `-f docker-compose.production.yml --profile agent-gateway ps ` +
      `--format '{{.Service}}:{{.State}}:{{.Health}}' 2>/dev/null | tr '\\n' ' '`,
  );
  const litellmInspect = await probe(
    "sudo docker ps -a --filter label=com.docker.compose.service=litellm " +
      "--format '{{.Names}}:{{.Status}}' 2>/dev/null | head -n1",
  );
  // Allowlisted, secret-scrubbed tail of bootstrap's own output. grep -E keeps
  // only diagnostic marker lines (preflight err/warn/ok, compose/pull/health
  // errors) — never arbitrary lines that might echo a resolved secret value —
  // and every survivor still passes through scrubSecretText.
  const bootstrapTail = await probe(
    "grep -aiE 'error|err:|warn|preflight|litellm|health|cannot|failed|denied|manifest|" +
      "pull|no space|unhealthy|exited|dependency' /tmp/gw-bootstrap.log 2>/dev/null | tail -n 20 | tr '\\n' '|'",
  );
  // Unconditional raw tail (bounded + scrubbed): when the allowlist grep finds
  // nothing (e.g. compose's buffered pull-progress output), the last bytes of
  // the log still say how far bootstrap got before it died.
  const rawTail = await probe("tail -c 2000 /tmp/gw-bootstrap.log 2>/dev/null | tr '\\n' '|'");
  const scrub = (s: string) => (s === "none" || s === "(probe failed)" ? s : scrubSecretText(s));
  return (
    `compose states: [${composePs}]; litellm container: [${litellmInspect}]; ` +
    `bootstrap tail: [${scrub(bootstrapTail)}]; raw tail: [${scrub(rawTail)}]`
  );
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

/** The LiteLLM key-alias prefix the PERSONAL (per-user) enrollment mints under. */
export const PERSONAL_ENROLLMENT_KEY_ALIAS_PREFIX = "vk-user-";

/**
 * Pure selection of the PERSONAL-enrollment virtual key token from a LiteLLM
 * user's keys. The self-host agent-auth state renders the gateway source from
 * the USER enrollment (`get_enrollment_for_user` filters `subject_kind=user`,
 * db/store/agent_gateway/enrollments.py), whose key alias is `vk-user-<uuid>-…`
 * (`enrollment.py` `_key_alias` with `subject_label="user-<uuid>"`). A member
 * who ALSO holds an org enrollment carries a second key under the SAME LiteLLM
 * user (`user-<uuid>`) aliased `vk-org-…`; that key is never the one the turn
 * rides, so returning it would break the spend correlation. Prefer the
 * personal-alias key; fall back to the first token only when no alias is present
 * (older mints), so a single-key actor still resolves.
 */
export function selectPersonalEnrollmentKeyToken(
  keys: ReadonlyArray<{ token?: string | null; key_alias?: string | null }>,
): string | undefined {
  const personal = keys.find(
    (key) => Boolean(key.token) && (key.key_alias ?? "").startsWith(PERSONAL_ENROLLMENT_KEY_ALIAS_PREFIX),
  );
  if (personal?.token) {
    return personal.token;
  }
  return keys.map((key) => key.token).find((value): value is string => Boolean(value));
}

/**
 * Resolves the enrolled actor's PERSONAL virtual-key token id on the instance
 * LiteLLM (`/user/info?user_id=user-<uuid>` — the enrollment mints keys under
 * litellm user id `user-<uuid>`, see `enrollment.py`). Returns the token id
 * (`api_key` in spend rows) of the personal enrollment's key (the one the
 * gateway agent-auth state actually rendered), preferring it over any
 * co-located org-enrollment key. Throws if the actor has no minted key.
 */
export async function litellmResolveActorKeyToken(ssh: SshTransport, productUserId: string): Promise<string> {
  const info = (await litellmAdminGet(
    ssh,
    `/user/info?user_id=${encodeURIComponent(`user-${productUserId}`)}`,
  )) as { keys?: Array<{ token?: string | null; key_alias?: string | null }> };
  const token = selectPersonalEnrollmentKeyToken(info.keys ?? []);
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

/**
 * The UTC date window (`YYYY-MM-DD`) covering a turn for a spend-log query.
 * LiteLLM parses `end_date` at midnight and applies `startTime <= end_date`, so
 * an end bound equal to today excludes every request made after 00:00 today.
 * Match the production usage importer and advance the end bound by one day.
 */
export function spendWindowUtc(now = new Date()): { startDate: string; endDate: string } {
  const day = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  return { startDate: day, endDate: tomorrow };
}

// ── Actor enrollment sync (server-side virtual-key mint) ────────────────────

/** The `enrollmentStatus` value that means the actor's scoped virtual key is minted
 * (`server/proliferate/constants/agent_gateway.py` `AGENT_GATEWAY_SYNC_STATUS_SYNCED`). */
export const GATEWAY_ENROLLMENT_STATUS_SYNCED = "synced";

/**
 * On self-host a FRESH member is NOT enrolled synchronously at register — the
 * single-org membership policy only adds the org membership; the personal
 * (per-user) gateway enrollment that the gateway agent-auth state renders from
 * (`get_enrollment_for_user`) is minted by the backfill worker
 * (`agent_gateway_backfill_interval_seconds`, default 300s). So the actor's key
 * can take up to a backfill tick plus its LiteLLM sync to appear. Waiting for
 * `synced` BEFORE the Desktop fetches `/state?surface=local` guarantees the one
 * state fetch renders a populated gateway source (rather than pushing an empty
 * one the Desktop never re-fetches). Generous by design; ~2 backfill ticks.
 */
export const DEFAULT_ENROLLMENT_SYNC_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_ENROLLMENT_SYNC_POLL_MS = 5_000;

/** The gateway capabilities wire shape (`AgentGatewayCapabilitiesResponse`, camelCase aliases). */
export interface GatewayCapabilities {
  gatewayEnabled: boolean;
  publicBaseUrl: string | null;
  enrollmentStatus: string;
}

/** Reads the actor's gateway capabilities (injectable so the poll is offline-testable). */
export interface GatewayEnrollmentTransport {
  fetchCapabilities(api: ApiClient): Promise<GatewayCapabilities>;
}

export const defaultGatewayEnrollmentTransport: GatewayEnrollmentTransport = {
  async fetchCapabilities(api) {
    return api.get<GatewayCapabilities>("/v1/cloud/agent-gateway/capabilities");
  },
};

/** Pure predicate: the actor's gateway enrollment has minted its virtual key. */
export function enrollmentIsSynced(capabilities: { enrollmentStatus?: string | null }): boolean {
  return capabilities.enrollmentStatus === GATEWAY_ENROLLMENT_STATUS_SYNCED;
}

/**
 * Polls the actor's gateway capabilities until enrollment reaches `synced`
 * (its scoped virtual key exists server-side), bounded. Fails closed with a
 * bounded, secret-free reason if the mint never lands within the window.
 */
export async function waitForActorEnrollmentSynced(
  api: ApiClient,
  options: { timeoutMs?: number; pollMs?: number } = {},
  transport: GatewayEnrollmentTransport = defaultGatewayEnrollmentTransport,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ENROLLMENT_SYNC_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_ENROLLMENT_SYNC_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let last = "none";
  for (;;) {
    try {
      const capabilities = await transport.fetchCapabilities(api);
      last = capabilities.enrollmentStatus || "none";
      if (enrollmentIsSynced(capabilities)) {
        return;
      }
    } catch (error) {
      last = `capabilities read failed (${error instanceof Error ? error.name : "unknown"})`;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `SH-GATEWAY: the enrolled actor's gateway enrollment did not reach "synced" within ${timeoutMs}ms ` +
          `(last status: ${last}); the backfill worker may not have minted its virtual key yet.`,
      );
    }
    await gatewaySleep(pollMs);
  }
}

function gatewaySleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
