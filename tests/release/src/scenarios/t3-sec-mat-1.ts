import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import type { ScenarioDefinition, ScenarioRunContext } from "./types.js";
import { ScenarioExpectedFailError } from "./types.js";
import { withProductGate } from "../fixtures/product-gate.js";
import { ApiClient } from "../fixtures/http.js";
import { assertDurableIdentityAvailableForLane, loginDurableUserForLane } from "../fixtures/lane-identity.js";
import { ensureCloudSandboxRow, getCloudSandbox, withCloudSandboxBillingGate } from "../fixtures/cloud-sandbox.js";
import { e2bVerificationAvailable, findProviderSandbox, readProviderSandboxFile } from "../fixtures/e2b-verify.js";
import { DEFAULT_GITHUB_TEST_REPO } from "../config/env-manifest.js";
import {
  githubAppSeedAvailable,
  isGithubAppAuthorizationRequiredError,
  isGithubAppInstallationRequiredError,
  isGithubAppRefreshFailedError,
  isGithubAppRepoNotCoveredError,
  isGithubRepoAccessRequiredError,
  runGithubAppSeed,
  type SeedResult,
} from "../fixtures/github-app-seed.js";

/**
 * T3-SEC-MAT-1 — secrets materialize.
 * specs/developing/testing/scenarios.md#T3-SEC-MAT-1
 *
 * #1042: the `current_product_user` gate lifted 2026-07-09 (PR #1023); the
 * personal secret PUT already succeeded for real. This finishes the rest:
 * the org secret, the update-propagation cycle, and — the actual point of
 * the scenario — the in-sandbox file assertions (`{PROLIFERATE_HOME}/secrets/
 * global.env`, its manifest, and the sha256s) rather than only trusting the
 * materialization-status field the API reports.
 *
 * Filesystem paths below mirror
 * server/proliferate/server/cloud/materialization/paths.py exactly (kept as
 * literals here rather than re-deriving them, since this is deliberately
 * asserting the CONTRACT the server promises, the same way a real desktop
 * client or support engineer reading a sandbox would).
 *
 * In-sandbox verification uses the same E2B-direct backdoor as T3-PROV-2
 * (`../fixtures/e2b-verify.ts`) — there is no product route that lets a
 * client read an arbitrary file out of its own sandbox, and the ground truth
 * for "did the write actually happen" is the sandbox filesystem, not the
 * materialization-status field alone (that field only proves the *server*
 * believes the write succeeded).
 *
 * The workspace-file-secret + fresh-cloud-workspace half additionally needs
 * a GitHub App user authorization for the durable identity, which is the
 * SAME pre-existing, already-tracked environmental gap T3-REPO-1 hits (see
 * `t3-repo-1.ts` and issue #1043) — real on `--lane local` when the seed
 * (`RELEASE_E2E_LOCAL_DATABASE_URL` + a seed token) is available, and an
 * honestly-diagnosed `ScenarioExpectedFailError` otherwise (always on
 * `--lane staging`: the seed writes directly to a local Postgres, which has
 * no bearing on a staging session, so it is never attempted there).
 */
export const t3SecMat1: ScenarioDefinition = {
  id: "T3-SEC-MAT-1",
  title: "secrets materialize",
  registryFlowRef: "specs/developing/testing/scenarios.md#T3-SEC-MAT-1",
  lanes: ["sandbox"],
  requiredEnv: ["RELEASE_E2E_SERVER_URL"],
  plan: () => [
    { description: "log in as the durable user (lane-aware); resolve their default organization" },
    { description: "PUT a personal env-var secret and an org env-var secret" },
    { description: "poll materialization.status until ready (budget: <=60s on an already-running sandbox)" },
    {
      description:
        "[E2B-direct ground truth] assert {PROLIFERATE_HOME}/secrets/global.env contains both merged vars, " +
        "and the manifest's per-var sha256 matches the value we set",
    },
    { description: "PUT a new value; assert status returns to pending then ready; assert sandbox file updated" },
    {
      description:
        "workspace file secret + fresh cloud workspace (needs a seeded GitHub App authorization — real on " +
        "--lane local with the seed available, expected-fail with #1043's diagnosis otherwise)",
    },
  ],
  run: async (ctx) => {
    if (ctx.dryRun) {
      return;
    }
    await withProductGate("T3-SEC-MAT-1", () => withCloudSandboxBillingGate("T3-SEC-MAT-1", () => runReal(ctx)));
  },
};

