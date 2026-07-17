import type { FetchLike, HttpResponseLike } from "../../services/qualification-litellm.js";
import type { CleanupLedgerEntry } from "../local-workspace/cleanup-ledger.js";

export interface LiteLlmReplayInputs {
  litellmBaseUrl: string;
  litellmMasterKey: string;
}

const KEY_ALIAS_PREFIX = "key-alias:";
const ABSENCE_ATTEMPTS = 3;

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} returned a malformed object.`);
  }
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, field: string, where: string): unknown[] {
  const rows = record(value, where)[field];
  if (!Array.isArray(rows)) throw new Error(`${where} returned no ${field} array.`);
  return rows;
}

function requiredValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required for this cleanup domain.`);
  return normalized;
}

function headers(masterKey: string): Record<string, string> {
  return { authorization: `Bearer ${masterKey}`, "content-type": "application/json" };
}

async function requireDeleteAccepted(response: HttpResponseLike, operation: string): Promise<void> {
  if (response.ok || response.status === 404) return;
  throw new Error(`${operation} failed with HTTP ${response.status}.`);
}

async function keyTokens(
  base: string,
  alias: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<string[]> {
  const listed = await fetch(`${base}/key/list?key_alias=${encodeURIComponent(alias)}&return_full_object=true`, {
    method: "GET",
    headers: requestHeaders,
  });
  if (!listed.ok) throw new Error(`LiteLLM key inventory failed with HTTP ${listed.status}.`);
  const keys = arrayField(await listed.json(), "keys", "LiteLLM key inventory")
    .map((raw) => record(raw, "LiteLLM key"))
    .filter((row) => row.key_alias === alias);
  const tokens = keys
    .map((row) => row.token)
    .filter((token): token is string => typeof token === "string" && token.length > 0);
  if (tokens.length !== keys.length) throw new Error("LiteLLM key inventory omitted an exact token id.");
  if (tokens.length > 1) throw new Error("LiteLLM returned multiple keys for one globally unique alias.");
  return tokens;
}

async function subjectAbsent(
  kind: "litellm_user" | "litellm_team",
  providerId: string,
  base: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<boolean> {
  if (kind === "litellm_user") {
    const response = await fetch(`${base}/user/info?user_id=${encodeURIComponent(providerId)}`, {
      method: "GET",
      headers: requestHeaders,
    });
    if (response.status === 404) return true;
    if (!response.ok) throw new Error(`LiteLLM user absence probe failed with HTTP ${response.status}.`);
    return false;
  }
  const response = await fetch(`${base}/team/list?team_id=${encodeURIComponent(providerId)}`, {
    method: "GET",
    headers: requestHeaders,
  });
  if (!response.ok) throw new Error(`LiteLLM team inventory failed with HTTP ${response.status}.`);
  const teams = await response.json();
  if (!Array.isArray(teams)) throw new Error("LiteLLM team inventory returned a malformed list.");
  return !teams.map((raw) => record(raw, "LiteLLM team")).some((row) => row.team_id === providerId);
}

async function requireObservedAbsent(
  probe: () => Promise<boolean>,
  label: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= ABSENCE_ATTEMPTS; attempt += 1) {
    if (await probe()) return;
    if (attempt < ABSENCE_ATTEMPTS) await sleep(500);
  }
  throw new Error(`${label} remains visible after an accepted delete.`);
}

export async function deleteLiteLlmSubject(
  entry: CleanupLedgerEntry,
  inputs: LiteLlmReplayInputs,
  fetch: FetchLike,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const kind = entry.kind;
  const providerId = entry.providerId;
  if (!providerId) throw new Error(`${kind} has no durable provider identity.`);
  const base = requiredValue(inputs.litellmBaseUrl, "AGENT_GATEWAY_LITELLM_BASE_URL").replace(/\/+$/, "");
  const requestHeaders = headers(requiredValue(inputs.litellmMasterKey, "AGENT_GATEWAY_LITELLM_MASTER_KEY"));
  if (kind === "litellm_virtual_key") {
    if (!providerId.startsWith(KEY_ALIAS_PREFIX)) {
      throw new Error("LiteLLM key cleanup identity has no exact key alias.");
    }
    const alias = providerId.slice(KEY_ALIAS_PREFIX.length);
    if (!alias.startsWith("vk-user-") || alias.length > 300) {
      throw new Error("LiteLLM key alias cleanup identity is malformed.");
    }
    const tokens = await keyTokens(base, alias, requestHeaders, fetch);
    if (tokens.length > 0) {
      await requireDeleteAccepted(await fetch(`${base}/key/delete`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ keys: tokens }),
      }), "LiteLLM key delete");
    }
    await requireObservedAbsent(
      async () => (await keyTokens(base, alias, requestHeaders, fetch)).length === 0,
      "LiteLLM virtual key",
      sleep,
    );
    return;
  }
  if (
    (kind !== "litellm_user" && kind !== "litellm_team") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/.test(providerId) ||
    providerId.startsWith("missing-")
  ) {
    throw new Error(`LiteLLM ${kind} cleanup identity is malformed.`);
  }
  const endpoint = kind === "litellm_user" ? "/user/delete" : "/team/delete";
  const body = kind === "litellm_user"
    ? { user_ids: [providerId] }
    : { team_ids: [providerId] };
  await requireDeleteAccepted(await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  }), `LiteLLM ${kind} delete`);
  await requireObservedAbsent(
    () => subjectAbsent(kind, providerId, base, requestHeaders, fetch),
    `LiteLLM ${kind}`,
    sleep,
  );
}
