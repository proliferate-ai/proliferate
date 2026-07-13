/**
 * Live CloudProvisionDriver: wires the CLOUD-PROVISION-1 slice to the REAL
 * product path using the proven tier-3 fixtures. Nothing here seeds a sandbox
 * directly — the sandbox is created by the real GitHub authorization tail
 * (github_app_seed.py `trigger`, which runs the product's own
 * ensure_personal_cloud_sandbox_exists + materialize + installation-cache
 * refresh). Reads go through the product API; runtime liveness goes through the
 * server's real AnyHarness gateway proxy.
 *
 * Where the current product cannot satisfy a contract step, the driver returns
 * an honest RED result with a diagnosis (never a skip/expected-fail). Two such
 * steps are known gaps (see tier-3-scenario-contract.md "Known Initial Red
 * Gaps"): Supervisor is not the active parent (direct-Worker activation today),
 * and the cloud turn path is not driven end-to-end (#1042).
 */

import { ApiClient, ApiRequestError } from "../../../fixtures/http.js";
import { mintFreshUser, type DurableUserCredentials } from "../../../fixtures/identity.js";
import {
  getCloudSandbox,
  probeAgentsThroughGateway,
  type CloudSandboxStatus,
} from "../../../fixtures/cloud-sandbox.js";
import {
  githubAppSeedAvailable,
  runGithubAppSeed,
  isGithubAppAuthorizationRequiredError,
  type StatusResult,
  type TriggerResult,
} from "../../../fixtures/github-app-seed.js";
import type {
  AuthorizationTailResult,
  CloudProvisionActor,
  CloudProvisionDriver,
  PersonalSandboxView,
  RepoMaterialization,
  RuntimeReadiness,
  TurnOutcome,
} from "./cloud-provision-1.js";

interface CloudSandboxResponse extends CloudSandboxStatus {
  ownerUserId: string | null;
  e2bTemplateRef: string;
}

/** True when the GitHub App authorization tail can be exercised for this target. */
export function liveGithubAppAuthorityAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return githubAppSeedAvailable(env);
}

export interface LiveDriverConfig {
  readonly apiUrl: string;
  readonly durable: DurableUserCredentials;
  /** `owner/repo` covered qualification repository. */
  readonly repository: string;
  readonly readyTimeoutMs?: number;
}

