import type { FetchLike, HttpResponseLike } from "../../services/qualification-litellm.js";
import type { CleanupLedgerEntry } from "../local-workspace/cleanup-ledger.js";
import type {
  ActorEnrollmentBindingV1,
  RecoveredActorEnrollmentV1,
} from "./actor-enrollment-custody.js";
import { recoveredActorEnrollment } from "./actor-enrollment-custody.js";

export interface LiteLlmReplayInputs {
  litellmBaseUrl: string;
  litellmMasterKey: string;
}

const KEY_ALIAS_PREFIX = "key-alias:";
const ABSENCE_ATTEMPTS = 3;
const KEY_PAGE_SIZE = 100;
const MAX_KEY_PAGES = 100;

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

async function pagedKeyRows(
  base: string,
  query: Record<string, string>,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
  label: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_KEY_PAGES; page += 1) {
    const params = new URLSearchParams({ ...query, return_full_object: "true", size: String(KEY_PAGE_SIZE), page: String(page) });
    const response = await fetch(`${base}/key/list?${params.toString()}`, { method: "GET", headers: requestHeaders });
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`);
    const payload = record(await response.json(), label);
    const pageRows = arrayField(payload, "keys", label).map((raw) => record(raw, `${label} key`));
    rows.push(...pageRows);
    const current = payload.current_page;
    const total = payload.total_pages;
    if (current === undefined && total === undefined) {
      if (pageRows.length >= KEY_PAGE_SIZE) {
        throw new Error(`${label} omitted pagination for a full page; refusing incomplete inventory.`);
      }
      return rows;
    }
    if (
      typeof current !== "number" ||
      typeof total !== "number" ||
      !Number.isInteger(current) ||
      !Number.isInteger(total) ||
      current !== page ||
      total > MAX_KEY_PAGES
    ) {
      throw new Error(`${label} returned malformed pagination metadata.`);
    }
    // LiteLLM represents an authoritative empty first page as
    // current_page=1,total_pages=0 (ceil(0 / page_size)). Accept only that
    // exact zero-result shape; a non-empty or later-page zero is malformed.
    if (total === 0) {
      const totalCount = payload.total_count;
      if (
        page !== 1 ||
        current !== 1 ||
        pageRows.length !== 0 ||
        (totalCount !== undefined && totalCount !== 0)
      ) {
        throw new Error(`${label} returned malformed empty pagination metadata.`);
      }
      return rows;
    }
    if (total < page) {
      throw new Error(`${label} returned malformed pagination metadata.`);
    }
    if (page >= total) return rows;
  }
  throw new Error(`${label} exceeded the bounded key-inventory page limit.`);
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
  const keys = (await pagedKeyRows(base, { key_alias: alias }, requestHeaders, fetch, "LiteLLM key inventory"))
    .filter((row) => row.key_alias === alias);
  const tokens = keys
    .map((row) => row.token)
    .filter((token): token is string => typeof token === "string" && token.length > 0);
  if (tokens.length !== keys.length) throw new Error("LiteLLM key inventory omitted an exact token id.");
  if (tokens.length > 1) throw new Error("LiteLLM returned multiple keys for one globally unique alias.");
  return tokens;
}

interface ActorKeyInventory {
  keyAlias: string;
  teamId: string;
  organizationId: string | null;
}

async function actorKeysByUser(
  base: string,
  userId: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<ActorKeyInventory[]> {
  const litellmUserId = `user-${userId}`;
  const personalPrefix = `vk-user-${userId}-`;
  const keys = await pagedKeyRows(
    base, { user_id: litellmUserId }, requestHeaders, fetch, "LiteLLM actor key inventory",
  );
  for (const row of keys) {
    const metadata = record(row.metadata, "LiteLLM actor key metadata");
    if (row.user_id !== litellmUserId || metadata.proliferate_user_id !== userId) {
      throw new Error("LiteLLM actor key inventory escaped the exact run-owned user subject.");
    }
    const organizationId = typeof metadata.proliferate_organization_id === "string"
      ? metadata.proliferate_organization_id
      : null;
    const expectedPrefix = organizationId
      ? `vk-org-${organizationId}-user-${userId}-`
      : personalPrefix;
    if (typeof row.key_alias !== "string" || !row.key_alias.startsWith(expectedPrefix)) {
      throw new Error("LiteLLM exact-user key has an unexpected alias; refusing false-green cleanup.");
    }
    if (typeof row.token !== "string" || !row.token) {
      throw new Error("LiteLLM actor key inventory omitted the exact token identity.");
    }
    if (typeof row.team_id !== "string" || !row.team_id) {
      throw new Error("LiteLLM actor key inventory omitted the exact owning team id.");
    }
  }
  const aliases = keys.map((row) => row.key_alias as string);
  if (new Set(aliases).size !== aliases.length) {
    throw new Error("LiteLLM returned duplicate rows for one globally unique personal key alias.");
  }
  return keys
    .map((row) => {
      const metadata = row.metadata as Record<string, unknown>;
      return {
        keyAlias: row.key_alias as string,
        teamId: row.team_id as string,
        organizationId: typeof metadata.proliferate_organization_id === "string"
          ? metadata.proliferate_organization_id
          : null,
      };
    })
    .sort((left, right) => left.keyAlias.localeCompare(right.keyAlias));
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface TeamKeyInventory {
  keyAlias: string;
  userId: string;
  organizationId: string | null;
}

async function teamKeys(
  base: string,
  teamId: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<TeamKeyInventory[]> {
  const rows = await pagedKeyRows(
    base, { team_id: teamId }, requestHeaders, fetch, "LiteLLM team-key inventory",
  );
  return rows.map((row) => {
    const metadata = record(row.metadata, "LiteLLM team-key metadata");
    const userId = metadata.proliferate_user_id;
    const organizationId = typeof metadata.proliferate_organization_id === "string"
      ? metadata.proliferate_organization_id
      : null;
    if (
      row.team_id !== teamId ||
      typeof userId !== "string" || !userId ||
      row.user_id !== `user-${userId}` ||
      typeof row.key_alias !== "string" || !row.key_alias ||
      typeof row.token !== "string" || !row.token
    ) {
      throw new Error("LiteLLM team-key inventory is not bound to an exact actor identity.");
    }
    return { keyAlias: row.key_alias, userId, organizationId };
  });
}

function assertSafeSharedTeamRetention(
  alias: string,
  keys: readonly TeamKeyInventory[],
  binding: ActorEnrollmentBindingV1 | RecoveredActorEnrollmentV1,
): void {
  if (keys.length === 0) {
    throw new Error("LiteLLM actor team alias remains visible without another owned actor key.");
  }
  const organizationIds = binding.state === "bound" ? [] : binding.organizationIds;
  const organizationId = alias.startsWith("org-") ? alias.slice("org-".length) : null;
  if (!organizationId || !organizationIds.includes(organizationId)) {
    throw new Error("LiteLLM personal or unknown actor team remains visible with keys after cleanup.");
  }
  for (const key of keys) {
    if (
      key.userId === binding.userId ||
      key.organizationId !== organizationId ||
      !key.keyAlias.startsWith(`vk-org-${organizationId}-user-${key.userId}-`)
    ) {
      throw new Error("LiteLLM shared organization team contains an unproven surviving actor key.");
    }
  }
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

async function teamIdsByAlias(
  base: string,
  alias: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<string[]> {
  const response = await fetch(`${base}/team/list?team_alias=${encodeURIComponent(alias)}`, {
    method: "GET",
    headers: requestHeaders,
  });
  if (!response.ok) throw new Error(`LiteLLM team inventory failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("LiteLLM team inventory returned a malformed list.");
  const matches = payload
    .map((raw) => record(raw, "LiteLLM team"))
    .filter((row) => row.team_alias === alias);
  const ids = matches.map((row) => row.team_id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length !== matches.length) throw new Error("LiteLLM team inventory omitted an exact team id.");
  // LiteLLM does not enforce team_alias uniqueness. Every exact deterministic
  // actor/org alias match is positively run-owned; retain all distinct IDs so
  // retry races cannot become permanent cleanup leaks.
  return [...new Set(ids)].sort();
}