const PROLIFERATE_HOME = "/home/user/.proliferate";
const GLOBAL_ENV_PATH = `${PROLIFERATE_HOME}/secrets/global.env`;
const GLOBAL_MANIFEST_PATH = `${PROLIFERATE_HOME}/secrets/global.manifest.json`;

interface SecretManifest {
  env: Record<string, string>;
  files: Record<string, string>;
  versions: Record<string, number>;
}

interface CloudSecretsResponse {
  version: number;
  materialization: { status: "pending" | "running" | "ready" | "error"; lastError: string | null } | null;
}

async function runReal(ctx: ScenarioRunContext): Promise<void> {
  assertDurableIdentityAvailableForLane("T3-SEC-MAT-1", ctx);
  const serverUrl = ctx.env.require("RELEASE_E2E_SERVER_URL");
  const session = await loginDurableUserForLane(ctx, serverUrl);
  const client = new ApiClient({ baseUrl: serverUrl }).withBearerToken(session.accessToken);

  const organizations = await client.get<{ organizations: Array<{ id: string }> }>("/v1/organizations");
  const organizationId = organizations.organizations[0]?.id;
  assert.ok(organizationId, "T3-SEC-MAT-1: the durable user must belong to at least one organization");

  // Exercise the cloud-sandbox billing gate up front, the same way T3-PROV-2
  // does, so an exhausted-credits org reports a clean, immediate
  // `ScenarioBlockedError` (via `withCloudSandboxBillingGate` in the caller)
  // instead of a secret PUT succeeding as "pending" and then a materialize
  // poll timing out with a generic assertion failure below -- the secret PUT
  // endpoint itself does not hit this gate; only sandbox
  // ensure/wake/materialize do (server/proliferate/server/billing/
  // authorization.py), so this must be checked independently first.
  const existingSandbox = await getCloudSandbox(client);
  if (existingSandbox === null) {
    await ensureCloudSandboxRow(client);
  }

  const suffix = randomUUID().slice(0, 8);
  const personalName = `T3_SEC_MAT_1_PERSONAL_${suffix}`;
  const orgName = `T3_SEC_MAT_1_ORG_${suffix}`;
  const personalValue = `personal-${suffix}`;
  const orgValue = `org-${suffix}`;

  const personalPut = await client.put<CloudSecretsResponse>(`/v1/cloud/secrets/personal/env-vars/${personalName}`, {
    value: personalValue,
  });
  assert.ok(
    personalPut.materialization && ["pending", "running", "ready"].includes(personalPut.materialization.status),
    "T3-SEC-MAT-1: PUT personal secret must return a materialization status",
  );

  const orgPut = await client.put<CloudSecretsResponse>(
    `/v1/cloud/organizations/${organizationId}/secrets/env-vars/${orgName}`,
    { value: orgValue },
  );
  assert.ok(
    orgPut.materialization && ["pending", "running", "ready"].includes(orgPut.materialization.status),
    "T3-SEC-MAT-1: PUT org secret must return a materialization status",
  );

  const readyPersonal = await pollSecretsReady(client, "/v1/cloud/secrets/personal", { timeoutMs: 60_000 });
  assert.equal(readyPersonal?.materialization?.status, "ready", "T3-SEC-MAT-1: personal secrets must reach ready");

  const sandbox = await getCloudSandbox(client);
  assert.ok(sandbox, "T3-SEC-MAT-1: the durable user must have a personal cloud sandbox after materialization");

  if (!e2bVerificationAvailable()) {
    await runWorkspaceFileSecretHalf(ctx, client, organizationId as string);
    throw new ScenarioExpectedFailError(
      "T3-SEC-MAT-1: personal + org secret PUT verified for real, and materialization.status reached " +
        "'ready' (the server's own signal that it wrote the sandbox files). The in-sandbox byte-level " +
        "assertions (global.env content, manifest sha256s) could not be verified: they require the " +
        "E2B-direct ground-truth backdoor, and RELEASE_E2E_E2B_API_KEY is absent in this run. Already wired " +
        "for CI (release-e2e.yml maps the repo secret E2B_API_KEY to it for the staging job) — a local " +
        "credential gap, not a product or scenario bug.",
    );
  }

  const found = await findProviderSandbox((sandbox as { id: string }).id);
  assert.ok(found.providerSandboxId, "T3-SEC-MAT-1: must resolve the provider sandbox via E2B metadata");
  const providerSandboxId = found.providerSandboxId as string;

  await assertGlobalEnvContains(providerSandboxId, [
    { name: personalName, value: personalValue },
    { name: orgName, value: orgValue },
  ]);

  // Update propagation: PUT a new value, assert the status cycle, assert the file updates.
  const updatedPersonalValue = `personal-updated-${suffix}`;
  const updatedPut = await client.put<CloudSecretsResponse>(`/v1/cloud/secrets/personal/env-vars/${personalName}`, {
    value: updatedPersonalValue,
  });
  assert.equal(
    updatedPut.materialization?.status,
    "pending",
    "T3-SEC-MAT-1: re-PUTting a value must report pending before the sandbox catches up",
  );
  const readyAgain = await pollSecretsReady(client, "/v1/cloud/secrets/personal", { timeoutMs: 60_000 });
  assert.equal(readyAgain?.materialization?.status, "ready", "T3-SEC-MAT-1: personal secrets must return to ready");
  await assertGlobalEnvContains(providerSandboxId, [{ name: personalName, value: updatedPersonalValue }]);

  await runWorkspaceFileSecretHalf(ctx, client, organizationId as string);
}

