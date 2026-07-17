import type { ActorKeyIdentity } from "../../services/qualification-litellm.js";
import type { RunIdentityV1 } from "../../runner/identity.js";
import type { BoxExec } from "./box-exec.js";

const CUSTODY_PREFIX = "actor-enrollment:v1:";
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/;

export interface ActorEnrollmentIntentV1 {
  state: "intent";
  runId: string;
  shardId: string;
  email: string;
}

export interface ActorEnrollmentBindingV1 {
  state: "bound";
  runId: string;
  shardId: string;
  email: string;
  userId: string;
  enrollmentId: string;
  keyAlias: string;
  litellmUserId: string;
  teamId: string;
  teamAlias: string;
}

export interface RecoveredActorEnrollmentV1 {
  state: "recovered";
  runId: string;
  shardId: string;
  email: string;
  userId: string;
  organizationIds: string[];
  keyAliases: string[];
  litellmUserId: string;
  teamIds: string[];
  teamAliases: string[];
}

export type ActorEnrollmentCustodyV1 =
  | ActorEnrollmentIntentV1
  | ActorEnrollmentBindingV1
  | RecoveredActorEnrollmentV1;

export type ActorEnrollmentLookup =
  | { status: "absent" }
  | { status: "user_only"; userId: string }
  | { status: "pending"; userId: string; enrollmentId: string; syncStatus: string }
  | { status: "recovered"; binding: RecoveredActorEnrollmentV1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function safeIdentity(value: unknown): value is string {
  return typeof value === "string" && SAFE_PROVIDER_ID.test(value);
}

function safeEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && /^[^@\s]+@[^@\s]+$/.test(value);
}

function assertDeterministicActorIdentity(actor: {
  userId: string;
  organizationIds: readonly string[];
  keyAliases: readonly string[];
  litellmUserId: string;
  teamAliases: readonly string[];
}): void {
  const expectedSubject = `user-${actor.userId}`;
  const expectedTeams = [expectedSubject, ...actor.organizationIds.map((id) => `org-${id}`)].sort();
  const keyPrefixes = [
    `vk-user-${actor.userId}-`,
    ...actor.organizationIds.map((id) => `vk-org-${id}-user-${actor.userId}-`),
  ];
  if (
    actor.litellmUserId !== expectedSubject ||
    actor.teamAliases.length !== expectedTeams.length ||
    [...actor.teamAliases].sort().some((alias, index) => alias !== expectedTeams[index]) ||
    actor.keyAliases.some((alias) => !keyPrefixes.some((prefix) => alias.startsWith(prefix)))
  ) {
    throw new Error("LiteLLM actor custody is outside the deterministic personal subject identity.");
  }
}

function assertRunOwned(custody: ActorEnrollmentCustodyV1, run: { runId: string; shardId: string }): void {
  if (custody.runId !== run.runId || custody.shardId !== run.shardId) {
    throw new Error("actor enrollment custody is outside the exact run/shard boundary.");
  }
  const local = custody.email.split("@", 1)[0] ?? "";
  const expectedOwner = `qual-owner-${run.runId}-${run.shardId}`;
  const expectedInvitee = `qual-actor-b-${run.runId}-${run.shardId}`;
  if (local !== expectedOwner && local !== expectedInvitee) {
    throw new Error("actor enrollment custody email is not an exact run-owned qualification actor.");
  }
}

export function encodeActorEnrollmentCustody(custody: ActorEnrollmentCustodyV1): string {
  return `${CUSTODY_PREFIX}${Buffer.from(JSON.stringify(custody), "utf8").toString("base64url")}`;
}