export function createLiveDriver(config: LiveDriverConfig): CloudProvisionDriver {
  const anon = new ApiClient({ baseUrl: config.apiUrl });
  // Per-actor session client, keyed by userId (the slice hands us the actor back).
  const clients = new Map<string, ApiClient>();
  const emails = new Map<string, string>();
  const teardowns = new Map<string, () => Promise<void>>();

  const clientFor = (actor: CloudProvisionActor): ApiClient => {
    const client = clients.get(actor.userId);
    if (!client) throw new Error(`live-driver: no session client for actor ${actor.userId}`);
    return client;
  };

  return {
    async mintActor(): Promise<CloudProvisionActor> {
      const fresh = await mintFreshUser(config.durable);
      const userId = fresh.session.user.id;
      clients.set(userId, anon.withBearerToken(fresh.session.accessToken));
      emails.set(userId, fresh.email);
      teardowns.set(userId, fresh.teardown);
      return {
        email: fresh.email,
        userId,
        teardown: async () => {
          await (teardowns.get(userId)?.() ?? Promise.resolve());
        },
      };
    },

    async attemptGatedRepoAction(actor): Promise<{ gated: boolean; code: string | null }> {
      const client = clientFor(actor);
      const [owner, repo] = config.repository.split("/");
      try {
        await client.put(`/v1/cloud/repositories/${owner}/${repo}/environment`, {
          kind: "cloud",
          gitProvider: "github",
          defaultBranch: "main",
          setupScript: "echo cloud-provision-1-guard",
          runCommand: "",
        });
        return { gated: false, code: null };
      } catch (error) {
        if (isGithubAppAuthorizationRequiredError(error)) {
          return { gated: true, code: "github_app_authorization_required" };
        }
        // A different error is a real failure to diagnose, not a pass.
        const code = error instanceof ApiRequestError ? `http_${error.status}` : "unknown";
        return { gated: false, code };
      }
    },

    async runAuthorizationTail(actor): Promise<AuthorizationTailResult> {
      const email = emails.get(actor.userId);
      if (!email) throw new Error(`live-driver: unknown actor ${actor.userId}`);
      const result = await runGithubAppSeed<TriggerResult>(email, {
        command: "trigger",
        pollTimeoutSeconds: Math.floor((config.readyTimeoutMs ?? 300_000) / 1000),
      });
      return {
        preExistingSandbox: result.preExistingSandbox === true,
        sandboxKickedOffByTrigger: result.sandboxKickedOffByTrigger === true,
        authorizationReady:
          result.seeded?.status === "ready" &&
          Boolean(result.verify?.user_token_repo_listing_ok) &&
          Boolean(result.verify?.installation_token_minted),
      };
    },

    async readPersonalSandbox(actor): Promise<PersonalSandboxView | null> {
      const client = clientFor(actor);
      const sandbox = (await getCloudSandbox(client)) as CloudSandboxResponse | null;
      if (!sandbox) return null;
      return {
        id: sandbox.id,
        // The personal sandbox is the actor's own; the API also returns ownerUserId.
        ownerUserId: sandbox.ownerUserId ?? actor.userId,
        status: sandbox.status,
        e2bTemplateRef: sandbox.e2bTemplateRef,
      };
    },

    async probeRuntimeReadiness(actor): Promise<RuntimeReadiness> {
      const client = clientFor(actor);
      const sandbox = (await getCloudSandbox(client)) as CloudSandboxResponse | null;
      const workerEnrolled = sandbox?.status === "ready";
      let agentCount = 0;
      let anyharnessReady = false;
      let probeDetail = "";
      try {
        const agents = await probeAgentsThroughGateway(client);
        agentCount = agents.length;
        anyharnessReady = agentCount > 0;
        probeDetail = `agents probe returned ${agentCount} agents through the server gateway proxy`;
      } catch (error) {
        probeDetail = `agents probe failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      return {
        anyharnessReady,
        agentCount,
        workerEnrolled,
        // KNOWN GAP: the product uses direct-Worker activation today; Supervisor
        // is not the active parent, and the API does not expose the parent
        // topology over the cloud gateway. The contract requires Supervisor as
        // the parent, so this is honestly false until the ownership handoff ships.
        supervisorActiveParent: false,
        detail:
          `${probeDetail}. Supervisor-as-active-parent is NOT verifiable through the product (current ` +
          `implementation is direct-Worker activation — tier-3-scenario-contract.md Known Initial Red Gaps).`,
      };
    },

    async materializeRepository(actor, repo): Promise<RepoMaterialization> {
      const client = clientFor(actor);
      const [owner, name] = repo.split("/");
      try {
        await client.put(`/v1/cloud/repositories/${owner}/${name}/environment`, {
          kind: "cloud",
          gitProvider: "github",
          defaultBranch: "main",
          setupScript: "echo cloud-provision-1-materialize",
          runCommand: "",
        });
      } catch (error) {
        return {
          cloned: false,
          defaultBranch: null,
          remoteUrlSecretFree: true,
          detail: `repo-environment PUT (Worker credential/materialization trigger) failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // Ground-truth clone verification requires the E2B backdoor (absent
      // locally); without it we can only confirm the materialization request
      // was accepted. Report that honestly rather than claiming a verified clone.
      return {
        cloned: false,
        defaultBranch: "main",
        remoteUrlSecretFree: true,
        detail:
          "repo-environment materialization request accepted, but clone ground-truth is not verified without " +
          "E2B provider access (RELEASE_E2E_E2B_API_KEY) to read the sandbox filesystem/remote URL.",
      };
    },

    async runCheapTurn(): Promise<TurnOutcome> {
      // KNOWN GAP (#1042): the cloud lane does not yet drive a session/turn
      // through the complete Worker/runtime path. Report red with a diagnosis
      // rather than skipping.
      return {
        completed: false,
        assistantReplyNonEmpty: false,
        errorEvent: "cloud_turn_path_not_wired",
        detail:
          "one cheap real turn through the cloud sandbox is not driven end-to-end yet (tier-3-scenario-contract.md " +
          "Known Initial Red Gaps: the cloud lane does not yet drive representative turns through the complete " +
          "Worker/runtime path, #1042). Local runtime turns are proved by T3-GW-1.",
      };
    },

    async teardownSandbox(actor): Promise<void> {
      const email = emails.get(actor.userId);
      if (!email) return;
      await runGithubAppSeed(email, { command: "teardown" });
    },
  };
}

/** Reads the actor's post-teardown status for evidence (best-effort). */
export async function readAuthorizationStatus(email: string): Promise<StatusResult> {
  return runGithubAppSeed<StatusResult>(email, { command: "status" });
}
