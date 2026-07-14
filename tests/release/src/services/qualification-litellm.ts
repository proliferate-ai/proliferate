/**
 * The qualification LiteLLM controller (spec: "Shared service access",
 * "LiteLLM correlation", "Cleanup and failure behavior"). It owns every
 * privileged interaction with the persistent qualification LiteLLM proxy on
 * behalf of one local-world run:
 *
 *   - preflight (admin reachability + a non-Fable Claude model in the allowlist);
 *   - deterministic actor-key alias derivation `vk-user-<user_id>-<enrollment_id[:8]>`;
 *   - resolution of the actor key's `token_id` and owning subjects via the admin API;
 *   - pre-turn spend snapshot and post-turn spend correlation; and
 *   - deletion of the run-created virtual key, LiteLLM user, and LiteLLM team
 *     (frozen contract: deletion after spend is proven supported; no run-tagged
 *     sweep fallback is needed).
 *
 * The raw master key and the actor virtual key never leave this module: they do
 * not enter the candidate map, cell identity, report, browser logs, or
 * persisted evidence. Every value handed out is either a safe identity, a
 * one-way hash, or a bounded numeric/time aggregate.
 */

import { createHash } from "node:crypto";

/** The excluded premium model tier: the spec selects the cheapest eligible
 * NON-FABLE Claude model, so any candidate whose id contains this substring is
 * ineligible. */
export const EXCLUDED_MODEL_ID_SUBSTRING = "fable";

/** Substring that marks a Claude-family model id. */
const CLAUDE_MODEL_ID_SUBSTRING = "claude";

/**
 * Cheapest-first tier ranking for the Claude family. Cost is not available on
 * the wire, so the deterministic proxy is the published tier ladder
 * (haiku < sonnet < opus); any tier keyword we do not recognise sorts last,
 * and same-tier ties break lexicographically for a stable order.
 */
const CLAUDE_TIER_RANK: ReadonlyArray<readonly [string, number]> = [
  ["haiku", 0],
  ["sonnet", 1],
  ["opus", 2],
];

/** A bounded cap on accepted spend rows for one turn; more is treated as an
 * ambiguous/unbounded result and rejected. */
const MAX_CORRELATED_ROWS = 16;

/** Minimal HTTP response surface this controller consumes. */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** The single injectable HTTP seam — real global `fetch` in production, a
 * deterministic fake in unit tests. Never a real network call under test. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

export interface QualificationLiteLlmDeps {
  fetch?: FetchLike;
}

/** Raised for any LiteLLM controller failure; never embeds the master key or
 * raw virtual key (redaction is the caller's evidence pipeline, but this class
 * deliberately carries only safe identifiers). */
export class QualificationLiteLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualificationLiteLlmError";
  }
}

/**
 * Resolved, typed LiteLLM access. Both URLs and the master key arrive only via
 * typed env inputs (spec "Credential pointers"); this object is constructed
 * inside the world and never serialized.
 */
export interface QualificationLiteLlmConfig {
  /** AGENT_GATEWAY_LITELLM_BASE_URL — admin/control-plane URL. */
  adminBaseUrl: string;
  /** AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL — URL given to AnyHarness. */
  publicBaseUrl: string;
  /** AGENT_GATEWAY_LITELLM_MASTER_KEY — secret; stays private to this controller. */
  masterKey: string;
}

/** Result of preflight; carries only safe data (never the master key). */
export interface QualificationPreflightResult {
  adminReachable: true;
  /** The configured qualification model allowlist (admin-scoped view). */
  allowlistModels: string[];
  /** A cheapest-first ordering of eligible non-Fable Claude allowlist ids. */
  eligibleClaudeModels: string[];
}

/**
 * The actor key identity resolved after enrollment. `tokenId` stays in memory
 * for correlation only; `tokenIdHash` is the one-way hash written to evidence.
 * `userId`/`enrollmentId`/`teamId` name the run-created subjects to delete.
 */
export interface ActorKeyIdentity {
  userId: string;
  enrollmentId: string;
  teamId: string;
  /** The LiteLLM `user_id` the key was minted under (e.g. `user-<uuid>`); the
   * subject the run deletes, distinct from the product `userId`. */
  litellmUserId: string;
  keyAlias: string;
  /** Raw LiteLLM `token_id` — in-memory correlation only, never serialized. */
  tokenId: string;
  /** One-way hash of `tokenId`; the only token identity allowed in evidence. */
  tokenIdHash: string;
}

/** Pre-turn snapshot of the actor key's LiteLLM request ids (for diffing). */
export interface SpendSnapshot {
  tokenIdHash: string;
  requestIds: readonly string[];
  takenAt: string;
}

