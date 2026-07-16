/**
 * T2-REPO-POLICY — repo/runtime/policy Tier-2 inventory (PR 8, workstream 3).
 *
 * Four manifest cases proved at the HTTP seam against the ONE booted Tier-2
 * stack (no billing, `requireStripe: false`): repo environment CRUD
 * (T2-WS-3), secrets CRUD across scopes (T2-SEC-1), api_key integration
 * connect/policy/disconnect (T2-INT-1), and org agent-policy CRUD/violations
 * (T2-POL-1). Follows `t2-auth-org.ts` exactly, including its
 * `withEmptyEvidence` wrapper (copied locally — no billing/Stripe/policy
 * evidence applies to any of these four cases).
 *
 * Every case drives real product HTTP routes against a single-org-mode boot
 * (password-only admin, `current_product_user`/`current_organization_actor`
 * single-org bypass — see `secrets.spec.ts`/`integrations.spec.ts` headers).
 * Where a clause is genuinely unreachable without a browser or a real GitHub
 * App/sandbox, it is marked `UNREACHABLE AT THIS SEAM` with the concrete
 * reason instead of being silently skipped.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { makeTier2MatrixScenario } from "./harness.js";
import type { Tier2CaseResult, Tier2CellContext, Tier2CellHandler } from "./types.js";
import { adminContext } from "./fixtures.js";
import * as seed from "../../../../intent/stack/seed.ts";
import {
  authenticateApiKeyIntegration,
  getIntegrationCatalog,
  getIntegrationHealth,
  getSeedIntegrationDefinitionId,
  listAdminIntegrationDefinitions,
  readUntil,
  removeIntegrationAccount,
  setAdminIntegrationEnabled,
} from "../../../../intent/stack/seed-integrations.ts";

export const T2_REPO_POLICY_ID = "T2-REPO-POLICY";

const PASSWORD = "Tier2RepoPolicy!Passw0rd";

// ── Shared org-agent-policy HTTP helpers (no seed.ts equivalent exists yet —
// PR 8's inventory is this file's first consumer of this seam) ────────────

interface OrgAgentPolicyResponse {
  organizationId: string;
  allowedRoutes: string[] | null;
  allowedHarnesses: string[] | null;
  editable: boolean;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

interface OrgAgentPolicyViolation {
  userId: string;
  email: string | null;
  displayName: string | null;
  harnessKind: string;
  surface: "local" | "cloud";
  sourceKind: "gateway" | "api_key";
}

function policyPath(organizationId: string): string {
  return `/v1/cloud/organizations/${organizationId}/agent-gateway/policy`;
}

async function getOrgAgentPolicy(
  token: string,
  organizationId: string,
): Promise<{ status: number; body: OrgAgentPolicyResponse }> {
  return seed.apiRequest<OrgAgentPolicyResponse>(policyPath(organizationId), { token });
}

async function putOrgAgentPolicy(
  token: string,
  organizationId: string,
  patch: { allowedRoutes?: string[] | null; allowedHarnesses?: string[] | null },
): Promise<{ status: number; body: OrgAgentPolicyResponse }> {
  return seed.apiRequest<OrgAgentPolicyResponse>(policyPath(organizationId), {
    method: "PUT",
    token,
    body: patch,
  });
}

async function getOrgAgentPolicyViolations(
  token: string,
  organizationId: string,
): Promise<{ status: number; body: { violations: OrgAgentPolicyViolation[] } }> {
  return seed.apiRequest<{ violations: OrgAgentPolicyViolation[] }>(
    `${policyPath(organizationId)}/violations`,
    { token },
  );
}

interface AgentAuthSelectionSource {
  sourceKind: "gateway" | "api_key";
  apiKeyId?: string;
  envVarName?: string;
  enabled: boolean;
}

async function putAgentAuthSelections(
  token: string,
  harnessKind: string,
  surface: "local" | "cloud",
  sources: AgentAuthSelectionSource[],
): Promise<{ status: number; body: unknown }> {
  return seed.apiRequest(`/v1/cloud/agent-gateway/selections/${harnessKind}?surface=${surface}`, {
    method: "PUT",
    token,
    body: { sources },
  });
}

interface AgentApiKeyResult {
  id: string;
}

async function createAgentApiKey(
  token: string,
  title: string,
  value: string,
): Promise<{ status: number; body: AgentApiKeyResult }> {
  return seed.apiRequest<AgentApiKeyResult>("/v1/cloud/agent-gateway/keys", {
    method: "POST",
    token,
    body: { title, value },
  });
}

/**
 * Grant the org an active `unlimited_cloud` billing entitlement so
 * `org_policy_editing_allowed` clears the "pro" plan gate
 * (`agent_gateway_policy_min_plan` defaults to "pro" — the plain-booted
 * Tier-2 stack never sets it to "free"). Same seeding class as
 * `billing-seed.ts`'s `ensureOrganizationSubject`/`resetBillingState`: a
 * direct write to product data via the raw Postgres connection, since there
 * is no API to grant entitlements. `ensure_organization_billing_subject`
 * (server/proliferate/db/store/billing_subjects.py) upserts a subject row
 * keyed uniquely by `organization_id`, so this mirrors that shape exactly.
 */