async function teamAliasById(
  base: string,
  teamId: string,
  requestHeaders: Record<string, string>,
  fetch: FetchLike,
): Promise<string | null> {
  const response = await fetch(`${base}/team/list?team_id=${encodeURIComponent(teamId)}`, {
    method: "GET",
    headers: requestHeaders,
  });
  if (!response.ok) throw new Error(`LiteLLM team inventory failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("LiteLLM team inventory returned a malformed list.");
  const matches = payload
    .map((raw) => record(raw, "LiteLLM team"))
    .filter((row) => row.team_id === teamId);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || typeof matches[0]?.team_alias !== "string" || !matches[0].team_alias) {
    throw new Error("LiteLLM team-id inventory is ambiguous or omitted its exact alias.");
  }
  return matches[0].team_alias;
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
    if ((!alias.startsWith("vk-user-") && !alias.startsWith("vk-org-")) || alias.length > 300) {
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

/** Deletes/proves absent one exact composite actor enrollment without raw keys. */
export async function deleteActorEnrollmentSubjects(
  binding: ActorEnrollmentBindingV1 | RecoveredActorEnrollmentV1,
  inputs: LiteLlmReplayInputs,
  fetch: FetchLike,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const base = requiredValue(inputs.litellmBaseUrl, "AGENT_GATEWAY_LITELLM_BASE_URL").replace(/\/+$/, "");
  const requestHeaders = headers(requiredValue(inputs.litellmMasterKey, "AGENT_GATEWAY_LITELLM_MASTER_KEY"));
  const keyAliases = binding.state === "bound" ? [binding.keyAlias] : binding.keyAliases;
  const teamIds = binding.state === "bound" ? [binding.teamId] : binding.teamIds;
  for (const keyAlias of keyAliases) {
    await deleteLiteLlmSubject({
      entryId: "actor-key", kind: "litellm_virtual_key", phase: "acquired",
      providerId: `key-alias:${keyAlias}`, createdAt: "", updatedAt: "",
    }, inputs, fetch, sleep);
  }
  await deleteLiteLlmSubject({
    entryId: "actor-user", kind: "litellm_user", phase: "acquired",
    providerId: binding.litellmUserId, createdAt: "", updatedAt: "",
  }, inputs, fetch, sleep);
  for (const teamId of teamIds) {
    // Organization teams are shared by the run's two actors. The first actor
    // cleanup removes only its keys; the last actor removes the now-empty team.
    const remainingKeys = await teamKeys(base, teamId, requestHeaders, fetch);
    if (remainingKeys.length > 0) {
      const alias = await teamAliasById(base, teamId, requestHeaders, fetch);
      if (alias === null) {
        throw new Error("LiteLLM actor team has keys but no exact provider alias.");
      }
      assertSafeSharedTeamRetention(alias, remainingKeys, binding);
      continue;
    }
    await deleteLiteLlmSubject({
      entryId: "actor-team", kind: "litellm_team", phase: "acquired",
      providerId: teamId, createdAt: "", updatedAt: "",
    }, inputs, fetch, sleep);
  }
  const teamAliases = binding.state === "bound" ? [binding.teamAlias] : binding.teamAliases;
  for (const alias of teamAliases) {
    for (const teamId of await teamIdsByAlias(base, alias, requestHeaders, fetch)) {
      assertSafeSharedTeamRetention(
        alias,
        await teamKeys(base, teamId, requestHeaders, fetch),
        binding,
      );
    }
  }
  if ((await actorKeysByUser(base, binding.userId, requestHeaders, fetch)).length !== 0) {
    throw new Error("LiteLLM run-owned actor key remains visible after delete.");
  }
}

/**
 * Resolves the one provider team hidden by a DB-persist interruption. This is
 * called before deletion so replay can durably promote intent→bound and no
 * longer depends on the candidate box if a later provider delete fails.
 */
export async function resolveActorEnrollmentProviderBinding(
  recovered: ActorEnrollmentBindingV1 | RecoveredActorEnrollmentV1,
  inputs: LiteLlmReplayInputs,
  fetch: FetchLike,
): Promise<RecoveredActorEnrollmentV1> {
  const base = requiredValue(inputs.litellmBaseUrl, "AGENT_GATEWAY_LITELLM_BASE_URL").replace(/\/+$/, "");
  const requestHeaders = headers(requiredValue(inputs.litellmMasterKey, "AGENT_GATEWAY_LITELLM_MASTER_KEY"));
  const durableOrganizationIds = recovered.state === "bound" ? [] : recovered.organizationIds;
  const keys = await actorKeysByUser(base, recovered.userId, requestHeaders, fetch);
  const organizationIds = [
    ...new Set([...durableOrganizationIds, ...keys.flatMap((key) => key.organizationId ? [key.organizationId] : [])]),
  ].sort();
  const teamAliases = [`user-${recovered.userId}`, ...organizationIds.map((id) => `org-${id}`)];
  const aliasEntries = await Promise.all(teamAliases.map(async (alias) => ({
    alias,
    ids: await teamIdsByAlias(base, alias, requestHeaders, fetch),
  })));
  const aliasTeamIds = aliasEntries.flatMap((entry) => entry.ids);
  for (const key of keys) {
    const expectedAlias = key.organizationId ? `org-${key.organizationId}` : `user-${recovered.userId}`;
    const expectedTeamIds = aliasEntries.find((entry) => entry.alias === expectedAlias)?.ids ?? [];
    if (!expectedTeamIds.includes(key.teamId)) {
      throw new Error("LiteLLM actor key team is not proven by its deterministic run-owned team alias.");
    }
  }
  const durableKeyAliases = recovered.state === "bound" ? [recovered.keyAlias] : recovered.keyAliases;
  const durableTeamIds = recovered.state === "bound" ? [recovered.teamId] : recovered.teamIds;
  for (const teamId of durableTeamIds) {
    if (aliasTeamIds.includes(teamId)) continue;
    const observedAlias = await teamAliasById(base, teamId, requestHeaders, fetch);
    if (observedAlias !== null && !teamAliases.includes(observedAlias)) {
      throw new Error("durable LiteLLM actor team id belongs to a different provider alias.");
    }
  }
  return recoveredActorEnrollment({
    state: "intent", runId: recovered.runId, shardId: recovered.shardId, email: recovered.email,
  }, recovered.userId, {
    organizationIds,
    keyAliases: [...new Set([...durableKeyAliases, ...keys.map((key) => key.keyAlias)])].sort(),
    teamIds: [
      ...new Set([...durableTeamIds, ...aliasTeamIds]),
    ].sort(),
    teamAliases,
  });
}