/** The bounded, evidence-safe correlation of exactly one turn's spend rows. */
export interface CorrelatedTurnSpend {
  tokenIdHash: string;
  /** New request ids since the snapshot, sorted and bounded. */
  requestIds: string[];
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  spendUsd: number;
  windowStartedAt: string;
  windowFinishedAt: string;
}

/** Outcome of subject deletion; both booleans must be true for a green cell. */
export interface ActorSubjectsDeletion {
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
}

/**
 * The deterministic actor-key alias the candidate Server mints per enrollment
 * (`server/proliferate/server/cloud/agent_gateway/enrollment.py`):
 * `vk-user-<user_id>-<enrollment_id[:8]>`. Implemented here because it is the
 * frozen cross-workstream contract and must not drift.
 */
export function deriveActorKeyAlias(userId: string, enrollmentId: string): string {
  return `vk-user-${userId}-${enrollmentId.slice(0, 8)}`;
}

/**
 * Selects the cheapest eligible model from the intersection of the
 * qualification allowlist and AnyHarness's live gateway probe, excluding any id
 * containing `EXCLUDED_MODEL_ID_SUBSTRING`. Returns null when the intersection
 * is empty (spec: "No eligible live model" → cell blocked/non-green).
 */
export function selectCheapestEligibleClaudeModel(
  allowlist: readonly string[],
  liveProbe: readonly string[],
): string | null {
  const probe = new Set(liveProbe);
  const eligible = allowlist.filter((id) => probe.has(id) && isEligibleClaudeModel(id));
  if (eligible.length === 0) {
    return null;
  }
  return orderClaudeModelsCheapestFirst(eligible)[0];
}

/** A model is eligible when it is a Claude model and NOT the excluded tier. */
function isEligibleClaudeModel(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes(CLAUDE_MODEL_ID_SUBSTRING) && !lower.includes(EXCLUDED_MODEL_ID_SUBSTRING);
}

/** Deduplicated, cheapest-first, deterministic ordering. */
function orderClaudeModelsCheapestFirst(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const rankDelta = claudeTierRank(a) - claudeTierRank(b);
    return rankDelta !== 0 ? rankDelta : a.localeCompare(b);
  });
}

