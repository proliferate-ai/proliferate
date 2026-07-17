import type { FetchLike, HttpResponseLike } from "../../services/qualification-litellm.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const ABSENCE_ATTEMPTS = 3;
const RUN_KEY = "proliferate_qualification_run_id";
const SHARD_KEY = "proliferate_qualification_shard_id";
const PROVIDER_REQUEST_TIMEOUT_MS = 60_000;

interface KeyRow {
  token: string;
  userId: string;
  teamId: string;
}

interface RunInventory {
  keys: KeyRow[];
  userIds: string[];
  teamIds: string[];
}

export interface HardCancelLiteLlmResult {
  deletedKeys: number;
  deletedUsers: number;
  deletedTeams: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned a malformed object.`);
  }
  return value as Record<string, unknown>;
}

function safeIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/.test(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }
  return value;
}

function ownership(
  metadataValue: unknown,
  runId: string,
  shardId: string,
  label: string,
): "owned" | "foreign" {
  if (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue)) {
    return "foreign";
  }
  const metadata = metadataValue as Record<string, unknown>;
  const run = metadata[RUN_KEY];
  const shard = metadata[SHARD_KEY];
  if (run === undefined && shard === undefined) return "foreign";
  if (run === runId && shard === shardId) return "owned";
  throw new Error(`${label} carries partial or conflicting qualification ownership metadata.`);
}

function adminHeaders(masterKey: string): Record<string, string> {
  if (!masterKey.trim()) throw new Error("LiteLLM master key is required.");
  return { authorization: `Bearer ${masterKey}`, "content-type": "application/json" };
}

async function jsonResponse(response: HttpResponseLike, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`);
  return response.json();
}

async function listKeys(
  base: string,
  headers: Record<string, string>,
  fetch: FetchLike,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = record(await jsonResponse(await fetch(
      `${base}/key/list?return_full_object=true&size=${PAGE_SIZE}&page=${page}`,
      { method: "GET", headers },
    ), "LiteLLM key inventory"), "LiteLLM key inventory");
    if (!Array.isArray(payload.keys)) throw new Error("LiteLLM key inventory returned no keys array.");
    const pageRows = payload.keys.map((row) => record(row, "LiteLLM key inventory row"));
    rows.push(...pageRows);
    if (payload.current_page === undefined && payload.total_pages === undefined) {
      if (pageRows.length >= PAGE_SIZE) {
        throw new Error("LiteLLM key inventory omitted pagination for a full page.");
      }
      return rows;
    }
    const current = payload.current_page;
    const totalPages = payload.total_pages;
    if (
      typeof current !== "number" || !Number.isInteger(current) || current !== page ||
      typeof totalPages !== "number" || !Number.isInteger(totalPages) ||
      totalPages < 0 || totalPages > MAX_PAGES
    ) {
      throw new Error("LiteLLM key inventory returned malformed pagination metadata.");
    }
    if (totalPages === 0) {
      if (page !== 1 || pageRows.length !== 0 || (payload.total_count !== undefined && payload.total_count !== 0)) {
        throw new Error("LiteLLM key inventory returned malformed empty pagination metadata.");
      }
      return rows;
    }
    if (totalPages < page) throw new Error("LiteLLM key inventory pagination moved backwards.");
    if (page >= totalPages) return rows;
  }
  throw new Error("LiteLLM key inventory exceeded the bounded page limit.");
}

async function listUsers(
  base: string,
  headers: Record<string, string>,
  fetch: FetchLike,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = record(await jsonResponse(await fetch(
      `${base}/user/list?page=${page}&page_size=${PAGE_SIZE}`,
      { method: "GET", headers },
    ), "LiteLLM user inventory"), "LiteLLM user inventory");
    if (!Array.isArray(payload.users)) throw new Error("LiteLLM user inventory returned no users array.");
    const pageRows = payload.users.map((row) => record(row, "LiteLLM user inventory row"));
    rows.push(...pageRows);
    if (
      payload.page !== page || payload.page_size !== PAGE_SIZE ||
      typeof payload.total !== "number" || !Number.isInteger(payload.total) || payload.total < 0 ||
      typeof payload.total_pages !== "number" || !Number.isInteger(payload.total_pages) ||
      payload.total_pages < 0 || payload.total_pages > MAX_PAGES
    ) {
      throw new Error("LiteLLM user inventory returned malformed pagination metadata.");
    }
    if (payload.total_pages === 0) {
      if (page !== 1 || pageRows.length !== 0 || payload.total !== 0) {
        throw new Error("LiteLLM user inventory returned malformed empty pagination metadata.");
      }
      return rows;
    }
    if (page >= payload.total_pages) {
      if (rows.length !== payload.total) {
        throw new Error("LiteLLM user inventory did not match its authoritative total.");
      }
      return rows;
    }
  }
  throw new Error("LiteLLM user inventory exceeded the bounded page limit.");
}