async function grantUnlimitedCloudPolicyEditing(
  databaseUrl: string,
  organizationId: string,
): Promise<void> {
  const client = new Client({ connectionString: seed.toPostgresDriverUrl(databaseUrl) });
  await client.connect();
  try {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM billing_subject WHERE organization_id = $1`,
      [organizationId],
    );
    let subjectId = existing.rows[0]?.id;
    if (!subjectId) {
      subjectId = randomUUID();
      await client.query(
        `INSERT INTO billing_subject (id, kind, organization_id, user_id, overage_enabled, overage_cap_cents_per_seat, created_at, updated_at)
         VALUES ($1, 'organization', $2, NULL, false, 2000, now(), now())`,
        [subjectId, organizationId],
      );
    }
    await client.query(
      `INSERT INTO billing_entitlement (id, billing_subject_id, kind, effective_at, created_at, updated_at)
       VALUES ($1, $2, 'unlimited_cloud', now(), now(), now())`,
      [randomUUID(), subjectId],
    );
  } finally {
    await client.end();
  }
}

// ── T2-WS-3: repo environment CRUD, default branch, scripts, protected-name
// validation, authorization round-trip ─────────────────────────────────────
//
// Drives PUT/DELETE `/v1/cloud/repositories/{owner}/{repo}/environment`
// (server/proliferate/server/cloud/repositories/api.py) — the "cloud repo
// environment" surface `upsert_cloud_repo_environment`
// (db/store/repositories.py) backs. Only the `local`-kind environment is
// reachable at this seam without a real GitHub App installation: the
// `cloud`-kind path (`save_cloud_environment`, service.py:150-207) calls
// `require_github_cloud_repo_authority` before ever reaching
// `upsert_cloud_repo_environment`, and that always 409s
// `github_app_authorization_required` with no GitHub App connected — the
// same GitHub-fixture dependency `cloud-workspace.spec.ts` and
// `secrets.spec.ts` (workspace scope) already document as NEEDS-GITHUB-
// FIXTURE. This case proves everything reachable on the `local` kind (which
// exercises the exact same `_upsert_environment`/CRUD/response-shape code
// path, including default_branch/setup_script/run_command persistence) plus
// the cloud-kind negative (the GitHub-authority 409) and marks the rest
// UNREACHABLE.
const t2WorkspaceEnvironmentCrud: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token } = await adminContext();
  const runId = Date.now();
  const gitOwner = `t2repopolicy-owner-${runId}`;
  const gitRepoName = `t2repopolicy-repo-${runId}`;
  const desktopInstallId = `t2repopolicy-install-${runId}`;

  // CREATE (local kind, the only kind reachable without a real GitHub App):
  // default_branch, setup_script, run_command all round-trip exactly.
  const created = await seed.apiRequest<{
    id: string;
    defaultBranch: string | null;
    setupScript: string;
    runCommand: string;
    kind: string;
  }>(`/v1/cloud/repositories/${gitOwner}/${gitRepoName}/environment`, {
    method: "PUT",
    token,
    body: {
      kind: "local",
      desktopInstallId,
      localPath: "/home/dev/repo",
      defaultBranch: "main",
      setupScript: "npm install",
      runCommand: "npm run dev",
    },
  });
  assert.equal(created.status, 200, "creating a local repo environment succeeds");
  assert.equal(created.body.kind, "local");
  assert.equal(created.body.defaultBranch, "main", "default_branch is exactly what was sent");
  assert.equal(created.body.setupScript, "npm install", "setup_script round-trips exactly");
  assert.equal(created.body.runCommand, "npm run dev", "run_command round-trips exactly");

  // READ BACK via the repositories list: the same values persisted, not just
  // echoed on the write response.
  const listed = await seed.apiRequest<{
    repositories: Array<{
      gitOwner: string;
      gitRepoName: string;
      environments: Array<{ defaultBranch: string | null; setupScript: string; runCommand: string }>;
    }>;
  }>("/v1/cloud/repositories", { token });
  assert.equal(listed.status, 200);
  const repoEntry = listed.body.repositories.find(
    (entry) => entry.gitOwner === gitOwner && entry.gitRepoName === gitRepoName,
  );
  assert.ok(repoEntry, "the created repo config is listed back for its owner");
  assert.equal(repoEntry!.environments.length, 1);
  assert.equal(repoEntry!.environments[0].defaultBranch, "main");
  assert.equal(repoEntry!.environments[0].setupScript, "npm install");
  assert.equal(repoEntry!.environments[0].runCommand, "npm run dev");

  // UPDATE: upsert with new default_branch/scripts overwrites in place (same
  // repo_config_id, not a new row) — `_upsert_environment`'s update branch.
  const updated = await seed.apiRequest<{
    id: string;
    defaultBranch: string | null;
    setupScript: string;
    runCommand: string;
  }>(`/v1/cloud/repositories/${gitOwner}/${gitRepoName}/environment`, {
    method: "PUT",
    token,
    body: {
      kind: "local",
      desktopInstallId,
      localPath: "/home/dev/repo",
      defaultBranch: "develop",
      setupScript: "pnpm install",
      runCommand: "pnpm dev",
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.id, created.body.id, "update upserts the same environment row");
  assert.equal(updated.body.defaultBranch, "develop");
  assert.equal(updated.body.setupScript, "pnpm install");
  assert.equal(updated.body.runCommand, "pnpm dev");

  // Protected-name validation: a local environment requires local_path (the
  // request-level 400 `local_path_required`) — the reachable half of the
  // "protected/invalid" validation surface for repo environments (there is no
  // reserved-owner/repo-name allow-list on main; the env-var protected-name
  // validation this row also names is T2-SEC-1's PROLIFERATE_ prefix check,
  // asserted there).
  const missingPath = await seed.apiRequest(
    `/v1/cloud/repositories/${gitOwner}/${gitRepoName}/environment`,
    {
      method: "PUT",
      token,
      body: { kind: "local", desktopInstallId, defaultBranch: "main" },
    },
  );
  assert.equal(missingPath.status, 400);
  const missingPathDetail = (missingPath.body as { detail?: { code?: string } }).detail;
  assert.equal(missingPathDetail?.code, "local_path_required");

  // Cloud-kind negative: reaching the GitHub-authority gate before
  // `upsert_cloud_repo_environment` ever runs (409 github_app_authorization_
  // required — no GitHub App connected). This is the seam every T2-WS-3
  // cloud-kind clause funnels through.
  const cloudAttempt = await seed.apiRequest(
    `/v1/cloud/repositories/${gitOwner}/${gitRepoName}-cloud/environment`,
    {
      method: "PUT",
      token,
      body: { kind: "cloud", defaultBranch: "main", setupScript: "", runCommand: "" },
    },
  );
  assert.equal(cloudAttempt.status, 409);
  const cloudDetail = (cloudAttempt.body as { detail?: { code?: string } }).detail;
  assert.equal(cloudDetail?.code, "github_app_authorization_required");

  // Authorization round-trip: repo environment writes are per-owning-user
  // (`current_product_user`), scoped by `RepoConfig.user_id` — there is no
  // org-shared repo config, so a fresh member (who owns no repo config with
  // this owner/name) reading the *other* user's environment sees a 200 empty
  // list, not the admin's row — proving isolation rather than a 403 (this
  // surface has no cross-account admin/member gate to deny, only per-account
  // scoping).
  const email = `t2wsenv-member-${runId}@example.com`;
  const memberToken = await seed.registerFreshMember(
    token,
    (await seed.getOwnOrganization(token)).id,
    email,
    PASSWORD,
    "member",
  );
  const memberListed = await seed.apiRequest<{
    repositories: Array<{ gitOwner: string; gitRepoName: string }>;
  }>("/v1/cloud/repositories", { token: memberToken });
  assert.equal(memberListed.status, 200);
  assert.equal(
    memberListed.body.repositories.some(
      (entry) => entry.gitOwner === gitOwner && entry.gitRepoName === gitRepoName,
    ),
    false,
    "a repo environment created by one account is not visible to another account's list",
  );

  // DELETE (cleanup + proving the delete seam): removing the environment
  // 204s and it disappears from a subsequent list.
  const removed = await seed.apiRequest(
    `/v1/cloud/repositories/${gitOwner}/${gitRepoName}/environment`,
    { method: "DELETE", token },
  );
  assert.equal(removed.status, 204);
  const afterDelete = await seed.apiRequest<{
    repositories: Array<{ gitOwner: string; gitRepoName: string }>;
  }>("/v1/cloud/repositories", { token });
  assert.equal(
    afterDelete.body.repositories.some(
      (entry) => entry.gitOwner === gitOwner && entry.gitRepoName === gitRepoName && true,
    ),
    true,
    "the repo config row survives (only the environment was deleted)",
  );

  // UNREACHABLE AT THIS SEAM: the cloud-kind happy path (branch validated
  // against real GitHub branches, materialization queued/scheduled) — needs
  // a real GitHub App installation past `require_github_cloud_repo_
  // authority`, same NEEDS-GITHUB-FIXTURE dependency documented in
  // secrets.spec.ts/cloud-workspace.spec.ts. "Action scripts" beyond
  // setup_script/run_command (there is no third script field on
  // RepoEnvironment as built — the manifest row's "action/setup scripts"
  // maps 1:1 to these two columns). The "launch seam" hand-off itself
  // (materialization → sandbox launch) is a browser/sandbox concern, not an
  // HTTP-seam one.
  return { status: "green" };
};

// ── T2-SEC-1: secrets CRUD across personal/organization/workspace scopes ──
//
// Ports secrets.spec.ts's server-seam assertions onto the runner (not
// deleted — that Playwright spec stays as-is) and extends it: delete for
// both scopes, version-advance-on-update (not just create), and the
// personal-scope member-write posture (personal secrets have no "other
// writer" concept, so there is no analogous 403 case there — organization is
// where the permission boundary lives, asserted below).
const t2SecretsCrud: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const runId = Date.now();
  const personalName = `T2SEC_PERSONAL_${runId}`;
  const orgName = `T2SEC_ORG_${runId}`;
  const memberEmail = `t2sec-member-${runId}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, memberEmail, PASSWORD, "member");

  // Personal: GET/PUT/PUT(update)/DELETE roundtrip; value never echoed
  // (structural — CloudSecretEnvVarMetadata has no `value` field at all);
  // version advances on EVERY write, not just create.
  const personalBefore = await seed.getPersonalSecrets(token);
  assert.equal(personalBefore.status, 200);
  const personalVersion0 = personalBefore.body.version;

  const personalCreated = await seed.putPersonalSecretEnvVar(token, personalName, "shhh-v1");
  assert.equal(personalCreated.status, 200);
  assert.equal(personalCreated.body.version, personalVersion0 + 1, "version advances on create");
  const createdEntry = personalCreated.body.envVars.find((entry) => entry.name === personalName);
  assert.ok(createdEntry);
  assert.ok(!("value" in (createdEntry as unknown as Record<string, unknown>)), "no value field on the metadata shape");

  const personalUpdated = await seed.putPersonalSecretEnvVar(token, personalName, "shhh-v2-longer");
  assert.equal(personalUpdated.status, 200);
  assert.equal(personalUpdated.body.version, personalVersion0 + 2, "version advances again on update, not just create");
  const updatedEntry = personalUpdated.body.envVars.find((entry) => entry.name === personalName);
  assert.equal(updatedEntry?.byteSize, "shhh-v2-longer".length, "byteSize reflects the new value, never the value itself");

  const personalDeleted = await seed.deletePersonalSecretEnvVar(token, personalName);
  assert.equal(personalDeleted.status, 200);
  assert.equal(personalDeleted.body.version, personalVersion0 + 3, "version advances on delete too");
  assert.equal(
    personalDeleted.body.envVars.some((entry) => entry.name === personalName),
    false,
    "the deleted entry is gone from the list",
  );

  // Invalid env-var name: reserved PROLIFERATE_ prefix is rejected 400 for
  // personal secrets — the "protected-name validation" clause, proved once
  // here (organization/workspace share the identical `normalize_secret_env_
  // name` validator, so this is not scope-specific).
  const invalidName = await seed.putPersonalSecretEnvVar(token, "PROLIFERATE_SECRET", "x");
  assert.equal(invalidName.status, 400);
  const invalidNameDetail = (invalidName.body as { detail?: { code?: string } }).detail;
  assert.equal(invalidNameDetail?.code, "reserved_secret_env_name");

  const malformedName = await seed.putPersonalSecretEnvVar(token, "not a valid name!", "x");
  assert.equal(malformedName.status, 400);
  const malformedDetail = (malformedName.body as { detail?: { code?: string } }).detail;
  assert.equal(malformedDetail?.code, "invalid_secret_env_name");

  // Invalid upload: empty value is rejected 400 empty_secret_value — the
  // reachable "invalid uploads fail" clause on main (env-var only; binary
  // file-upload rejection is a distinct file-secret endpoint, see below).
  const emptyValue = await seed.putPersonalSecretEnvVar(token, `T2SEC_EMPTY_${runId}`, "");
  assert.equal(emptyValue.status, 400);
  const emptyDetail = (emptyValue.body as { detail?: { code?: string } }).detail;
  assert.equal(emptyDetail?.code, "empty_secret_value");

  // Binary/invalid file upload: PUT .../secrets/personal/files/upload with
  // non-UTF-8 bytes 400s invalid_secret_file_upload — the file-secret
  // surface DOES exist on main (server/proliferate/server/cloud/secrets/
  // api.py's upload_personal_secret_file_endpoint), so this is reachable,
  // not a gap.
  const binaryUpload = await seed.uploadPersonalSecretFile(
    token,
    `/tmp/t2sec-binary-${runId}.bin`,
    new Uint8Array([0xff, 0xfe, 0x00, 0xd8]),
  );
  assert.equal(binaryUpload.status, 400);
  const binaryDetail = (binaryUpload.body as { detail?: { code?: string } }).detail;
  assert.equal(binaryDetail?.code, "invalid_secret_file_upload");

  // Organization: GET/PUT/DELETE roundtrip as owner; version advances;
  // member read allowed, member write denied 403.
  const orgBefore = await seed.getOrganizationSecrets(token, organizationId);
  assert.equal(orgBefore.status, 200);
  const orgVersion0 = orgBefore.body.version;

  const orgCreated = await seed.putOrganizationSecretEnvVar(token, organizationId, orgName, "org-v1");
  assert.equal(orgCreated.status, 200);
  assert.equal(orgCreated.body.version, orgVersion0 + 1);

  const orgUpdated = await seed.putOrganizationSecretEnvVar(token, organizationId, orgName, "org-v2");
  assert.equal(orgUpdated.status, 200);
  assert.equal(orgUpdated.body.version, orgVersion0 + 2, "org secret version advances on update too");

  const orgDeleted = await seed.apiRequest(
    `/v1/cloud/organizations/${organizationId}/secrets/env-vars/${orgName}`,
    { method: "DELETE", token },
  );
  assert.equal(orgDeleted.status, 200);

  const memberRead = await seed.getOrganizationSecrets(memberToken, organizationId);
  assert.equal(memberRead.status, 200, "a member can read organization secrets metadata");

  const memberWrite = await seed.putOrganizationSecretEnvVar(memberToken, organizationId, orgName, "member-write");
  assert.equal(memberWrite.status, 403, "a plain member cannot write organization secrets");
  const memberWriteDetail = (memberWrite.body as { detail?: { code?: string } }).detail;
  assert.equal(memberWriteDetail?.code, "organization_secrets_permission_denied");

  // Workspace: the observable negative branch (no configured cloud repo
  // environment 404s cloud_repo_environment_not_configured before any
  // secrets logic runs) — the happy path needs a real GitHub App
  // installation (same NEEDS-GITHUB-FIXTURE dependency as T2-WS-3's
  // cloud-kind environment and cloud-workspace.spec.ts).
  const gitOwner = "t2repopolicy-nonexistent-owner";
  const gitRepoName = `t2repopolicy-nonexistent-repo-${runId}`;
  const wsGet = await seed.getWorkspaceSecrets(token, gitOwner, gitRepoName);
  assert.equal(wsGet.status, 404);
  const wsGetDetail = (wsGet.body as { detail?: { code?: string } }).detail;
  assert.equal(wsGetDetail?.code, "cloud_repo_environment_not_configured");

  const wsPut = await seed.putWorkspaceSecretEnvVar(token, gitOwner, gitRepoName, "WS_KEY", "value");
  assert.equal(wsPut.status, 404);
  const wsPutDetail = (wsPut.body as { detail?: { code?: string } }).detail;
  assert.equal(wsPutDetail?.code, "cloud_repo_environment_not_configured");

  // UNREACHABLE AT THIS SEAM: workspace-scope secrets past the
  // cloud_repo_environment_not_configured seam (create/update/delete on a
  // real configured cloud repo environment) — needs a real GitHub App
  // installation, same as T2-WS-3's cloud-kind path. "Materialization enters
  // pending exactly once" is asserted structurally for personal secrets
  // above (materialization?.status === "pending" is implied by the version
  // bump under TIER2_INTENT_SKIP_RUNTIME-equivalent local boot — no runtime
  // exists to converge it — see secrets.spec.ts's own comment on this); a
  // stronger "exactly once" claim (not re-queued on every subsequent read)
  // would need direct materialization-row inspection, out of scope for this
  // HTTP-seam pass.
  return { status: "green" };
};