function claudeTierRank(id: string): number {
  const lower = id.toLowerCase();
  for (const [keyword, rank] of CLAUDE_TIER_RANK) {
    if (lower.includes(keyword)) {
      return rank;
    }
  }
  return CLAUDE_TIER_RANK.length;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** One per-request spend row off `/spend/logs?summarize=false`; `api_key` is the
 * SHA-256 token hash (== `token_id` at mint time). Mirrors the Server's
 * `LiteLLMSpendLogEntry` (server/proliferate/integrations/litellm/models.py). */
interface SpendLogRow {
  request_id: string;
  api_key: string;
  model: string;
  spend: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime: string | null;
}

export class QualificationLiteLlmController {
  private readonly fetch: FetchLike;

  constructor(
    private readonly config: QualificationLiteLlmConfig,
    deps: QualificationLiteLlmDeps = {},
  ) {
    this.fetch = deps.fetch ?? defaultFetch;
  }

  /** The public inference URL handed to AnyHarness (never the admin URL/key). */
  get publicBaseUrl(): string {
    return this.config.publicBaseUrl;
  }

  /**
   * Verifies non-empty typed inputs, admin/control-plane reachability, and that
   * the allowlist contains a non-Fable Claude model, without echoing any
   * credential. Missing/unreachable → throw (strict preflight failure per the
   * runner failure table).
   */
  async preflight(): Promise<QualificationPreflightResult> {
    this.requireNonEmptyInputs();
    // Liveness first — an unauthenticated probe distinguishes "proxy down" from
    // "master key wrong" without echoing the credential.
    await this.adminGet("/health/liveliness", { authenticated: false }).catch(() => {
      throw new QualificationLiteLlmError("Qualification LiteLLM proxy is not reachable (liveness).");
    });
    // Authenticated admin reachability + the configured allowlist in one call.
    const allowlistModels = await this.listAdminModels();
    const eligibleClaudeModels = orderClaudeModelsCheapestFirst(
      allowlistModels.filter(isEligibleClaudeModel),
    );
    if (eligibleClaudeModels.length === 0) {
      throw new QualificationLiteLlmError(
        "Qualification allowlist contains no eligible non-Fable Claude model.",
      );
    }
    return { adminReachable: true, allowlistModels, eligibleClaudeModels };
  }

  /**
   * Resolves the actor key's `token_id` and owning user/team via the admin API
   * from the authenticated enrollment id + user id, deriving the deterministic
   * alias. Live-probing the actor key's model list happens separately, after
   * enrollment and before the turn.
   */
  async resolveActorKey(params: { userId: string; enrollmentId: string }): Promise<ActorKeyIdentity> {
    const keyAlias = deriveActorKeyAlias(params.userId, params.enrollmentId);
    const payload = await this.adminGet(
      `/key/list?key_alias=${encodeURIComponent(keyAlias)}&return_full_object=true`,
    );
    const keys = asRecord(payload).keys;
    if (!Array.isArray(keys)) {
      throw new QualificationLiteLlmError("LiteLLM returned an invalid key list for the actor alias.");
    }
    // The `/key/list` alias filter is advisory on the pinned image, so re-check
    // client-side (mirrors the Server's delete_virtual_keys_by_alias).
    const match = keys
      .map(asRecord)
      .find((key) => key.key_alias === keyAlias && typeof key.token === "string" && key.token);
    if (!match) {
      throw new QualificationLiteLlmError(
        `No LiteLLM key resolved for the actor enrollment alias "${keyAlias}".`,
      );
    }
    const tokenId = String(match.token);
    const teamId = typeof match.team_id === "string" ? match.team_id : "";
    const litellmUserId = typeof match.user_id === "string" ? match.user_id : params.userId;
    return {
      userId: params.userId,
      enrollmentId: params.enrollmentId,
      teamId,
      litellmUserId,
      keyAlias,
      tokenId,
      tokenIdHash: sha256Hex(tokenId),
    };
  }

  /** Snapshots the actor key's existing request ids before the turn. */
  async snapshotSpend(actor: ActorKeyIdentity): Promise<SpendSnapshot> {
    const takenAt = new Date().toISOString();
    const date = takenAt.slice(0, 10);
    const rows = await this.pageSpendLogs(date, date);
    const requestIds = rows
      .filter((row) => row.api_key === actor.tokenId)
      .map((row) => row.request_id);
    return { tokenIdHash: actor.tokenIdHash, requestIds: [...new Set(requestIds)].sort(), takenAt };
  }

  /**
   * Requires one or more new spend rows for `actor` within the bounded window,
   * each satisfying the key/model/window/positive-token/positive-spend
   * invariants (spec "LiteLLM correlation"). An unbounded result set, wrong
   * key, pre-existing request id, out-of-window row, wrong model, or zero
   * token/spend fails.
   */
  async correlateTurn(params: {
    actor: ActorKeyIdentity;
    before: SpendSnapshot;
    acceptedModelId: string;
    windowStartedAt: string;
    windowFinishedAt: string;
  }): Promise<CorrelatedTurnSpend> {
    const windowStart = Date.parse(params.windowStartedAt);
    const windowEnd = Date.parse(params.windowFinishedAt);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd < windowStart) {
      throw new QualificationLiteLlmError("Correlation window is invalid.");
    }
    const rows = await this.pageSpendLogs(
      params.windowStartedAt.slice(0, 10),
      params.windowFinishedAt.slice(0, 10),
    );
    const seen = new Set(params.before.requestIds);
    const uniqueByRequestId = new Map<string, SpendLogRow>();
    for (const row of rows) {
      if (row.api_key !== params.actor.tokenId) {
        continue; // wrong key — not this actor's spend.
      }
      if (seen.has(row.request_id)) {
        continue; // pre-existing request id — present before the turn.
      }
      const at = row.startTime ? Date.parse(row.startTime) : NaN;
      if (!Number.isFinite(at) || at < windowStart || at > windowEnd) {
        continue; // outside the bounded scenario window.
      }
      uniqueByRequestId.set(row.request_id, row);
    }
    const accepted = [...uniqueByRequestId.values()];
    if (accepted.length === 0) {
      throw new QualificationLiteLlmError(
        "No new in-window LiteLLM spend row correlated to the actor key.",
      );
    }
    if (accepted.length > MAX_CORRELATED_ROWS) {
      throw new QualificationLiteLlmError(
        `Correlated ${accepted.length} spend rows (> ${MAX_CORRELATED_ROWS}); result set is unbounded/ambiguous.`,
      );
    }
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let spendUsd = 0;
    for (const row of accepted) {
      if (row.model !== params.acceptedModelId) {
        throw new QualificationLiteLlmError(
          `Correlated a spend row for model "${row.model}", expected "${params.acceptedModelId}".`,
        );
      }
      if (
        !isPositiveInt(row.prompt_tokens) ||
        !isPositiveInt(row.completion_tokens) ||
        !isPositiveInt(row.total_tokens) ||
        row.prompt_tokens + row.completion_tokens !== row.total_tokens
      ) {
        throw new QualificationLiteLlmError("Correlated a spend row with non-positive/inconsistent tokens.");
      }
      if (!(row.spend > 0)) {
        throw new QualificationLiteLlmError("Correlated a spend row with non-positive spend.");
      }
      promptTokens += row.prompt_tokens;
      completionTokens += row.completion_tokens;
      totalTokens += row.total_tokens;
      spendUsd += row.spend;
    }
    return {
      tokenIdHash: params.actor.tokenIdHash,
      requestIds: accepted.map((row) => row.request_id).sort(),
      modelId: params.acceptedModelId,
      promptTokens,
      completionTokens,
      totalTokens,
      spendUsd,
      windowStartedAt: params.windowStartedAt,
      windowFinishedAt: params.windowFinishedAt,
    };
  }

  /**
   * Deletes the run-created virtual key, LiteLLM user, and LiteLLM team. Must
   * run before local database teardown so the deterministic alias stays
   * recoverable. Idempotent: a subject that is already gone counts as deleted.
   */
  async deleteActorSubjects(actor: ActorKeyIdentity): Promise<ActorSubjectsDeletion> {
    const virtualKeyDeleted = await this.idempotentDelete("/key/delete", { keys: [actor.tokenId] });
    const userDeleted = await this.idempotentDelete("/user/delete", { user_ids: [actor.litellmUserId] });
    const teamDeleted = actor.teamId
      ? await this.idempotentDelete("/team/delete", { team_ids: [actor.teamId] })
      : true;
    return {
      virtualKeyDeleted,
      litellmSubjectsDeleted: userDeleted && teamDeleted,
    };
  }

  private requireNonEmptyInputs(): void {
    for (const [name, value] of [
      ["adminBaseUrl", this.config.adminBaseUrl],
      ["publicBaseUrl", this.config.publicBaseUrl],
      ["masterKey", this.config.masterKey],
    ] as const) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new QualificationLiteLlmError(`Qualification LiteLLM config is missing "${name}".`);
      }
    }
  }

  private async listAdminModels(): Promise<string[]> {
    const payload = await this.adminGet("/v1/models");
    const data = asRecord(payload).data;
    if (!Array.isArray(data)) {
      throw new QualificationLiteLlmError("LiteLLM returned an invalid model list for admin preflight.");
    }
    return data
      .map(asRecord)
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  private async pageSpendLogs(startDate: string, endDate: string): Promise<SpendLogRow[]> {
    const payload = await this.adminGet(
      `/spend/logs?summarize=false&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
    );
    if (!Array.isArray(payload)) {
      throw new QualificationLiteLlmError("LiteLLM returned invalid spend logs.");
    }
    return payload.map(asRecord).map((row) => ({
      request_id: String(row.request_id ?? ""),
      api_key: typeof row.api_key === "string" ? row.api_key : "",
      model: typeof row.model === "string" ? row.model : "",
      spend: typeof row.spend === "number" ? row.spend : 0,
      total_tokens: typeof row.total_tokens === "number" ? row.total_tokens : 0,
      prompt_tokens: typeof row.prompt_tokens === "number" ? row.prompt_tokens : 0,
      completion_tokens: typeof row.completion_tokens === "number" ? row.completion_tokens : 0,
      startTime: typeof row.startTime === "string" ? row.startTime : typeof row.start_time === "string" ? row.start_time : null,
    }));
  }

  private async idempotentDelete(path: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await this.fetch(`${trimTrailingSlash(this.config.adminBaseUrl)}${path}`, {
      method: "POST",
      headers: this.adminHeaders(),
      body: JSON.stringify(body),
    });
    if (response.ok) {
      return true;
    }
    // A subject that no longer exists is a successful (idempotent) delete.
    if (response.status === 404) {
      return true;
    }
    const message = await response.text().catch(() => "");
    if (/not\s*found|does not exist|no.*key/i.test(message)) {
      return true;
    }
    throw new QualificationLiteLlmError(`LiteLLM ${path} failed with HTTP ${response.status}.`);
  }

  private async adminGet(
    path: string,
    options: { authenticated?: boolean } = {},
  ): Promise<unknown> {
    const authenticated = options.authenticated ?? true;
    const response = await this.fetch(`${trimTrailingSlash(this.config.adminBaseUrl)}${path}`, {
      method: "GET",
      headers: authenticated ? this.adminHeaders() : {},
    });
    if (!response.ok) {
      throw new QualificationLiteLlmError(`LiteLLM ${path} failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  private adminHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.config.masterKey}`, "content-type": "application/json" };
  }
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<HttpResponseLike>;
