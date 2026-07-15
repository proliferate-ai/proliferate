// Management-plane LiteLLM fake (PR 4, BRIEF §5).
//
// The ONE place the target contract calls for a LiteLLM fake — and it is the
// ADMIN/control plane ONLY, never inference. It serves exactly the admin routes
// `server/proliferate/integrations/litellm/client.py` calls, so the REAL
// `run_usage_import` pages/dedups/attributes spend rows, real enrollment sync
// (`ensure_user_enrollment`/`ensure_org_enrollment`) mints real virtual keys
// against it, and the exhaustion path blocks a scoped key for real. It NEVER
// serves `/chat/completions` or `/v1/messages` — there is no fake inference
// here; any unrecognized path (which includes every inference route) 404s.
//
// Pattern mirrors tests/intent/fakes/mock-idp/server.ts (a plain node:http
// loopback server the booted server points AGENT_GATEWAY_LITELLM_BASE_URL at).
//
// Verified against client.py's documented pinned-image quirks so the fake's
// behavior matches production, not an idealized admin API:
//   - `/team/new` does NOT enforce a unique `team_alias`.
//   - `/team/list` ignores the `team_alias` query param and returns every team
//     (`ensure_team` filters client-side).
//   - `/user/new` 409s for an existing `user_id`.
//   - `/key/generate` enforces a unique `key_alias` (400, message mentions
//     "alias", among LIVE keys only — a deleted key's alias is free again).
//   - `/key/list`'s `key_alias` filter is likewise advisory; the fake returns
//     every live key and the caller (`delete_virtual_keys_by_alias`) filters
//     client-side, matching the real proxy.
//   - `/spend/logs?summarize=false` rows are filtered by the `[start_date
//     00:00:00, end_date 00:00:00]` UTC window client.py documents (inclusive
//     both ends), keyed off `startTime`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

/** One fabricated spend-log row (shape must match litellm/models.py::LiteLLMSpendLogEntry). */
export interface FakeSpendRow {
  request_id: string;
  /** Token id of the virtual key that made the request — equals the
   * `token_id` this fake returned from `/key/generate` at mint time. */
  api_key: string;
  spend: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  model?: string;
  /** ISO-8601; the importer pages by YYYY-MM-DD date bounds over this. */
  startTime?: string;
  user?: string;
  team_id?: string;
  metadata?: Record<string, unknown>;
}

/** A key this fake has minted, for test introspection (extra to the frozen
 * `LitellmManagementFake` contract — safe additive surface). */
export interface FakeMintedKey {
  tokenId: string;
  keyAlias: string | null;
  userId: string | null;
  teamId: string | null;
  maxBudget: number | null;
  blocked: boolean;
  deleted: boolean;
}

export interface LitellmManagementFake {
  baseUrl: string;
  /** Synthetic master key the booted server is given for admin auth (never a real secret). */
  masterKey: string;
  /** Seed the spend-log rows a subsequent import will page. */
  seedSpendRows(rows: FakeSpendRow[]): void;
  /** Token ids the exhaustion/limit path called /key/block on (dedup'd, insertion order). */
  blockedKeys(): string[];
  /** Every key minted so far (introspection for tests — not in client.py's surface). */
  mintedKeys(): FakeMintedKey[];
  close(): Promise<void>;
}

interface FakeTeam {
  teamId: string;
  teamAlias: string;
  maxBudget: number | null;
}

interface FakeKey {
  tokenId: string;
  key: string;
  keyAlias: string | null;
  userId: string | null;
  teamId: string | null;
  maxBudget: number | null;
  blocked: boolean;
  deleted: boolean;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: { message } });
}

/** Inclusive UTC midnight bound, matching client.py's documented LiteLLM
 * date-window semantics (`start_date`/`end_date` are `YYYY-MM-DD`, parsed at
 * midnight; `end_date` matches `startTime <= end_date 00:00:00`). */
function dateBoundMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getTime();
}

/**
 * Start the management-plane fake on an ephemeral loopback port. Fully
 * in-memory, deterministic, no outbound network calls — safe to run
 * unattended and offline.
 */