export function decodeActorEnrollmentCustody(
  value: string | null,
  run: { runId: string; shardId: string },
): ActorEnrollmentCustodyV1 {
  if (!value?.startsWith(CUSTODY_PREFIX)) {
    throw new Error("LiteLLM actor enrollment has no durable custody identity.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(value.slice(CUSTODY_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("LiteLLM actor enrollment custody is malformed.");
  }
  if (!isRecord(raw) || !["intent", "bound", "recovered"].includes(String(raw.state))) {
    throw new Error("LiteLLM actor enrollment custody is malformed.");
  }
  const baseKeys = ["state", "runId", "shardId", "email"] as const;
  if (
    typeof raw.runId !== "string" ||
    typeof raw.shardId !== "string" ||
    !safeEmail(raw.email)
  ) {
    throw new Error("LiteLLM actor enrollment custody is malformed.");
  }
  if (raw.state === "intent") {
    if (!exactKeys(raw, baseKeys)) throw new Error("LiteLLM actor enrollment intent has unknown fields.");
    const intent: ActorEnrollmentIntentV1 = {
      state: "intent", runId: raw.runId, shardId: raw.shardId, email: raw.email,
    };
    assertRunOwned(intent, run);
    return intent;
  }
  const recoveredKeys = [
    ...baseKeys, "userId", "organizationIds", "keyAliases", "litellmUserId", "teamIds", "teamAliases",
  ] as const;
  if (raw.state === "recovered") {
    if (
      !exactKeys(raw, recoveredKeys) ||
      !safeIdentity(raw.userId) ||
      !Array.isArray(raw.organizationIds) ||
      !raw.organizationIds.every(safeIdentity) ||
      new Set(raw.organizationIds).size !== raw.organizationIds.length ||
      !Array.isArray(raw.keyAliases) ||
      !raw.keyAliases.every(safeIdentity) ||
      new Set(raw.keyAliases).size !== raw.keyAliases.length ||
      !safeIdentity(raw.litellmUserId) ||
      !Array.isArray(raw.teamIds) ||
      !raw.teamIds.every(safeIdentity) ||
      new Set(raw.teamIds).size !== raw.teamIds.length ||
      !Array.isArray(raw.teamAliases) ||
      !raw.teamAliases.every(safeIdentity) ||
      new Set(raw.teamAliases).size !== raw.teamAliases.length
    ) {
      throw new Error("LiteLLM recovered actor enrollment is malformed.");
    }
    const recovered: RecoveredActorEnrollmentV1 = {
      state: "recovered", runId: raw.runId, shardId: raw.shardId, email: raw.email,
      userId: raw.userId, organizationIds: raw.organizationIds, keyAliases: raw.keyAliases,
      litellmUserId: raw.litellmUserId, teamIds: raw.teamIds, teamAliases: raw.teamAliases,
    };
    assertDeterministicActorIdentity(recovered);
    assertRunOwned(recovered, run);
    return recovered;
  }
  const boundKeys = [
    ...baseKeys, "userId", "enrollmentId", "keyAlias", "litellmUserId", "teamId", "teamAlias",
  ] as const;
  if (
    !exactKeys(raw, boundKeys) ||
    !safeIdentity(raw.userId) ||
    !safeIdentity(raw.enrollmentId) ||
    !safeIdentity(raw.keyAlias) ||
    !safeIdentity(raw.litellmUserId) ||
    !safeIdentity(raw.teamId) ||
    !safeIdentity(raw.teamAlias)
  ) {
    throw new Error("LiteLLM actor enrollment binding is malformed.");
  }
  const binding: ActorEnrollmentBindingV1 = {
    state: "bound", runId: raw.runId, shardId: raw.shardId, email: raw.email,
    userId: raw.userId, enrollmentId: raw.enrollmentId, keyAlias: raw.keyAlias,
    litellmUserId: raw.litellmUserId, teamId: raw.teamId, teamAlias: raw.teamAlias,
  };
  assertDeterministicActorIdentity({
    userId: binding.userId,
    organizationIds: [],
    keyAliases: [binding.keyAlias],
    litellmUserId: binding.litellmUserId,
    teamAliases: [binding.teamAlias],
  });
  assertRunOwned(binding, run);
  return binding;
}

export function bindActorEnrollment(
  intent: ActorEnrollmentIntentV1,
  actor: ActorKeyIdentity,
): ActorEnrollmentBindingV1 {
  const expectedAlias = `vk-user-${actor.userId}-${actor.enrollmentId.slice(0, 8)}`;
  const expectedUser = `user-${actor.userId}`;
  if (
    actor.keyAlias !== expectedAlias ||
    actor.litellmUserId !== expectedUser ||
    !safeIdentity(actor.teamId)
  ) {
    throw new Error("resolved LiteLLM actor subjects do not match the deterministic personal enrollment identity.");
  }
  return {
    ...intent,
    state: "bound",
    userId: actor.userId,
    enrollmentId: actor.enrollmentId,
    keyAlias: actor.keyAlias,
    litellmUserId: actor.litellmUserId,
    teamId: actor.teamId,
    teamAlias: expectedUser,
  };
}

const LOOKUP_SCRIPT = `import asyncio, json, os
from sqlalchemy import select
from proliferate.db.engine import async_session_factory
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import AgentGatewayEnrollment
from proliferate.db.models.organizations import OrganizationMembership

EMAIL = os.environ["QUAL_ACTOR_EMAIL"].lower()

async def main():
    async with async_session_factory() as db:
        users = list((await db.execute(select(User).where(User.email == EMAIL))).scalars().all())
        if not users:
            print(json.dumps({"status": "absent"}))
            return
        if len(users) != 1:
            print(json.dumps({"status": "ambiguous", "reason": "multiple users"}))
            return
        user = users[0]
        memberships = list((await db.execute(select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.id,
            OrganizationMembership.status == "active",
        ))).scalars().all())
        organization_ids = sorted(str(row.organization_id) for row in memberships)
        rows = list((await db.execute(select(AgentGatewayEnrollment).where(
            AgentGatewayEnrollment.user_id == user.id,
            AgentGatewayEnrollment.revoked_at.is_(None),
        ))).scalars().all())
        if not rows:
            print(json.dumps({"status": "user_only", "user_id": str(user.id)}))
            return
        personal = [row for row in rows if row.subject_kind == "user"]
        organization = [row for row in rows if row.subject_kind == "organization"]
        by_org = {org_id: [row for row in organization if str(row.organization_id) == org_id]
                  for org_id in organization_ids}
        if (len(personal) != 1 or any(len(found) != 1 for found in by_org.values()) or
                any(str(row.organization_id) not in organization_ids for row in organization)):
            print(json.dumps({"status": "pending", "user_id": str(user.id),
                              "enrollment_id": str(rows[0].id), "sync_status": "incomplete_actor_set"}))
            return
        if any(row.sync_status != "synced" or not row.litellm_team_id for row in rows):
            row = next(row for row in rows if row.sync_status != "synced" or not row.litellm_team_id)
            print(json.dumps({
                "status": "pending",
                "user_id": str(user.id),
                "enrollment_id": str(row.id),
                "sync_status": row.sync_status,
            }))
            return
        expected_user = f"user-{user.id}"
        if any(row.litellm_user_id != expected_user for row in rows):
            print(json.dumps({"status": "ambiguous", "reason": "unexpected LiteLLM user identity"}))
            return
        ordered = personal + [by_org[org_id][0] for org_id in organization_ids]
        key_aliases = []
        for row in ordered:
            if row.subject_kind == "user":
                key_aliases.append(f"vk-user-{user.id}-{str(row.id)[:8]}")
            else:
                key_aliases.append(f"vk-org-{row.organization_id}-user-{user.id}-{str(row.id)[:8]}")
        print(json.dumps({
            "status": "recovered",
            "user_id": str(user.id),
            "organization_ids": organization_ids,
            "key_aliases": key_aliases,
            "litellm_user_id": expected_user,
            "team_ids": sorted(set(row.litellm_team_id for row in ordered)),
            "team_aliases": [expected_user] + [f"org-{org_id}" for org_id in organization_ids],
        }))

asyncio.run(main())
`;

export async function resolveActorEnrollmentOnBox(
  box: BoxExec,
  intent: ActorEnrollmentIntentV1,
): Promise<ActorEnrollmentLookup> {
  const result = await box.serverPython(LOOKUP_SCRIPT, {
    env: { QUAL_ACTOR_EMAIL: intent.email },
    scriptName: "resolve-actor-enrollment.py",
  });
  const last = result.stdout.trim().split("\n").pop() ?? "";
  let parsed: unknown;
  try { parsed = JSON.parse(last); } catch { throw new Error("candidate actor-enrollment lookup returned malformed JSON."); }
  if (!isRecord(parsed) || typeof parsed.status !== "string") {
    throw new Error("candidate actor-enrollment lookup returned a malformed result.");
  }
  if (parsed.status === "absent") return { status: "absent" };
  if (parsed.status === "user_only" && safeIdentity(parsed.user_id)) {
    return { status: "user_only", userId: parsed.user_id };
  }
  if (
    parsed.status === "pending" &&
    safeIdentity(parsed.user_id) &&
    safeIdentity(parsed.enrollment_id) &&
    typeof parsed.sync_status === "string" &&
    parsed.sync_status.length > 0
  ) {
    return {
      status: "pending",
      userId: parsed.user_id,
      enrollmentId: parsed.enrollment_id,
      syncStatus: parsed.sync_status,
    };
  }
  if (parsed.status === "ambiguous") {
    throw new Error(`candidate actor-enrollment lookup is ambiguous (${String(parsed.reason ?? "unknown")}).`);
  }
  if (
    parsed.status !== "recovered" ||
    !safeIdentity(parsed.user_id) ||
    !Array.isArray(parsed.organization_ids) ||
    !parsed.organization_ids.every(safeIdentity) ||
    !Array.isArray(parsed.key_aliases) ||
    !parsed.key_aliases.every(safeIdentity) ||
    !safeIdentity(parsed.litellm_user_id) ||
    !Array.isArray(parsed.team_ids) ||
    !parsed.team_ids.every(safeIdentity) ||
    !Array.isArray(parsed.team_aliases) ||
    !parsed.team_aliases.every(safeIdentity)
  ) {
    throw new Error("candidate actor-enrollment lookup did not return exact synced provider identities.");
  }
  const binding = recoveredActorEnrollment(intent, parsed.user_id, {
    organizationIds: parsed.organization_ids,
    keyAliases: parsed.key_aliases,
    teamIds: parsed.team_ids,
    teamAliases: parsed.team_aliases,
  });
  if (binding.litellmUserId !== parsed.litellm_user_id) {
    throw new Error("candidate actor-enrollment lookup returned a non-deterministic LiteLLM user.");
  }
  return { status: "recovered", binding };
}

export function recoveredActorEnrollment(
  intent: ActorEnrollmentIntentV1,
  userId: string,
  provider: {
    organizationIds: string[];
    keyAliases: string[];
    teamIds: string[];
    teamAliases: string[];
  },
): RecoveredActorEnrollmentV1 {
  if (
    !safeIdentity(userId) ||
    !provider.organizationIds.every(safeIdentity) ||
    new Set(provider.organizationIds).size !== provider.organizationIds.length ||
    !provider.keyAliases.every(safeIdentity) ||
    new Set(provider.keyAliases).size !== provider.keyAliases.length ||
    !provider.teamIds.every(safeIdentity) ||
    new Set(provider.teamIds).size !== provider.teamIds.length ||
    !provider.teamAliases.every(safeIdentity) ||
    new Set(provider.teamAliases).size !== provider.teamAliases.length
  ) {
    throw new Error("recovered LiteLLM actor provider identity is malformed.");
  }
  const recovered: RecoveredActorEnrollmentV1 = {
    ...intent,
    state: "recovered",
    userId,
    organizationIds: [...provider.organizationIds].sort(),
    keyAliases: [...provider.keyAliases].sort(),
    litellmUserId: `user-${userId}`,
    teamIds: [...provider.teamIds].sort(),
    teamAliases: [...provider.teamAliases].sort(),
  };
  assertDeterministicActorIdentity(recovered);
  return recovered;
}

export function actorEnrollmentIntent(run: RunIdentityV1, email: string): ActorEnrollmentIntentV1 {
  const intent: ActorEnrollmentIntentV1 = {
    state: "intent", runId: run.run_id, shardId: run.shard_id, email,
  };
  assertRunOwned(intent, { runId: run.run_id, shardId: run.shard_id });
  return intent;
}