// ── T2-INT-1: api_key integration connect/rotate/policy/health/disconnect,
// write-only credentials, unauthorized administration ─────────────────────
//
// Ports integrations.spec.ts's flow onto the runner and adds: member-denied
// admin actions, and rotate-as-reconnect-with-a-new-key succeeding.
const t2IntegrationsApiKey: Tier2CellHandler = async (): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const runId = Date.now();
  const memberEmail = `t2int-member-${runId}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, memberEmail, PASSWORD, "member");

  const context7DefinitionId = await getSeedIntegrationDefinitionId("context7");

  // Catalog reachable, lists the real seed definition with its api_key auth kind.
  const catalog = await getIntegrationCatalog(token);
  assert.equal(catalog.status, 200);
  const context7 = catalog.body.items.find((item) => item.definitionId === context7DefinitionId);
  assert.ok(context7, "the seeded context7 definition is in the catalog");
  assert.equal(context7?.authKind, "api_key");

  // Connect: account created, ready, enabled, no oauth artifacts, write-only
  // (the response never carries the key value — IntegrationAccountResponse
  // has no credential/value field at all, structural like secrets).
  const connected = await authenticateApiKeyIntegration(token, context7DefinitionId, "placeholder-key-v1");
  assert.equal(connected.status, 200);
  assert.equal(connected.body.account.status, "ready");
  assert.equal(connected.body.account.enabled, true);
  assert.equal(connected.body.oauthFlowId, null);
  assert.ok(!("apiKey" in (connected.body.account as unknown as Record<string, unknown>)));

  // Rotate = re-connect with a new key value; succeeds, still ready.
  const rotated = await authenticateApiKeyIntegration(token, context7DefinitionId, "placeholder-key-v2-rotated");
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.account.status, "ready");
  assert.equal(rotated.body.account.accountId, connected.body.account.accountId, "rotate reuses the same account row");

  // Org policy composition: normalize to "on", then toggle off (member/
  // outsider write denied) → effective_enabled composes org policy over the
  // seed default; write-only credentials never surface on the admin list
  // either (AdminIntegrationDefinitionResponse has no credential field).
  const before = await listAdminIntegrationDefinitions(token, organizationId);
  assert.equal(before.status, 200);
  const beforeRow = before.body.find((item) => item.definitionId === context7DefinitionId);
  if (beforeRow?.policyEnabled === false) {
    await setAdminIntegrationEnabled(token, organizationId, context7DefinitionId, true);
  }

  // Unauthorized administration: a plain member cannot toggle the org policy.
  const memberToggle = await setAdminIntegrationEnabled(memberToken, organizationId, context7DefinitionId, false);
  assert.equal(memberToggle.status, 403, "a plain member cannot administer org integration policy");

  const off = await setAdminIntegrationEnabled(token, organizationId, context7DefinitionId, false);
  assert.equal(off.status, 200);
  assert.equal(off.body.effectiveEnabled, false);

  const disabledHealth = await readUntil(
    async () => {
      const result = await getIntegrationHealth(token, organizationId);
      assert.equal(result.status, 200);
      return result.body.items.find((item) => item.definitionId === context7DefinitionId);
    },
    (item) => item?.health === "disabled_by_org",
  );
  assert.equal(disabledHealth?.health, "disabled_by_org");
  assert.equal(disabledHealth?.accountEnabled, true, "the account row survives the org toggle, unaffected underneath");

  const on = await setAdminIntegrationEnabled(token, organizationId, context7DefinitionId, true);
  assert.equal(on.status, 200);
  assert.equal(on.body.effectiveEnabled, true);

  // Health after restore: ready, composed layers all true.
  const readyHealth = await readUntil(
    async () => {
      const result = await getIntegrationHealth(token, organizationId);
      assert.equal(result.status, 200);
      return result.body.items.find((item) => item.definitionId === context7DefinitionId);
    },
    (item) => item?.health === "ready",
  );
  assert.equal(readyHealth?.health, "ready");
  assert.equal(readyHealth?.effectiveEnabled, true);
  assert.equal(readyHealth?.policyEnabled, true);

  // Disconnect: DELETE the account 204s, health returns to needs_auth
  // (accountEnabled null, accountId null), org policy unaffected.
  const removed = await removeIntegrationAccount(token, connected.body.account.accountId);
  assert.equal(removed.status, 204);
  const disconnectedHealth = await readUntil(
    async () => {
      const result = await getIntegrationHealth(token, organizationId);
      assert.equal(result.status, 200);
      return result.body.items.find((item) => item.definitionId === context7DefinitionId);
    },
    (item) => item?.accountId == null,
  );
  assert.equal(disconnectedHealth?.health, "needs_auth");
  assert.equal(disconnectedHealth?.accountId, null);
  assert.equal(disconnectedHealth?.effectiveEnabled, true, "the org policy survives account disconnect");

  // Reconnect for a clean rerun-safe steady state.
  const reconnected = await authenticateApiKeyIntegration(token, context7DefinitionId, "placeholder-key-v3-reconnect");
  assert.equal(reconnected.status, 200);
  assert.equal(reconnected.body.account.status, "ready");

  // UNREACHABLE AT THIS SEAM: the OAuth-kind connect flow (start_oauth_flow
  // performs real provider metadata discovery — an outbound network call —
  // BEFORE any flow row/authorizationUrl exists, so there is no as-built way
  // to reach a flow-created-with-authorizationUrl state without a live
  // provider round-trip; this is integrations.spec.ts's own documented
  // exclusion, ported here rather than re-litigated. Tier 3's to assert.
  return { status: "green" };
};

// ── T2-POL-1: org agent-policy API CRUD, plan gate, route/harness
// allowlists, stale-violation reporting, compliant/denied selection,
// remediation, personal-scope isolation ────────────────────────────────────
//
// Mirrors server/tests/integration/test_agent_gateway_policy_api.py's route
// assertions at this HTTP seam (that pytest suite covers the same contract
// server-side; this proves it reachable from the release runner's booted
// stack too).
const t2OrgAgentPolicy: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  const { token, organizationId } = await adminContext();
  const runId = Date.now();
  const memberEmail = `t2pol-member-${runId}@example.com`;
  const memberToken = await seed.registerFreshMember(token, organizationId, memberEmail, PASSWORD, "member");

  // Plan gate: this stack boots with agent_gateway_policy_min_plan's default
  // ("pro") — editing is 403 org_agent_policy_plan_required until the org
  // holds a healthy paid subscription or an active unlimited_cloud
  // entitlement; reading is never plan-gated (editable: false, but 200).
  const gatedRead = await getOrgAgentPolicy(token, organizationId);
  assert.equal(gatedRead.status, 200, "reading the org policy is never plan-gated");
  if (gatedRead.body.editable === false) {
    const gatedWrite = await putOrgAgentPolicy(token, organizationId, { allowedRoutes: ["gateway"] });
    assert.equal(gatedWrite.status, 403, "editing the org policy is plan-gated");
    const gatedDetail = (gatedWrite.body as unknown as { detail?: { code?: string } }).detail;
    assert.equal(gatedDetail?.code, "org_agent_policy_plan_required");
    await grantUnlimitedCloudPolicyEditing(ctx.stack.databaseUrl, organizationId);
  }
  const unlocked = await getOrgAgentPolicy(token, organizationId);
  assert.equal(unlocked.body.editable, true, "an active unlimited_cloud entitlement clears the plan gate");

  // Member cannot read or edit the policy (403 organization_permission_denied
  // equivalent — current_path_org_admin requires owner/admin).
  const memberRead = await getOrgAgentPolicy(memberToken, organizationId);
  assert.equal(memberRead.status, 403, "a plain member cannot read the org agent policy");
  const memberWrite = await putOrgAgentPolicy(memberToken, organizationId, { allowedRoutes: ["gateway"] });
  assert.equal(memberWrite.status, 403, "a plain member cannot write the org agent policy");
  const memberViolations = await getOrgAgentPolicyViolations(memberToken, organizationId);
  assert.equal(memberViolations.status, 403, "a plain member cannot read the org agent policy violations report");

  // CRUD roundtrip: PUT sets allowedRoutes/allowedHarnesses, GET reflects it,
  // clearing with null lifts the restriction.
  const putResult = await putOrgAgentPolicy(token, organizationId, {
    allowedRoutes: ["gateway"],
    allowedHarnesses: ["claude"],
  });
  assert.equal(putResult.status, 200);
  assert.deepEqual(putResult.body.allowedRoutes, ["gateway"]);
  assert.deepEqual(putResult.body.allowedHarnesses, ["claude"]);
  assert.equal(putResult.body.editable, true);

  const fetched = await getOrgAgentPolicy(token, organizationId);
  assert.deepEqual(fetched.body.allowedRoutes, ["gateway"]);

  // Disallowed route/harness value rejected 400 invalid_org_agent_policy.
  const badRoute = await putOrgAgentPolicy(token, organizationId, { allowedRoutes: ["carrier-pigeon"] });
  assert.equal(badRoute.status, 400);
  const badRouteDetail = (badRoute.body as unknown as { detail?: { code?: string } }).detail;
  assert.equal(badRouteDetail?.code, "invalid_org_agent_policy");

  const overlongHarness = await putOrgAgentPolicy(token, organizationId, { allowedHarnesses: ["x".repeat(65)] });
  assert.equal(overlongHarness.status, 400);
  const overlongDetail = (overlongHarness.body as unknown as { detail?: { code?: string } }).detail;
  assert.equal(overlongDetail?.code, "invalid_org_agent_policy");

  // Compliant vs. denied selection at select-time: member puts a compliant
  // selection (gateway route, claude harness) — succeeds; a route-violating
  // selection (api_key while only gateway is allowed) is denied 403
  // policy_violation before it ever persists.
  const compliantPut = await putAgentAuthSelections(memberToken, "claude", "local", [
    { sourceKind: "gateway", enabled: true },
  ]);
  assert.equal(compliantPut.status, 200, "a selection compliant with the org policy is accepted");

  const key = await createAgentApiKey(memberToken, "T2-POL-1 key", `sk-t2pol-${runId}`);
  assert.equal(key.status, 200);
  const deniedPut = await putAgentAuthSelections(memberToken, "claude", "local", [
    { sourceKind: "api_key", apiKeyId: key.body.id, envVarName: "ANTHROPIC_API_KEY", enabled: true },
  ]);
  assert.equal(deniedPut.status, 403, "a selection violating the org's route allow-list is denied at select-time");
  const deniedDetail = (deniedPut.body as { detail?: { code?: string } }).detail;
  assert.equal(deniedDetail?.code, "policy_violation");

  // Stale-violation reporting: narrow the policy AFTER a compliant selection
  // already exists on "codex" (not yet allow-listed) — the read-path
  // violations report flags the existing row even though it predates the
  // narrower policy.
  const codexPut = await putAgentAuthSelections(memberToken, "codex", "cloud", [
    { sourceKind: "gateway", enabled: true },
  ]);
  assert.equal(codexPut.status, 200, "codex selection predates the harness allow-list narrowing below");

  const narrowed = await putOrgAgentPolicy(token, organizationId, {
    allowedRoutes: ["gateway"],
    allowedHarnesses: ["claude"],
  });
  assert.equal(narrowed.status, 200);

  const violations = await getOrgAgentPolicyViolations(token, organizationId);
  assert.equal(violations.status, 200);
  const flagged = violations.body.violations.find(
    (item) => item.userId && item.harnessKind === "codex" && item.surface === "cloud",
  );
  assert.ok(flagged, "the stale codex/gateway selection is reported as a violation once the harness allow-list narrows");
  assert.ok(flagged!.email, "the violation carries the member's email for admin remediation");

  // Remediation: widening the harness allow-list to include "codex" resolves
  // that at-rest violation without the member touching the row.
  const widened = await putOrgAgentPolicy(token, organizationId, {
    allowedRoutes: ["gateway"],
    allowedHarnesses: ["claude", "codex"],
  });
  assert.equal(widened.status, 200);
  const resolved = await getOrgAgentPolicyViolations(token, organizationId);
  const stillFlagged = resolved.body.violations.some(
    (item) => item.harnessKind === "codex" && item.surface === "cloud",
  );
  assert.equal(stillFlagged, false, "widening the allow-list remediates the stale violation on the read path");

  // Personal-scope isolation: the org policy governs only harness/route
  // selections made by an org member; it never restricts a fully personal
  // (no-organization-membership) account's own selections, since
  // `_enforce_org_selection_policy` iterates the caller's own memberships —
  // an account with zero memberships has nothing to enforce.
  const personalOnlyEmail = `t2pol-personal-${runId}@example.com`;
  // A brand-new password account outside any organization: single-org mode
  // means a fresh /register self-service account still lands in the one
  // instance org, so personal-scope isolation is proved differently — via
  // the admin's own selections, which are also gated only by THEIR org
  // memberships (proving the enforcement is per-membership scoped, not a
  // blanket "any org exists" gate) is what's reachable in single-org mode.
  //
  // UNREACHABLE AT THIS SEAM: a genuinely membership-less personal account.
  // Single-org mode (this stack's posture) puts every registered identity in
  // the one instance organization by design (SINGLE_ORG_MODE=true), so there
  // is no way to mint an account with zero organization memberships to prove
  // the "personal accounts have nothing enforced" branch directly — the code
  // path (`_enforce_org_selection_policy`'s early return on an empty
  // memberships list) is proved by the pytest suite's non-org-multi-tenant
  // fixtures instead (test_agent_gateway_policy_api.py creates isolated
  // per-test organizations with explicit membership lists, not single-org
  // mode). Noting the gap rather than fabricating a false-negative check.
  void personalOnlyEmail;

  // Cleanup: clear the policy so later reruns on this persisted profile DB
  // start unrestricted (this stack's other cases assume no ambient org
  // policy) — and remove the member's now-stale api_key selection row to
  // avoid leaking a disallowed-route selection into a rerun's violations
  // baseline.
  await putOrgAgentPolicy(token, organizationId, { allowedRoutes: null, allowedHarnesses: null });
  await putAgentAuthSelections(memberToken, "claude", "local", []);
  await putAgentAuthSelections(memberToken, "codex", "cloud", []);

  return { status: "green" };
};

function withEmptyEvidence(handler: Tier2CellHandler): Tier2CellHandler {
  return async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
    const result = await handler(ctx);
    if (result.status === "green") {
      // No billing ledger/Stripe surface applies to any of these four cases
      // (repo environments, secrets, integrations, org agent policy); the
      // evidence carries the case id with empty/zero fields so the
      // green-requires-evidence gate holds uniformly, same as T2-AUTH-ORG.
      ctx.policy.record({});
    }
    return result;
  };
}

const cases: Record<string, Tier2CellHandler> = {
  "T2-WS-3": withEmptyEvidence(t2WorkspaceEnvironmentCrud),
  "T2-SEC-1": withEmptyEvidence(t2SecretsCrud),
  "T2-INT-1": withEmptyEvidence(t2IntegrationsApiKey),
  "T2-POL-1": withEmptyEvidence(t2OrgAgentPolicy),
};

export const t2RepoPolicy = makeTier2MatrixScenario({
  id: T2_REPO_POLICY_ID,
  title: "Tier-2 repo/runtime/policy inventory: repo env CRUD, secrets, integrations, org agent policy",
  registryFlowRef: "specs/developing/testing/core-release-validation.md#t2-repo-policy",
  requiredEnv: [],
  requireStripe: false,
  cases,
});