async function assertGlobalEnvContains(
  providerSandboxId: string,
  entries: Array<{ name: string; value: string }>,
): Promise<void> {
  const envRead = await readProviderSandboxFile(providerSandboxId, GLOBAL_ENV_PATH);
  assert.ok(envRead.content, `T3-SEC-MAT-1: ${GLOBAL_ENV_PATH} must exist and be readable (error: ${envRead.error})`);
  const content = envRead.content as string;

  const manifestRead = await readProviderSandboxFile(providerSandboxId, GLOBAL_MANIFEST_PATH);
  assert.ok(
    manifestRead.content,
    `T3-SEC-MAT-1: ${GLOBAL_MANIFEST_PATH} must exist and be readable (error: ${manifestRead.error})`,
  );
  const manifest = JSON.parse(manifestRead.content as string) as SecretManifest;

  for (const entry of entries) {
    assert.ok(content.includes(entry.name), `T3-SEC-MAT-1: global.env must contain ${entry.name}`);
    assert.ok(
      content.includes(entry.value),
      `T3-SEC-MAT-1: global.env must contain ${entry.name}'s current value`,
    );
    const expectedSha256 = createHash("sha256").update(entry.value, "utf8").digest("hex");
    assert.equal(
      manifest.env[entry.name],
      expectedSha256,
      `T3-SEC-MAT-1: manifest sha256 for ${entry.name} must match sha256(value)`,
    );
  }
}

async function pollSecretsReady(
  client: ApiClient,
  path: string,
  options: { timeoutMs: number; pollMs?: number },
): Promise<CloudSecretsResponse | undefined> {
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + options.timeoutMs;
  let last = await client.get<CloudSecretsResponse>(path);
  while (last.materialization?.status !== "ready" && Date.now() < deadline) {
    await sleep(pollMs);
    last = await client.get<CloudSecretsResponse>(path);
  }
  return last;
}

/**
 * Workspace file secret + fresh cloud workspace. Needs a seeded GitHub App
 * user authorization for the durable identity (see module docstring). Never
 * attempted on `--lane staging` — the seed writes to a local Postgres.
 */