export async function startLitellmManagementFake(): Promise<LitellmManagementFake> {
  const spendRows: FakeSpendRow[] = [];
  const teams: FakeTeam[] = [];
  const users = new Set<string>();
  const keys = new Map<string, FakeKey>();
  // Insertion-ordered, deduplicated: a Set preserves first-seen order in JS.
  const blocked = new Set<string>();
  const masterKey = `sk-fake-mgmt-${randomUUID().replace(/-/g, "")}`;

  function findKey(keyOrTokenId: string): FakeKey | undefined {
    const byToken = keys.get(keyOrTokenId);
    if (byToken) {
      return byToken;
    }
    for (const candidate of keys.values()) {
      if (candidate.key === keyOrTokenId) {
        return candidate;
      }
    }
    return undefined;
  }

  function aliasIsLive(alias: string): boolean {
    for (const candidate of keys.values()) {
      if (!candidate.deleted && candidate.keyAlias === alias) {
        return true;
      }
    }
    return false;
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => sendJson(res, 500, { error: { message: "fake_internal_error" } }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    // NOTE: real admin auth uses an `Authorization: Bearer <master_key>` header;
    // the fake accepts any request (it is loopback + run-scoped, never reachable
    // outside this process), matching the mock-idp fake's posture.

    if (method === "GET" && path === "/health/liveliness") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    // Test-only introspection (not part of LiteLLM's real admin API): lets a
    // Playwright spec — which runs in a different process than the one that
    // called `startLitellmManagementFake()` — read the fake's in-memory
    // blocked/minted-key state back over the one thing every process shares,
    // the published `baseUrl`. Namespaced under `/__test/` so it can never be
    // confused with a real LiteLLM route.
    if (method === "GET" && path === "/__test/blocked-keys") {
      sendJson(res, 200, { blockedKeys: [...blocked] });
      return;
    }
    if (method === "GET" && path === "/__test/minted-keys") {
      sendJson(res, 200, {
        mintedKeys: [...keys.values()].map((k) => ({
          tokenId: k.tokenId,
          keyAlias: k.keyAlias,
          userId: k.userId,
          teamId: k.teamId,
          maxBudget: k.maxBudget,
          blocked: k.blocked,
          deleted: k.deleted,
        })),
      });
      return;
    }

    if (method === "POST" && path === "/__test/spend-rows") {
      const body = await readBody(req);
      const rows = Array.isArray(body.rows) ? (body.rows as FakeSpendRow[]) : [];
      spendRows.push(...rows);
      sendJson(res, 200, { seeded: rows.length });
      return;
    }

    if (method === "GET" && path === "/spend/logs") {
      const startDate = url.searchParams.get("start_date");
      const endDate = url.searchParams.get("end_date");
      const startMs = startDate ? dateBoundMs(startDate) : Number.NEGATIVE_INFINITY;
      const endMs = endDate ? dateBoundMs(endDate) : Number.POSITIVE_INFINITY;
      const page = spendRows.filter((row) => {
        if (!row.startTime) {
          // No timestamp to filter on: never withheld (spend must not be
          // silently dropped by the fake either).
          return true;
        }
        const t = new Date(row.startTime).getTime();
        return t >= startMs && t <= endMs;
      });
      sendJson(res, 200, page);
      return;
    }

    if (method === "POST" && path === "/team/new") {
      const body = await readBody(req);
      const teamAlias = typeof body.team_alias === "string" ? body.team_alias : "";
      const maxBudget = typeof body.max_budget === "number" ? body.max_budget : null;
      const teamId = `team-${randomUUID().slice(0, 8)}`;
      // Deliberately NOT deduped by alias — the pinned LiteLLM image allows
      // duplicate team aliases (see client.py's verified-behavior note).
      teams.push({ teamId, teamAlias, maxBudget });
      sendJson(res, 200, { team_id: teamId, team_alias: teamAlias });
      return;
    }

    if (method === "GET" && path === "/team/list") {
      // The pinned image ignores the `team_alias` query param and returns
      // every team fully hydrated; `ensure_team` filters client-side.
      sendJson(
        res,
        200,
        teams.map((t) => ({ team_id: t.teamId, team_alias: t.teamAlias, max_budget: t.maxBudget })),
      );
      return;
    }

    if (method === "POST" && path === "/team/update") {
      const body = await readBody(req);
      const teamId = typeof body.team_id === "string" ? body.team_id : null;
      const team = teamId ? teams.find((t) => t.teamId === teamId) : undefined;
      if (team) {
        team.maxBudget = typeof body.max_budget === "number" ? body.max_budget : null;
      }
      sendJson(res, 200, {});
      return;
    }

    if (method === "POST" && path === "/user/new") {
      const body = await readBody(req);
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (userId && users.has(userId)) {
        sendError(res, 409, `User ${userId} already exists.`);
        return;
      }
      users.add(userId);
      sendJson(res, 200, { user_id: userId });
      return;
    }

    if (method === "POST" && path === "/key/generate") {
      const body = await readBody(req);
      const keyAlias = typeof body.key_alias === "string" ? body.key_alias : null;
      if (keyAlias && aliasIsLive(keyAlias)) {
        sendError(res, 400, `Key alias '${keyAlias}' already in use.`);
        return;
      }
      const tokenId = `tok-${randomUUID().replace(/-/g, "")}`;
      const key = `sk-fake-${tokenId}`;
      const record: FakeKey = {
        tokenId,
        key,
        keyAlias,
        userId: typeof body.user_id === "string" ? body.user_id : null,
        teamId: typeof body.team_id === "string" ? body.team_id : null,
        maxBudget: typeof body.max_budget === "number" ? body.max_budget : null,
        blocked: false,
        deleted: false,
      };
      keys.set(tokenId, record);
      sendJson(res, 200, {
        key,
        token_id: tokenId,
        key_alias: keyAlias,
        user_id: record.userId,
        team_id: record.teamId,
        max_budget: record.maxBudget,
      });
      return;
    }

    if (method === "GET" && path === "/key/list") {
      // Advisory `key_alias` filter, mirroring `/team/list` — every LIVE key
      // is returned; `delete_virtual_keys_by_alias` re-filters client-side.
      sendJson(res, 200, {
        keys: [...keys.values()]
          .filter((k) => !k.deleted)
          .map((k) => ({ token: k.tokenId, key_alias: k.keyAlias, user_id: k.userId, team_id: k.teamId })),
      });
      return;
    }

    if (method === "POST" && path === "/key/delete") {
      const body = await readBody(req);
      const ids = Array.isArray(body.keys)
        ? (body.keys as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      for (const id of ids) {
        const found = findKey(id);
        if (found) {
          found.deleted = true;
        }
      }
      sendJson(res, 200, {});
      return;
    }

    if (method === "POST" && path === "/key/block") {
      const body = await readBody(req);
      const target = typeof body.key === "string" ? body.key : null;
      if (target) {
        const found = findKey(target);
        // Record the token id when resolvable (matches what the importer's
        // exhaustion assertions look up via the enrollment's virtual_key_id);
        // fall back to whatever value was sent so nothing is silently lost.
        blocked.add(found ? found.tokenId : target);
        if (found) {
          found.blocked = true;
        }
      }
      sendJson(res, 200, {});
      return;
    }

    if (method === "POST" && path === "/key/unblock") {
      const body = await readBody(req);
      const target = typeof body.key === "string" ? body.key : null;
      if (target) {
        const found = findKey(target);
        blocked.delete(found ? found.tokenId : target);
        if (found) {
          found.blocked = false;
        }
      }
      sendJson(res, 200, {});
      return;
    }

    if (method === "POST" && path === "/key/update") {
      const body = await readBody(req);
      const target = typeof body.key === "string" ? body.key : null;
      const found = target ? findKey(target) : undefined;
      if (found) {
        found.maxBudget = typeof body.max_budget === "number" ? body.max_budget : null;
      }
      sendJson(res, 200, {});
      return;
    }

    // Any other route (crucially, every inference route — `/chat/completions`,
    // `/v1/messages`, `/v1/completions`, ...) is not served: this fake never
    // fabricates a model response.
    sendJson(res, 404, { error: { message: "not_found" }, path });
  }

  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });

  return {
    baseUrl,
    masterKey,
    seedSpendRows: (rows) => {
      spendRows.push(...rows);
    },
    blockedKeys: () => [...blocked],
    mintedKeys: () =>
      [...keys.values()].map((k) => ({
        tokenId: k.tokenId,
        keyAlias: k.keyAlias,
        userId: k.userId,
        teamId: k.teamId,
        maxBudget: k.maxBudget,
        blocked: k.blocked,
        deleted: k.deleted,
      })),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