async function listTeams(
  base: string,
  headers: Record<string, string>,
  fetch: FetchLike,
): Promise<Record<string, unknown>[]> {
  const payload = await jsonResponse(await fetch(`${base}/team/list`, { method: "GET", headers }), "LiteLLM team inventory");
  if (!Array.isArray(payload)) throw new Error("LiteLLM team inventory returned a malformed list.");
  return payload.map((row) => record(row, "LiteLLM team inventory row"));
}

async function inventory(
  base: string,
  headers: Record<string, string>,
  fetch: FetchLike,
  runId: string,
  shardId: string,
): Promise<RunInventory> {
  const [rawKeys, rawUsers, rawTeams] = await Promise.all([
    listKeys(base, headers, fetch),
    listUsers(base, headers, fetch),
    listTeams(base, headers, fetch),
  ]);
  const userIds = rawUsers
    .filter((row) => ownership(row.metadata, runId, shardId, "LiteLLM user") === "owned")
    .map((row) => safeIdentity(row.user_id, "LiteLLM user id"));
  const teamIds = rawTeams
    .filter((row) => ownership(row.metadata, runId, shardId, "LiteLLM team") === "owned")
    .map((row) => safeIdentity(row.team_id, "LiteLLM team id"));
  if (new Set(userIds).size !== userIds.length || new Set(teamIds).size !== teamIds.length) {
    throw new Error("LiteLLM run-owned subject inventory contains duplicate ids.");
  }
  const ownedUsers = new Set(userIds);
  const ownedTeams = new Set(teamIds);
  const keys: KeyRow[] = [];
  for (const row of rawKeys) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const teamId = typeof row.team_id === "string" ? row.team_id : "";
    const keyOwnership = ownership(row.metadata, runId, shardId, "LiteLLM key");
    if (keyOwnership === "owned") {
      if (!ownedUsers.has(userId) || !ownedTeams.has(teamId)) {
        throw new Error("LiteLLM run-owned key points at a subject without exact run ownership.");
      }
      keys.push({
        token: safeIdentity(row.token, "LiteLLM key token id"),
        userId,
        teamId,
      });
    } else if (ownedUsers.has(userId) || ownedTeams.has(teamId)) {
      throw new Error("A non-owned LiteLLM key points at an exact run-owned subject.");
    }
  }
  if (new Set(keys.map((row) => row.token)).size !== keys.length) {
    throw new Error("LiteLLM run-owned key inventory contains duplicate token ids.");
  }
  return { keys, userIds: userIds.sort(), teamIds: teamIds.sort() };
}

async function deleteMany(
  base: string,
  endpoint: string,
  body: Record<string, string[]>,
  headers: Record<string, string>,
  fetch: FetchLike,
): Promise<void> {
  const response = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`LiteLLM ${endpoint} failed with HTTP ${response.status}.`);
  }
}

/**
 * Reclaims only LiteLLM rows carrying the exact run+shard metadata pair.
 * The complete graph is validated before the first delete: aliases and random
 * product UUIDs are never accepted as ownership, and a foreign key attached to
 * an owned subject makes the cleanup red rather than deleting ambiguously.
 */
export async function cleanupQualificationLiteLlmRun(
  inputs: {
    baseUrl: string;
    masterKey: string;
    runId: string;
    shardId: string;
  },
  deps: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
): Promise<HardCancelLiteLlmResult> {
  const base = inputs.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("LiteLLM base URL is missing or malformed.");
  const runId = safeIdentity(inputs.runId, "qualification run id");
  const shardId = safeIdentity(inputs.shardId, "qualification shard id");
  const headers = adminHeaders(inputs.masterKey);
  const fetch = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const before = await inventory(base, headers, fetch, runId, shardId);
  if (before.keys.length > 0) {
    await deleteMany(base, "/key/delete", { keys: before.keys.map((row) => row.token) }, headers, fetch);
  }
  if (before.userIds.length > 0) {
    await deleteMany(base, "/user/delete", { user_ids: before.userIds }, headers, fetch);
  }
  if (before.teamIds.length > 0) {
    await deleteMany(base, "/team/delete", { team_ids: before.teamIds }, headers, fetch);
  }
  for (let attempt = 1; attempt <= ABSENCE_ATTEMPTS; attempt += 1) {
    const after = await inventory(base, headers, fetch, runId, shardId);
    if (after.keys.length === 0 && after.userIds.length === 0 && after.teamIds.length === 0) {
      return {
        deletedKeys: before.keys.length,
        deletedUsers: before.userIds.length,
        deletedTeams: before.teamIds.length,
      };
    }
    if (attempt < ABSENCE_ATTEMPTS) await sleep(500);
  }
  throw new Error("LiteLLM still reports exact run-owned resources after accepted deletes.");
}

export function hardCancelFetchInit(
  init: Parameters<FetchLike>[1],
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
): RequestInit {
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, hardCancelFetchInit(init));
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
};