async function runWorkspaceFileSecretHalf(
  ctx: ScenarioRunContext,
  client: ApiClient,
  organizationId: string,
): Promise<void> {
  void organizationId;
  const [owner, repo] = (process.env.RELEASE_E2E_GITHUB_TEST_REPO ?? DEFAULT_GITHUB_TEST_REPO).split("/");
  const durableEmail = process.env.RELEASE_E2E_DURABLE_USER_EMAIL;

  if (ctx.targetLane !== "local" || !githubAppSeedAvailable(process.env) || !durableEmail) {
    throw new ScenarioExpectedFailError(
      "T3-SEC-MAT-1: workspace file secret + fresh cloud workspace needs a seeded GitHub App user " +
        "authorization for the durable identity (server/proliferate/server/cloud/repositories -- the same " +
        "authority chain T3-REPO-1 depends on). The seed (tests/release/scripts/github_app_seed.py) writes " +
        "directly to a local Postgres via RELEASE_E2E_LOCAL_DATABASE_URL, so it is only ever meaningful on " +
        "--lane local, and even there needs RELEASE_E2E_DURABLE_USER_EMAIL + a seed refresh token/state " +
        "file. Same pre-existing environmental gap tracked at #1043 -- not a new bug.",
    );
  }

  let seed: SeedResult;
  try {
    seed = await runGithubAppSeed<SeedResult>(durableEmail, { command: "seed" });
  } catch (error) {
    // The seed script re-imports the local server's Settings, which requires
    // the running profile's full ambient env (JWT_SECRET, DEBUG, etc. -- see
    // specs/developing/local/feature-worktree-auth.md), not just
    // RELEASE_E2E_LOCAL_DATABASE_URL. `githubAppSeedAvailable` only checks
    // for a seed credential, not a fully-sourced profile shell, so a
    // same-class environmental failure surfaces here rather than in that
    // check -- downgrade it the same way, rather than a hard scenario red.
    throw new ScenarioExpectedFailError(
      `T3-SEC-MAT-1: the GitHub App seed script failed to run in this shell (likely missing the local ` +
        `profile's ambient env beyond RELEASE_E2E_LOCAL_DATABASE_URL -- run from a shell with the t3local ` +
        `profile's launch.env sourced): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}. ` +
        "Same pre-existing environmental gap tracked at #1043 -- not a new bug.",
    );
  }
  assert.equal(seed.seeded?.status, "ready", "T3-SEC-MAT-1: durable user's GitHub App authorization must be seeded");

  let environment: { defaultBranch: string };
  try {
    environment = await client.put<{ defaultBranch: string }>(`/v1/cloud/repositories/${owner}/${repo}/environment`, {
      kind: "cloud",
      gitProvider: "github",
      defaultBranch: "develop",
      setupScript: "",
      runCommand: "",
    });
  } catch (error) {
    if (
      isGithubAppAuthorizationRequiredError(error) ||
      isGithubAppInstallationRequiredError(error) ||
      isGithubAppRepoNotCoveredError(error) ||
      isGithubAppRefreshFailedError(error) ||
      isGithubRepoAccessRequiredError(error)
    ) {
      throw new ScenarioExpectedFailError(
        `T3-SEC-MAT-1: repo-environment PUT for ${owner}/${repo} hit the same environmental GitHub App gap ` +
          `T3-REPO-1 tracks (#1043): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
  assert.equal(environment.defaultBranch, "develop", "T3-SEC-MAT-1: repo environment default branch must round-trip");

  const secretPath = ".proliferate-secret/t3-sec-mat-1.txt";
  const secretContent = `t3-sec-mat-1-workspace-secret-${randomUUID().slice(0, 8)}`;
  await client.put(`/v1/cloud/repos/${owner}/${repo}/secrets/files`, { path: secretPath, content: secretContent });

  const branchName = `t3-sec-mat-1-${randomUUID().slice(0, 8)}`;
  const workspace = await client.post<{ id: string; status: string }>("/v1/cloud/workspaces", {
    gitProvider: "github",
    gitOwner: owner,
    gitRepoName: repo,
    baseBranch: "develop",
    branchName,
    source: "web",
  });

  try {
    const ready = await pollWorkspaceReady(client, workspace.id, { timeoutMs: 180_000 });
    assert.equal(ready?.status, "ready", "T3-SEC-MAT-1: fresh cloud workspace must reach status=ready");

    const sandbox = await getCloudSandbox(client);
    assert.ok(sandbox, "T3-SEC-MAT-1: the workspace's personal cloud sandbox must exist");
    const found = await findProviderSandbox((sandbox as { id: string }).id);
    assert.ok(found.providerSandboxId, "T3-SEC-MAT-1: must resolve the provider sandbox via E2B metadata");

    const workspaceEnvPath = `/home/user/workspace/repos/${owner}/${repo}/.proliferate/env/workspace.env`;
    const workspaceEnvRead = await readProviderSandboxFile(found.providerSandboxId as string, workspaceEnvPath);
    assert.ok(
      workspaceEnvRead.content,
      `T3-SEC-MAT-1: ${workspaceEnvPath} must exist and be readable (error: ${workspaceEnvRead.error})`,
    );
  } finally {
    await client.delete(`/v1/cloud/workspaces/${workspace.id}`).catch(() => undefined);
  }
}

async function pollWorkspaceReady(
  client: ApiClient,
  workspaceId: string,
  options: { timeoutMs: number; pollMs?: number },
): Promise<{ id: string; status: string } | undefined> {
  const pollMs = options.pollMs ?? 3000;
  const deadline = Date.now() + options.timeoutMs;
  let last = await client.get<{ id: string; status: string }>(`/v1/cloud/workspaces/${workspaceId}`);
  while (last.status !== "ready" && last.status !== "error" && Date.now() < deadline) {
    await sleep(pollMs);
    last = await client.get<{ id: string; status: string }>(`/v1/cloud/workspaces/${workspaceId}`);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
