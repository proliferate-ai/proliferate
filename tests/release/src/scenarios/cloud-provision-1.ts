import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  ScenarioCellOutcome,
  ScenarioCellSpec,
  ScenarioDefinition,
  ScenarioPlanStep,
  ScenarioRunContext,
} from "./types.js";
import { ScenarioBlockedError } from "./types.js";
import type { CandidateBuildMapV1 } from "../artifacts/build-map.js";
import type { CellEvidenceV1, CloudProvisionTurnEvidenceV1 } from "../evidence/schema.js";
import { authenticatedActor, type AuthenticatedActor } from "../fixtures/authenticated-actor.js";
import { invitedActor } from "../fixtures/invited-actor.js";
import { coreFunding, defaultCoreFundingTransport, type CoreFundingResult } from "../fixtures/core-funding.js";
import {
  execInProviderSandbox,
  type E2BExecResult,
  findProviderSandbox,
  getProviderSandboxState,
  killProviderSandbox,
} from "../fixtures/e2b-verify.js";
import { githubAuthorization, type GithubAuthorizationBoundary } from "../fixtures/github-authorization.js";
import { productPage, resolveDiagnosticsDir, type ProductPage } from "../fixtures/product-page.js";
import { scrubSecretText } from "../fixtures/redact-diagnostics.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import {
  DEFAULT_BOT_SEED_SSM_PARAMETER,
  getBotRefreshTokenFromSsm,
  parseLastJsonLine,
  persistRotatedBotSeedDurable,
  seedGithubAuthorizationOnBox,
  seedUnlimitedCloudEntitlementOnBox,
  type BotSeedSource,
} from "../worlds/managed-cloud/box-seeds.js";
import type { RunIdentityV1 } from "../runner/identity.js";
import type { PlannedCellV1 } from "../runner/result.js";
import {
  selectCheapestEligibleClaudeModel,
  type CorrelatedTurnSpend,
  type QualificationLiteLlmConfig,
  type SpendSnapshot,
} from "../services/qualification-litellm.js";
import type { Ec2ProvisionConfig } from "../worlds/managed-cloud/ec2.js";
import { MANAGED_CLOUD_TEMPLATE_DESTINATIONS } from "../worlds/managed-cloud/template.js";
import {
  constructManagedCloudWorld,
  type ManagedCloudWorld,
  type ConstructManagedCloudWorldOptions,
} from "../worlds/managed-cloud/world.js";
import type { ReadyLocalWorld } from "../worlds/local-workspace/world.js";
import { sharedTemplateCustodyPath } from "../worlds/managed-cloud/shared-template-custody.js";

/**
 * CLOUD-PROVISION-1 (spec "The single scenario"). A fresh, prepared,
 * Core-funded actor travels through real product GitHub authorization into
 * exactly one E2B sandbox built from an immutable candidate template, opens its
 * covered repository, and completes one cheap managed-gateway turn — with
 * provider reconciliation, bounded evidence, and strict cleanup. One matrix
 * cell on the `sandbox` runtime lane, dimension `harness=claude`, giving the
 * canonical id `CLOUD-PROVISION-1/sandbox/harness=claude`. (The CLI `--lane`
 * TargetLane is `cloud` — the run-scoped candidate API; the RuntimeLane is
 * `sandbox` — the E2B workspace.)
 *
 * The ten ordered steps (spec):
 *   1. fresh owner actor; Core funding applied; gateway enrollment `synced`;
 *   2. real product GitHub authorization start → controller completes only the
 *      human boundary → production completion tail runs;
 *   3. concurrent/replayed completion converges: exactly one logical sandbox row
 *      and one provider sandbox, no orphan provider sandbox;
 *   4. sandbox uses the exact immutable template (provider-verified ids);
 *      direct E2B state `running`; a genuine running interval + provider timing
 *      source recorded (no claim of complete compute billing);
 *   5. exactly one Worker enrolls; heartbeat recent; Supervisor is the actual
 *      parent process; Worker/Supervisor/AnyHarness versions+hashes match the
 *      candidate receipts;
 *   6. authenticated AnyHarness health + non-empty live catalog;
 *   7. covered repository materializes at the pinned commit with no credential
 *      in its remote URL;
 *   8. one cheap managed-gateway turn (cheapest eligible live-probed non-premium
 *      Claude model) through the product UI; LiteLLM-correlated;
 *   9. Actor B cannot discover or access actor A's sandbox/runtime/workspace/
 *      session; the direct runtime rejects missing + actor-B credentials;
 *  10. cleanup reconciles every run-created resource; the green outcome carries
 *      a complete `CloudProvisionTurnEvidenceV1`.
 *
 * Structured, like LOCAL-WORLD-SMOKE-1, around a `CloudProvision1Driver` seam so
 * unit tests fake the world/fixtures/browser/provider entirely (offline).
 */

export const CLOUD_PROVISION_1_ID = "CLOUD-PROVISION-1";
export const REPRESENTATIVE_HARNESS = "claude";
export const DETERMINISTIC_PROMPT = "Reply with exactly the word: pong";
/** The fixture GitHub identity the staging App authorization must belong to. */
export const EXPECTED_BOT_LOGIN = "proliferate-e2e-bot";
/** The covered repository the staging App is installed on (spec "Fixtures"). */
export const COVERED_REPO_OWNER = "proliferate-e2e";
export const COVERED_REPO_NAME = "e2e-fixture";
/**
 * The covered repo's real default branch, stored on the seeded cloud
 * repo_environment exactly as the product's save_cloud_environment flow does
 * (it validates against GitHub then persists). The home target picker's ONLY
 * base-branch source for a cloud-only repository — without it the composer
 * send stays disabled at "Choose a base branch".
 */
export const COVERED_REPO_DEFAULT_BRANCH = "main";
/**
 * The rich home composer intentionally carries both hooks. A workspace editor
 * must therefore exclude the home hook; checking the generic chat hook alone
 * misclassifies the home screen as an already-open workspace.
 */
export const HOME_COMPOSER_EDITOR_SELECTOR = "[data-home-composer-editor]";
export const WORKSPACE_COMPOSER_EDITOR_SELECTOR =
  "[data-chat-composer-editor]:not([data-home-composer-editor])";

/**
 * Where the product materializes cloud repo checkouts:
 * `SANDBOX_REPOS_ROOT = /home/user/workspace/repos`
 * (server materialization/paths.py). The covered repo lands at
 * `<root>/<owner>/<repo>`.
 */
export const COVERED_REPO_CHECKOUT_ROOT = "/home/user/workspace/repos";
const CLOUD_PROVISION_WORLD_SUBDIR = "cloud-provision-1";
const CLOUD_SUBDOMAIN_SIDECAR = "cloud-world-subdomain.json";
/** Default local seed-file path for the D2 bot refresh token (names only in docs). */
const DEFAULT_BOT_SEED_PATH = path.join(
  homedir(),
  ".proliferate-local",
  "dev",
  "qualification-github-bot-seed.json",
);

/** Bounded waits for the live sandbox-provisioning + gateway-turn flow. */
const AUTHORIZATION_TAIL_TIMEOUT_MS = 120_000;
const SANDBOX_READY_TIMEOUT_MS = 300_000;
const TURN_TIMEOUT_MS = 300_000;

/**
 * Bounded wait for the composer model picker to surface the gateway model. The
 * cloud in-workspace composer's model list is the cloud v2 agent catalog MERGED
 * with the sandbox's own `GET /v1/agents/launch-options`
 * (`useWorkspaceAgentLaunchOptionsQuery` → `use-chat-launch-catalog.ts`), and
 * the desktop fetches that launch-options menu ONCE per workspace open with no
 * refetch interval (plain `useQuery`, no `refetchInterval`). If the workspace
 * opened before the gateway route finished materializing / the runtime finished
 * reporting the harness launch-ready, the cached menu is stale — so a bounded
 * retry that PERIODICALLY reloads (forcing a fresh fetch each cycle) is
 * required, exactly like `local-world-smoke-1`'s reload-after-sync. Generous
 * (and longer than the sandbox-side launch-options poll) because the browser's
 * cloud catalog+launch-options MERGE can lag the sandbox reporting the harness
 * launchable by a few reconnect+refetch cycles.
 */
const MODEL_PICKER_TIMEOUT_MS = 240_000;

/**
 * The AnyHarness runtime's in-sandbox loopback port. NOT 8542 — that value is
 * only the local-dev (`local-workspace` world) default; the managed-cloud
 * runtime is launched with `--require-bearer-auth` on 8457
 * (`build_runtime_launch_script`), so every in-sandbox call must also carry
 * the sandbox's own bearer token (see `resolveRuntimeBearerToken`).
 */
export const SANDBOX_RUNTIME_PORT = 8457;

/** Bounded poll for the async server-side worker enrollment (spec step 5). */
const WORKER_ENROLLMENT_POLL_TIMEOUT_MS = 90_000;
const WORKER_ENROLLMENT_POLL_INTERVAL_MS = 5_000;

/**
 * Bounded poll for the async cloud materialization worker to sync the
 * actor's agent-auth gateway selection into the sandbox before a live gateway
 * probe can succeed (spec step 8). `schedule_materialize_sandbox`
 * (`server/proliferate/server/cloud/materialization/service.py`) runs the
 * sandbox's full bootstrap — github creds, secrets, per-repo preclone, THEN
 * agent-auth (`materialize/sandbox.py`'s `_materialize_sandbox`) — as a
 * background task scheduled independently of the provider sandbox becoming
 * `running`, so it can still be in flight once `completeAndConverge` returns.
 */
const GATEWAY_PROBE_POLL_TIMEOUT_MS = 120_000;
const GATEWAY_PROBE_POLL_INTERVAL_MS = 5_000;

/**
 * Bounded wait for the sandbox runtime's OWN `GET /v1/agents/launch-options`
 * to list the harness with models before the browser turn opens. The runtime
 * derives launch-options per request (no runtime-side cache —
 * `resolved_workspace_launch_options`, sessions/service/launch_options.rs), so
 * this converges as soon as readiness flips; a persistent empty menu means
 * readiness itself is failing (InstallRequired/Unsupported — states a gateway
 * route deliberately never clears), which the on-timeout `GET /v1/agents`
 * readiness dump names precisely.
 */
const LAUNCH_OPTIONS_POLL_TIMEOUT_MS = 120_000;
const LAUNCH_OPTIONS_POLL_INTERVAL_MS = 5_000;

/**
 * Mirrors `proliferate.constants.cloud.CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS`
 * (90s) — the same value the server itself uses to derive `RuntimeWorkerValue.online`.
 */
const CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS = 90;

type ScenarioCellOutcomeWithEvidence = ScenarioCellOutcome & { evidence?: CellEvidenceV1 };

export const cloudProvision1: ScenarioDefinition = {
  id: CLOUD_PROVISION_1_ID,
  kind: "matrix",
  title:
    "prove one real managed-cloud workspace: exact candidate template → real GitHub authorization → " +
    "one E2B sandbox → covered repo → one correlated gateway turn → strict cleanup",
  registryFlowRef: "specs/developing/testing/flows.md#cloud-provision",
  lanes: ["sandbox"],
  requiredEnv: [
    "AGENT_GATEWAY_LITELLM_BASE_URL",
    "AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL",
    "AGENT_GATEWAY_LITELLM_MASTER_KEY",
    "RELEASE_E2E_E2B_API_KEY",
    "RELEASE_E2E_E2B_TEAM_ID",
    "RELEASE_E2E_CLOUD_AWS_REGION",
    "RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID",
    "RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY",
    "RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET",
    "RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64",
    "RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64",
  ],
  expandCells: (): ScenarioCellSpec[] => [{ dimensions: { harness: REPRESENTATIVE_HARNESS } }],
  planCell: (_ctx, cell: PlannedCellV1): ScenarioPlanStep[] => [
    { description: `[${cell.cell_id}] construct the managed-cloud world (candidate API + immutable template available; no user sandbox)` },
    { description: `[${cell.cell_id}] create the fresh owner actor; apply Core funding; wait for gateway enrollment synced` },
    { description: `[${cell.cell_id}] start real product GitHub authorization; controller completes only the human boundary; run the production completion tail` },
    { description: `[${cell.cell_id}] assert concurrent/replayed completion converges to exactly one logical + one provider sandbox` },
    { description: `[${cell.cell_id}] verify the sandbox uses the exact immutable template (provider ids), is running, and record its provider timing source` },
    { description: `[${cell.cell_id}] verify exactly one Worker enrolled, heartbeat recent, Supervisor is parent, versions+hashes match the candidate receipts` },
    { description: `[${cell.cell_id}] assert authenticated AnyHarness health + non-empty live catalog` },
    { description: `[${cell.cell_id}] verify the covered repository materialized at the pinned commit with no credential in its remote URL` },
    { description: `[${cell.cell_id}] choose the cheapest eligible non-Fable Claude model and run one managed-gateway turn through the product UI` },
    { description: `[${cell.cell_id}] correlate the turn with new LiteLLM spend rows` },
    { description: `[${cell.cell_id}] prove Actor B cannot discover/access actor A's sandbox/runtime/workspace/session` },
    { description: `[${cell.cell_id}] clean up every run-created resource in reverse order; emit cloud_provision_turn evidence` },
  ],
  runCells: async (ctx, cells): Promise<ScenarioCellOutcome[]> => {
    const driver = defaultCloudProvision1Driver;
    const outcomes: ScenarioCellOutcomeWithEvidence[] = [];
    for (const cell of cells) {
      outcomes.push(await runCloudProvision1Cell(cell, ctx, driver));
    }
    return outcomes;
  },
};

/** Typed, resolved inputs `constructManagedCloudWorld` needs — everything read out of `ctx.env`. */
export interface CloudProvision1ConstructionInputs {
  map: CandidateBuildMapV1;
  litellm: QualificationLiteLlmConfig;
  run: RunIdentityV1;
  runDir: string;
  aws: Ec2ProvisionConfig;
  e2bTeamId: string;
  /** Raw secret; only ever handed to `buildWorld`, which writes it to a 0600 file and discards it. */
  e2bApiKey: string;
  tls: {
    certificateBase64: string;
    privateKeyBase64: string;
  };
  github: {
    appId: string;
    clientId: string;
    installationId: string;
    /** Raw secret; see `e2bApiKey`. */
    privateKey: string;
    /** Raw secret; see `e2bApiKey`. */
    clientSecret: string;
  };
}

/** Convergence result of the real product GitHub-authorization completion tail (spec step 3). */
export interface SandboxConvergence {
  cloudSandboxId: string;
  providerSandboxId: string;
  /** Observed provider count for this cloud_sandbox_id (spec step 3: exactly one, no orphan). */
  providerSandboxCount: number;
  /** Observed logical `cloud_sandbox` rows for the owner (spec step 3: exactly one). */
  logicalSandboxCount: number;
  /** The template id E2B reports the running sandbox was spawned from (observed, for MCW-003). */
  observedTemplateId: string | null;
  /** The provider-reported start time — the running-interval source (spec step 4). */
  observedStartedAt: string | null;
}

export interface TemplateVerification {
  templateId: string;
  buildId: string;
  inputHash: string;
  runningSince: string;
  /** Where the running interval came from (e.g. "e2b sandbox metadata"). */
  timingSource: string;
}

export interface WorkerSupervisorVerification {
  workerVersion: string;
  supervisorVersion: string;
  anyharnessVersion: string;
  supervisorIsParent: boolean;
  heartbeatRecent: true;
  /**
   * The in-sandbox binaries' observed sha256s each matched their candidate-map
   * receipt (spec step 5 "…+hashes match the candidate receipts" / MCW-003).
   * `true` is the only value this returns — a mismatch throws.
   */
  anyharnessHashMatchesReceipt: true;
  workerHashMatchesReceipt: true;
  supervisorHashMatchesReceipt: true;
}

export interface CoveredRepoVerification {
  name: string;
  commit: string;
  noCredentialInRemote: true;
  /**
   * The materialized checkout's HEAD equalled the covered repo's pinned commit —
   * the branch tip `git ls-remote` reports for the same repo the product cloned
   * (spec step 7 "materializes at the pinned commit" / MCW-003). A mismatch throws.
   */
  commitMatchesPinned: true;
}

export interface IsolationVerification {
  /** Actor B's product listing did NOT reveal actor A's sandbox/workspace/session (observed). */
  actorBCannotDiscover: boolean;
  /** The direct runtime rejected an UNAUTHENTICATED request with the expected status (observed). */
  runtimeRejectsMissing: boolean;
  /** The direct runtime rejected a request bearing actor B's product credential (observed). */
  runtimeRejectsActorB: boolean;
  /** HTTP status the runtime returned for the missing-credential probe (evidence/diagnostic). */
  missingCredentialStatus: number;
  /** HTTP status the runtime returned for actor B's credential (evidence/diagnostic). */
  actorBCredentialStatus: number;
}

/**
 * Every privileged/stateful step the cell performs, factored out so unit tests
 * can fake the world/fixtures/browser/provider entirely. Production wiring
 * (`defaultCloudProvision1Driver`) calls the real world/fixture/controller
 * functions the world-stack and fixtures+auth workstreams own.
 */
export interface CloudProvision1Driver {
  buildWorld(inputs: CloudProvision1ConstructionInputs): Promise<ManagedCloudWorld>;
  createActor(world: ManagedCloudWorld): Promise<AuthenticatedActor>;
  /**
   * Actor B — a REAL second product identity for the isolation check (spec
   * step 9). Created through the supported invite→register→login seam (actor A,
   * an org admin, mints the invitation), NOT by reusing the one-time `/setup`
   * claim actor A already consumed (MCW-001).
   */
  createSecondActor(world: ManagedCloudWorld, actorA: AuthenticatedActor): Promise<AuthenticatedActor>;
  fundCore(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<CoreFundingResult>;
  trackActorSubjects(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<void>;
  authorizeGithub(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<GithubAuthorizationBoundary>;
  /**
   * Runs the real product callback + completion tail against the boundary's
   * code+state, then replays the completion at least once (spec step 3:
   * "concurrent/replayed completion converges") and asserts the result is
   * exactly one logical sandbox + one provider sandbox.
   */
  completeAndConverge(
    world: ManagedCloudWorld,
    actor: AuthenticatedActor,
    boundary: GithubAuthorizationBoundary,
  ): Promise<SandboxConvergence>;
  verifyTemplateAndRunning(world: ManagedCloudWorld, convergence: SandboxConvergence): Promise<TemplateVerification>;
  verifyWorkerSupervisor(
    world: ManagedCloudWorld,
    convergence: SandboxConvergence,
  ): Promise<WorkerSupervisorVerification>;
  verifyAnyharnessHealth(world: ManagedCloudWorld, convergence: SandboxConvergence): Promise<void>;
  verifyCoveredRepo(world: ManagedCloudWorld, convergence: SandboxConvergence): Promise<CoveredRepoVerification>;
  allowlistModels(world: ManagedCloudWorld): Promise<string[]>;
  liveProbeModels(world: ManagedCloudWorld, convergence: SandboxConvergence, harnessKind: string): Promise<string[]>;
  /** Sends the bounded prompt through the product UI and returns the assistant reply. */
  runGatewayTurn(
    world: ManagedCloudWorld,
    actor: AuthenticatedActor,
    convergence: SandboxConvergence,
    modelId: string,
    prompt: string,
    harnessKind: string,
  ): Promise<{ reply: string }>;
  snapshotSpend(world: ManagedCloudWorld, actor: AuthenticatedActor): Promise<SpendSnapshot>;
  correlateTurn(
    world: ManagedCloudWorld,
    params: {
      actor: AuthenticatedActor;
      before: SpendSnapshot;
      acceptedModelId: string;
      windowStartedAt: string;
      windowFinishedAt: string;
    },
  ): Promise<CorrelatedTurnSpend>;
  verifyActorBIsolation(
    world: ManagedCloudWorld,
    actorB: AuthenticatedActor,
    convergence: SandboxConvergence,
  ): Promise<IsolationVerification>;
  closeWorld(world: ManagedCloudWorld): ReturnType<ManagedCloudWorld["close"]>;
}

// ---------------------------------------------------------------------------
// Server-DB seams: runtime bearer token + worker enrollment (spec steps 5/6)
// ---------------------------------------------------------------------------

/**
 * Mirrors `connect.py`'s `_runtime_token`: decrypts
 * `cloud_sandbox.runtime_token_ciphertext` (the `CloudSandboxValue` field the
 * product calls `anyharness_bearer_token_ciphertext`) with the exact same
 * `proliferate.utils.crypto.decrypt_text` helper. Never prints the token
 * itself — only a `{"token": ...}` JSON line the caller parses.
 */
const DECRYPT_RUNTIME_TOKEN_PY = `import asyncio, json, os
from uuid import UUID
from proliferate.db.engine import async_session_factory
from proliferate.db.store.cloud_sandboxes import load_cloud_sandbox_by_id
from proliferate.utils.crypto import decrypt_text

CLOUD_SANDBOX_ID = UUID(os.environ["CLOUD_SANDBOX_ID"])

async def main():
    async with async_session_factory() as db:
        sandbox = await load_cloud_sandbox_by_id(db, CLOUD_SANDBOX_ID)
        token = None
        if sandbox is not None and sandbox.anyharness_bearer_token_ciphertext:
            token = decrypt_text(sandbox.anyharness_bearer_token_ciphertext)
        print(json.dumps({"token": token}))

asyncio.run(main())
`;

/**
 * Resolves the sandbox's AnyHarness runtime bearer token via the box-exec
 * seam. The raw token is returned to the caller and threaded straight into an
 * `execInProviderSandbox` argv as a bash variable (see `curlWithBearerArgs`)
 * — this function never writes it to a log line or embeds it in a thrown
 * `Error` message.
 */
async function resolveRuntimeBearerToken(box: BoxExec, cloudSandboxId: string): Promise<string> {
  const result = await box.serverPython(DECRYPT_RUNTIME_TOKEN_PY, {
    env: { CLOUD_SANDBOX_ID: cloudSandboxId },
    scriptName: "resolve-runtime-bearer-token.py",
  });
  const parsed = parseLastJsonLine(result.stdout) as { token?: unknown };
  if (typeof parsed.token !== "string" || !parsed.token) {
    throw new Error(
      "resolveRuntimeBearerToken: the candidate box did not report a runtime bearer token for this sandbox " +
        "(cloud_sandbox.runtime_token_ciphertext is unset or undecryptable).",
    );
  }
  return parsed.token;
}

/**
 * Counts the owner's non-destroyed logical `cloud_sandbox` rows (spec step 3:
 * exactly one). `load_personal_cloud_sandbox` returns at most one via
 * `scalar_one_or_none`, so a raw COUNT is used here to make a duplicate (more
 * than one row) OBSERVABLE rather than silently collapsed to the first.
 */
const COUNT_LOGICAL_SANDBOXES_PY = `import asyncio, json, os
from uuid import UUID
from sqlalchemy import func, select
from proliferate.db.engine import async_session_factory
from proliferate.db.models.cloud.sandboxes import CloudSandbox

OWNER_USER_ID = UUID(os.environ["OWNER_USER_ID"])

async def main():
    async with async_session_factory() as db:
        count = (
            await db.execute(
                select(func.count())
                .select_from(CloudSandbox)
                .where(
                    CloudSandbox.owner_user_id == OWNER_USER_ID,
                    CloudSandbox.destroyed_at.is_(None),
                )
            )
        ).scalar_one()
        print(json.dumps({"count": int(count)}))

asyncio.run(main())
`;

/** Counts the owner's live logical cloud_sandbox rows via the box-exec seam. */
async function countLogicalSandboxes(box: BoxExec, ownerUserId: string): Promise<number> {
  const result = await box.serverPython(COUNT_LOGICAL_SANDBOXES_PY, {
    env: { OWNER_USER_ID: ownerUserId },
    scriptName: "count-logical-sandboxes.py",
  });
  const parsed = parseLastJsonLine(result.stdout) as { count?: unknown };
  if (typeof parsed.count !== "number") {
    throw new Error(
      `countLogicalSandboxes: the candidate box did not report a numeric cloud_sandbox count (stdout: ${result.stdout.trim()}).`,
    );
  }
  return parsed.count;
}

interface CloudRuntimeWorkerRow {
  status: string;
  worker_version: string | null;
  anyharness_version: string | null;
  enrolled_at: string | null;
  last_seen_at: string | null;
}

function observedVersionMatchingReceipt(
  observed: E2BExecResult,
  receiptVersion: string,
  label: string,
): string {
  if (observed.exitCode !== 0) {
    throw new Error(
      `verifyWorkerSupervisor: ${label} --version exited ${observed.exitCode}; stderr=${observed.stderr.trim().slice(0, 300)}`,
    );
  }
  // clap prints `<binary-name> <version>` for `--version`. Persisting that
  // whole line would make otherwise-valid evidence fail the safe-token schema
  // because it contains whitespace. Match the exact receipt version as a
  // whitespace token (also tolerating clap's conventional leading `v`) and
  // persist the receipt's canonical token. A blank or diverged response stays
  // non-green: the hash check below proves the bytes, while this check proves
  // the stamped version those exact bytes advertise.
  const versionMatches = observed.stdout
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => token === receiptVersion || token === `v${receiptVersion}`);
  if (!versionMatches) {
    throw new Error(
      `verifyWorkerSupervisor: ${label} --version did not advertise candidate receipt version ${receiptVersion}; ` +
        `stdout=${JSON.stringify(observed.stdout.trim().slice(0, 200))}`,
    );
  }
  return receiptVersion;
}

/**
 * Queries `cloud_runtime_worker` directly (there is no product API exposing
 * worker enrollment/heartbeat — see the product read this fix implements).
 * Selects every non-revoked row for the sandbox; the server's own partial
 * unique index (`ux_cloud_runtime_worker_active_sandbox`) already enforces at
 * most one, so a query result of more than one row is a genuine anomaly
 * worth failing loudly on rather than silently picking one.
 */
const QUERY_WORKER_ENROLLMENT_PY = `import asyncio, json, os
from uuid import UUID
from sqlalchemy import select
from proliferate.db.engine import async_session_factory
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

CLOUD_SANDBOX_ID = UUID(os.environ["CLOUD_SANDBOX_ID"])

async def main():
    async with async_session_factory() as db:
        rows = (
            await db.execute(
                select(CloudRuntimeWorker).where(
                    CloudRuntimeWorker.cloud_sandbox_id == CLOUD_SANDBOX_ID,
                    CloudRuntimeWorker.status != "revoked",
                )
            )
        ).scalars().all()
        workers = [
            {
                "status": row.status,
                "worker_version": row.worker_version,
                "anyharness_version": row.anyharness_version,
                "enrolled_at": row.enrolled_at.isoformat() if row.enrolled_at else None,
                "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
            }
            for row in rows
        ]
        print(json.dumps({"workers": workers}))

asyncio.run(main())
`;

/**
 * Polls `cloud_runtime_worker` (via the box-exec seam, spec step 5) until
 * exactly one non-revoked row is `online`, its heartbeat is within the
 * server's own offline threshold, and it has reported both component
 * versions — or throws once `WORKER_ENROLLMENT_POLL_TIMEOUT_MS` elapses. A
 * bounded poll rather than a single read: `launch_worker_sidecar` enrolls the
 * Worker asynchronously, so the row can take a few seconds to appear after
 * the sandbox is otherwise `running`.
 */
async function verifyWorkerEnrollmentOnServer(
  box: BoxExec,
  cloudSandboxId: string,
  pollTimeoutMs: number,
  pollIntervalMs: number,
): Promise<CloudRuntimeWorkerRow> {
  const deadline = Date.now() + pollTimeoutMs;
  let lastRows: CloudRuntimeWorkerRow[] = [];
  for (;;) {
    const result = await box.serverPython(QUERY_WORKER_ENROLLMENT_PY, {
      env: { CLOUD_SANDBOX_ID: cloudSandboxId },
      scriptName: "query-worker-enrollment.py",
    });
    const parsed = parseLastJsonLine(result.stdout) as { workers?: CloudRuntimeWorkerRow[] };
    lastRows = Array.isArray(parsed.workers) ? parsed.workers : [];
    // Enrollment + liveness is the server-DB guarantee: exactly one online row
    // with a recent heartbeat. The DB row's self-reported version columns can
    // be null (the worker reports them opportunistically and they may lag the
    // first heartbeat) — the AUTHORITATIVE version identity is the in-sandbox
    // `--version` execs matched against the candidate receipts (verifyWorkerSupervisor),
    // so do NOT gate enrollment on the DB version columns.
    const row = lastRows.length === 1 ? lastRows[0]! : null;
    if (row && row.status === "online") {
      const lastSeenAgeSeconds = row.last_seen_at
        ? (Date.now() - Date.parse(row.last_seen_at)) / 1000
        : Number.POSITIVE_INFINITY;
      if (lastSeenAgeSeconds <= CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS) {
        return row;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `verifyWorkerEnrollmentOnServer: no single online cloud_runtime_worker row with a recent heartbeat ` +
          `materialized for this sandbox within ${pollTimeoutMs}ms ` +
          `(found ${lastRows.length} non-revoked row(s): ${JSON.stringify(lastRows.map((r) => ({ status: r.status, last_seen_at: r.last_seen_at })))}).`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

/** Escapes a value for safe single-quoted POSIX shell interpolation (mirrors box-exec.ts's private helper). */
function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds an in-sandbox `sh -c` argv that curls an authenticated AnyHarness
 * endpoint. The bearer token is passed as its own argv element (`$1` inside
 * the script, assigned to a bash var) rather than string-interpolated into
 * the script text, so it never appears inside the command string itself —
 * and this module never logs the returned argv or the token.
 */
function curlWithBearerArgs(token: string, url: string): string[] {
  return [
    "sh",
    "-c",
    `TOK="$1"; curl -fsS -H "Authorization: Bearer $TOK" ${posixSingleQuote(url)}`,
    "sh",
    token,
  ];
}

/**
 * Same shape as `curlWithBearerArgs`, but issues an authenticated POST with no
 * body (used for `POST /v1/agents/{kind}/catalog/refresh-gateway`, which takes
 * no request body — only a path param) and CAPTURES the response body even on a
 * 4xx/5xx.
 *
 * Deliberately drops `-f` (which would make curl exit non-zero and discard the
 * body on an HTTP error) and appends the numeric status via `-w '\n%{http_code}'`
 * so the caller can read WHICH error the runtime returned
 * (`GATEWAY_REFRESH_NO_SELECTION` vs `…_NO_STATE` vs `…_PROBE_FAILED`). Output is
 * `<body>\n<status>`; a non-zero curl exit then means a genuine transport/connect
 * failure (no HTTP response at all), not an HTTP error status. `-w` is placed
 * AFTER the URL so the bearer header is still immediately followed by the quoted
 * URL. The token still rides only as its own argv element (`$1`).
 */
function curlPostCaptureArgs(token: string, url: string): string[] {
  return [
    "sh",
    "-c",
    `TOK="$1"; curl -sS -X POST -H "Authorization: Bearer $TOK" ${posixSingleQuote(url)} -w '\\n%{http_code}'`,
    "sh",
    token,
  ];
}

/**
 * A GET that CAPTURES the numeric HTTP status even on a 4xx/5xx (drops `-f`,
 * appends `-w '\n%{http_code}'`) and carries NO Authorization header — used by
 * the isolation check to prove the runtime rejects an UNAUTHENTICATED request
 * (spec step 9). Output is `<body>\n<status>`.
 */
function curlGetStatusNoAuthArgs(url: string): string[] {
  return ["sh", "-c", `curl -sS ${posixSingleQuote(url)} -w '\\n%{http_code}'`];
}

/**
 * A GET that captures the numeric HTTP status even on a 4xx/5xx and carries the
 * supplied bearer as its own argv element (`$1`) — used by the isolation check
 * to prove the runtime rejects ACTOR B's product credential (spec step 9). The
 * token never appears in the command string; this module never logs the argv.
 */
function curlGetStatusWithBearerArgs(token: string, url: string): string[] {
  return [
    "sh",
    "-c",
    `TOK="$1"; curl -sS -H "Authorization: Bearer $TOK" ${posixSingleQuote(url)} -w '\\n%{http_code}'`,
    "sh",
    token,
  ];
}

/** Splits `curlPostCaptureArgs` output (`<body>\n<status>`) into the response
 * body and the numeric HTTP status (NaN when the status line is unparseable). */
function splitBodyAndStatus(raw: string): { status: number; body: string } {
  const nl = raw.lastIndexOf("\n");
  if (nl < 0) {
    return { status: Number.NaN, body: raw };
  }
  const status = Number.parseInt(raw.slice(nl + 1).trim(), 10);
  return { status: Number.isFinite(status) ? status : Number.NaN, body: raw.slice(0, nl) };
}

/** One agent row of `GET /v1/agents/launch-options` (contract `AgentLaunchOption`, camelCase wire). */
interface SandboxLaunchOptionsAgent {
  kind?: string;
  models?: Array<{ id?: string }>;
}

/**
 * Bounded wait for the sandbox runtime's `GET /v1/agents/launch-options` to
 * list `harnessKind` with at least one model. The runtime computes this menu
 * per request — joining the active catalog, `resolve_launch_agent` readiness
 * (which a gateway route in `agent-auth/state.json` upgrades to Ready), and
 * the classified auth contexts — so polling converges the moment readiness
 * flips; there is no runtime-side refresh to trigger. Each distinct
 * non-launchable response is surfaced raw under `[cloud-launch-options]` (the
 * runner log, not evidence; the bearer token rides only in the request
 * header). On timeout, dumps the per-agent `GET /v1/agents` readiness summary
 * (installState/credentialState/readiness/message) under
 * `[cloud-agents-readiness]` — the decisive signal for WHY the agent is not
 * launchable (InstallRequired/Unsupported are the states a gateway route
 * deliberately never clears) — then throws.
 */
export async function waitForSandboxLaunchOptions(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  token: string,
  harnessKind: string,
  pollTimeoutMs: number,
  pollIntervalMs: number,
): Promise<void> {
  const url = `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents/launch-options`;
  const deadline = Date.now() + pollTimeoutMs;
  let lastFailure = "no attempt";
  let lastSurfaced = "";
  const surface = (line: string): void => {
    if (line === lastSurfaced) {
      return;
    }
    lastSurfaced = line;
    process.stderr.write(`[cloud-launch-options] ${line}\n`);
  };
  for (;;) {
    const probe = await exec(providerSandboxId, curlWithBearerArgs(token, url));
    if (probe.exitCode === 0) {
      try {
        const parsed = JSON.parse(probe.stdout) as { agents?: SandboxLaunchOptionsAgent[] };
        const agent = (parsed.agents ?? []).find((entry) => entry.kind === harnessKind);
        if (agent && (agent.models?.length ?? 0) > 0) {
          return;
        }
        lastFailure = `launch-options does not list a launchable "${harnessKind}"`;
        surface(`no launchable "${harnessKind}" yet: ${probe.stdout.trim().slice(0, 600)}`);
      } catch {
        lastFailure = "launch-options response was not valid JSON";
        surface(`invalid JSON: ${probe.stdout.trim().slice(0, 300)}`);
      }
    } else {
      lastFailure = `launch-options curl exited ${probe.exitCode}`;
      surface(`curl exit=${probe.exitCode} stderr=${probe.stderr.trim().slice(0, 200)}`);
    }
    if (Date.now() >= deadline) {
      await dumpSandboxAgentReadiness(exec, providerSandboxId, token).catch(() => undefined);
      throw new Error(
        `waitForSandboxLaunchOptions: the sandbox runtime never listed "${harnessKind}" with models at ` +
          `GET /v1/agents/launch-options within ${pollTimeoutMs}ms (last: ${lastFailure}). The per-agent ` +
          "readiness summary was surfaced to the runner log under [cloud-agents-readiness]; " +
          "installState/readiness there names the failing precondition (a gateway route clears only " +
          "login/credential gaps — never install_required/unsupported).",
      );
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Surfaces the runtime's per-agent readiness (`GET /v1/agents`, contract
 * `AgentSummary`) reduced to the diagnostic fields — never the full payload,
 * which can carry filesystem paths beyond what the log needs.
 */
async function dumpSandboxAgentReadiness(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  token: string,
): Promise<void> {
  const probe = await exec(
    providerSandboxId,
    curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents`),
  );
  let summary = `curl exit=${probe.exitCode}`;
  if (probe.exitCode === 0) {
    try {
      const parsed = JSON.parse(probe.stdout) as Array<{
        kind?: string;
        installState?: string;
        credentialState?: string;
        readiness?: string;
        message?: string;
        native?: { installed?: boolean };
        agentProcess?: { installed?: boolean };
      }>;
      summary = JSON.stringify(
        parsed.map((agent) => ({
          kind: agent.kind,
          installState: agent.installState,
          credentialState: agent.credentialState,
          readiness: agent.readiness,
          nativeInstalled: agent.native?.installed,
          agentProcessInstalled: agent.agentProcess?.installed,
          message: agent.message,
        })),
      );
    } catch {
      summary = `unparseable body: ${probe.stdout.trim().slice(0, 400)}`;
    }
  }
  process.stderr.write(`[cloud-agents-readiness] GET /v1/agents: ${summary.slice(0, 1_200)}\n`);
}

export interface CloudProvision1RuntimeDeps {
  /** Injectable so unit tests can fake the E2B exec seam without a live subprocess/API call. */
  execInProviderSandbox: typeof execInProviderSandbox;
  /** Bounded worker-enrollment poll; overridable so unit tests don't wait out the production timeout. */
  workerEnrollmentPollTimeoutMs: number;
  workerEnrollmentPollIntervalMs: number;
  /** Bounded gateway-probe (refresh-gateway sync) poll; same reason. */
  gatewayProbePollTimeoutMs: number;
  gatewayProbePollIntervalMs: number;
  /** Bounded wait for the runtime's own launch-options to list the harness; same reason. */
  launchOptionsPollTimeoutMs: number;
  launchOptionsPollIntervalMs: number;
}

const productionRuntimeDeps: CloudProvision1RuntimeDeps = {
  execInProviderSandbox,
  workerEnrollmentPollTimeoutMs: WORKER_ENROLLMENT_POLL_TIMEOUT_MS,
  workerEnrollmentPollIntervalMs: WORKER_ENROLLMENT_POLL_INTERVAL_MS,
  gatewayProbePollTimeoutMs: GATEWAY_PROBE_POLL_TIMEOUT_MS,
  gatewayProbePollIntervalMs: GATEWAY_PROBE_POLL_INTERVAL_MS,
  launchOptionsPollTimeoutMs: LAUNCH_OPTIONS_POLL_TIMEOUT_MS,
  launchOptionsPollIntervalMs: LAUNCH_OPTIONS_POLL_INTERVAL_MS,
};

/**
 * Reused-fixture production wiring. `authenticatedActor` is typed against
 * `ReadyLocalWorld` (spec: "reused unchanged... it is world-agnostic (reads
 * world.api, world.paths.runDir/setup-token, world.gateway, world.run)") — the
 * managed-cloud world carries every one of those fields under the same names,
 * so the cast below is a disclosed, structurally-safe deviation rather than a
 * behavior change; flagged for the integrator to consider a shared narrower
 * parameter type in a follow-up.
 */
function asAuthenticatedActorWorld(world: ManagedCloudWorld): ReadyLocalWorld {
  return world as unknown as ReadyLocalWorld;
}

/**
 * Builds the production `CloudProvision1Driver`. `deps.execInProviderSandbox`
 * defaults to the real E2B exec seam; unit tests pass a fake to exercise this
 * driver's real methods (bearer-token threading, port, worker-enrollment
 * query) without a live sandbox.
 */
export function createCloudProvision1Driver(
  deps: Partial<CloudProvision1RuntimeDeps> = {},
): CloudProvision1Driver {
  const exec = deps.execInProviderSandbox ?? productionRuntimeDeps.execInProviderSandbox;
  const workerEnrollmentPollTimeoutMs =
    deps.workerEnrollmentPollTimeoutMs ?? productionRuntimeDeps.workerEnrollmentPollTimeoutMs;
  const workerEnrollmentPollIntervalMs =
    deps.workerEnrollmentPollIntervalMs ?? productionRuntimeDeps.workerEnrollmentPollIntervalMs;
  const gatewayProbePollTimeoutMs =
    deps.gatewayProbePollTimeoutMs ?? productionRuntimeDeps.gatewayProbePollTimeoutMs;
  const gatewayProbePollIntervalMs =
    deps.gatewayProbePollIntervalMs ?? productionRuntimeDeps.gatewayProbePollIntervalMs;
  const launchOptionsPollTimeoutMs =
    deps.launchOptionsPollTimeoutMs ?? productionRuntimeDeps.launchOptionsPollTimeoutMs;
  const launchOptionsPollIntervalMs =
    deps.launchOptionsPollIntervalMs ?? productionRuntimeDeps.launchOptionsPollIntervalMs;
  return {
  async buildWorld(inputs) {
    // The candidate builder owns the parent run directory. Keep this world's
    // cleanup ledger and transient files in a scenario-scoped subtree so its
    // run_directory releaser cannot delete the exact candidate map/artifacts
    // another managed-cloud scenario reuses after this proof passes.
    const scopedRunDir = path.join(inputs.runDir, CLOUD_PROVISION_WORLD_SUBDIR);
    await mkdir(scopedRunDir, { recursive: true });
    await copyFile(
      path.join(inputs.runDir, CLOUD_SUBDOMAIN_SIDECAR),
      path.join(scopedRunDir, CLOUD_SUBDOMAIN_SIDECAR),
    );
    const secretsDir = path.join(scopedRunDir, "secrets");
    await mkdir(secretsDir, { recursive: true });
    const e2bSecretsPath = await writeSecretEnvFile(secretsDir, "e2b.env", {
      E2B_API_KEY: inputs.e2bApiKey,
    });
    // Client secret is single-line and rides the docker --env-file; the private
    // key is a multi-line PEM (docker --env-file rejects it), so it is written as
    // its own 0600 PEM file and mounted into the Server container on the box.
    // #1318 / base-world repair: #1257 (3cb284a51) added
    // require_github_app_runtime_configured() at the top of
    // require_github_cloud_repo_authority, gating on Settings.github_app_configured
    // — now a SIX-field check including github_app_webhook_secret. Without it the
    // gate raises github_app_not_configured (503) inside the repo preclone, the
    // sandbox bootstrap's best-effort try/except swallows it, and the covered repo
    // never materializes (verifyCoveredRepo red). Qualification exercises no
    // inbound App webhook (authorization completes via the controller boundary), so
    // a run-scoped random value (mirrors the JWT_SECRET/CLOUD_SECRET_KEY precedent)
    // satisfies the config gate and is never verified against a delivery.
    const githubSecretsPath = await writeSecretEnvFile(secretsDir, "github-app.env", {
      GITHUB_APP_CLIENT_SECRET: inputs.github.clientSecret,
      GITHUB_APP_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    });
    const githubPrivateKeyPath = path.join(secretsDir, "github-app-private-key.pem");
    await writeFile(githubPrivateKeyPath, `${inputs.github.privateKey.trimEnd()}\n`, { mode: 0o600 });

    const templateCustodyMode = process.env.RELEASE_E2E_SHARED_TEMPLATE_CUSTODY ?? "world_owned";
    if (templateCustodyMode !== "world_owned" && templateCustodyMode !== "producer") {
      throw new Error(
        `CLOUD-PROVISION-1 does not accept shared-template custody mode ${templateCustodyMode}.`,
      );
    }
    const options: ConstructManagedCloudWorldOptions = {
      run: inputs.run,
      map: inputs.map,
      litellm: inputs.litellm,
      aws: inputs.aws,
      e2b: {
        teamId: inputs.e2bTeamId,
        secretsEnvFilePath: e2bSecretsPath,
        // A bare template alias (no team prefix): E2B builds it in the API
        // key's own team and namespaces the returned ref automatically. Prefixing
        // with the team UUID is rejected ("namespace <uuid> must match your team
        // <slug>") because the namespace is the team slug, not the id.
        templateName: `proliferate-runtime-qual-${inputs.run.run_id}`,
      },
      github: {
        appSlug: "proliferate-cloud-staging",
        appId: inputs.github.appId,
        clientId: inputs.github.clientId,
        installationId: inputs.github.installationId,
        secretsEnvFilePath: githubSecretsPath,
        privateKeyPemPath: githubPrivateKeyPath,
      },
      tls: inputs.tls,
      runDir: scopedRunDir,
      templateCustody:
        templateCustodyMode === "producer"
          ? { mode: "shared_producer", journalPath: sharedTemplateCustodyPath(inputs.runDir) }
          : { mode: "world_owned" },
      // World progress + failure diagnostics onto the runner stream (the make
      // log). The constructor's default log is a silent no-op — without this,
      // readiness/cleanup diagnostics are discarded.
      log: (message) => process.stderr.write(`[managed-cloud] ${message}\n`),
    };
    return constructManagedCloudWorld(options);
  },
  // `gatewaySurface: "cloud"` is load-bearing: the cloud sandbox's AnyHarness
  // is materialized from the `cloud` agent-auth surface only
  // (`materialize_agent_auth` → `build_agent_auth_state(..., surface="cloud")`),
  // and only a `cloud`-surface selection PUT triggers
  // `schedule_materialize_agent_auth` (`agent_gateway/service.py:249`). Selecting
  // the default `local` surface (correct for the local-workspace world) would
  // leave the sandbox's state.json with no gateway source, so
  // `refresh-gateway` 400s (GATEWAY_REFRESH_NO_SELECTION) and step 8's live
  // probe finds zero models.
  createActor: (world) =>
    authenticatedActor(asAuthenticatedActorWorld(world), "owner", {
      gatewaySurface: "cloud",
      beginActorEnrollmentCustody: (params) => {
        if (!world.beginActorEnrollmentCustody) {
          throw new Error("managed-cloud world exposes no pre-creation LiteLLM enrollment custody.");
        }
        return world.beginActorEnrollmentCustody(params);
      },
    }),
  // Actor B is a REAL invited second user (MCW-001): actor A mints an org
  // invitation, actor B registers against it and logs in. Reusing the one-time
  // `/setup` claim (as the prior version did) is not a viable second identity —
  // actor A already consumed it.
  createSecondActor: (world, actorA) =>
    invitedActor(asAuthenticatedActorWorld(world), {
      inviter: actorA,
      gatewaySurface: "cloud",
      email: `qual-actor-b-${world.run.run_id}-${world.run.shard_id}@example.com`,
      beginActorEnrollmentCustody: (params) => {
        if (!world.beginActorEnrollmentCustody) {
          throw new Error("managed-cloud world exposes no pre-creation LiteLLM enrollment custody.");
        }
        return world.beginActorEnrollmentCustody(params);
      },
    }),
  fundCore: (world, actor) =>
    // Founder ruling (option B): the candidate box carries no Stripe/billing
    // config, so the real cloud-checkout endpoint 503s. Pin the spec-sanctioned
    // server-side entitlement seed (this provisioning proof only); real Core
    // checkout funding is proven by PR 4/PR 6. Stripe checkout is not attempted.
    coreFunding(world, actor, { method: "entitlement_seed" }, {
      ...defaultCoreFundingTransport,
      // Disclosed server-side entitlement seed: a real unlimited-cloud
      // BillingEntitlement written by the product's own store functions on the
      // candidate box via the box-exec seam.
      async seedEntitlement(w, a) {
        if (!w.box) {
          throw new Error(
            "coreFunding.seedEntitlement: the managed-cloud world exposes no box-exec seam; " +
              "the entitlement seed must run the product's own store functions on the candidate box.",
          );
        }
        return seedUnlimitedCloudEntitlementOnBox(w.box, a.userId);
      },
    }),
  async trackActorSubjects(world, actor) {
    await world.trackActorSubjects?.(actor.gatewayKey);
  },
  async authorizeGithub(world, actor) {
    // Automated lane (founder-confirmed 2026-07-15): when the D2 bot seed is
    // available and the candidate box is reachable, clear the authorization
    // boundary via the 2026-07-09-ruled refresh-seed on the box rather than the
    // browser code-exchange (deferred to PR 6's serial lane). Falls back to the
    // fixture's manual-assist / blocked-honest lanes when no seed is present.
    const botSeed = await resolveBotSeedForAutomation();
    if (world.box && botSeed) {
      const seeded = await seedGithubAuthorizationOnBox({
        box: world.box,
        userId: actor.userId,
        clientId: botSeed.clientId,
        clientSecret: botSeed.clientSecret,
        refreshToken: botSeed.refreshToken,
        coveredRepoOwner: COVERED_REPO_OWNER,
        coveredRepoName: COVERED_REPO_NAME,
        coveredRepoDefaultBranch: COVERED_REPO_DEFAULT_BRANCH,
        // MCW-004: persist the ROTATED token to whichever of {local file, SSM}
        // are durable for this lane — SSM unconditionally in Actions (the only
        // durable store on an ephemeral runner), the local file otherwise.
        // Throws loudly on a failed durable write (GitHub has already rotated
        // the token server-side, so a lost replacement bricks the seed).
        persistRotatedRefreshToken: (next) =>
          persistRotatedBotSeedDurable(
            {
              localSeedFilePath: botSeed.seedFilePath,
              source: botSeed.source,
              ssmParameterName: botSeed.ssmParameterName,
              region: botSeed.region,
            },
            next,
          ),
      });
      if (seeded.githubLogin !== EXPECTED_BOT_LOGIN) {
        throw new Error(
          `authorizeGithub: the bot seed authorized as "${seeded.githubLogin}", not ${EXPECTED_BOT_LOGIN}; ` +
            "refusing to proceed (the device-flow bootstrap was approved by the wrong identity).",
        );
      }
      return { mode: "automated", authorizationCode: "seeded", state: "seeded" };
    }
    return githubAuthorization(world, actor);
  },
  async completeAndConverge(world, actor, boundary) {
    // Runs the real production callback (GET /auth/github-app/user-authorization/callback,
    // an unauthenticated redirect endpoint keyed by the signed `state`), then
    // replays the completion at least once to prove the product converges on
    // exactly one logical sandbox row even under a duplicate/concurrent
    // callback (spec step 3).
    // Automated lane: the authorization row was already seeded on the box (the
    // 2026-07-09-ruled refresh-seed), so there is no browser-delivered `code` to
    // feed the web callback — the completion is driven purely by the real
    // `/v1/cloud/cloud-sandbox/ensure` convergence below. Manual/blocked lanes carry a
    // real code, so they still exercise the production callback tail.
    if (boundary.mode !== "automated") {
      const callbackPath =
        `/auth/github-app/user-authorization/callback?code=${encodeURIComponent(boundary.authorizationCode)}` +
        `&state=${encodeURIComponent(boundary.state)}`;
      await actor.api.get(callbackPath).catch(() => undefined);
    }

    const deadline = Date.now() + AUTHORIZATION_TAIL_TIMEOUT_MS;
    let cloudSandboxId: string | null = null;
    let lastEnsureError = "no attempt";
    while (Date.now() < deadline) {
      const [first, second] = await Promise.allSettled([
        actor.api.post<{ id: string }>("/v1/cloud/cloud-sandbox/ensure", {}),
        actor.api.post<{ id: string }>("/v1/cloud/cloud-sandbox/ensure", {}),
      ]);
      const ids = [first, second]
        .filter((result): result is PromiseFulfilledResult<{ id: string }> => result.status === "fulfilled")
        .map((result) => result.value.id);
      // Capture the rejection so a materialization timeout reports WHY /ensure
      // failed (auth, entitlement gate, provider error) instead of a blind wait.
      const rejection = [first, second].find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejection) {
        const reason = rejection.reason as Error & { status?: number };
        const next = `status=${reason?.status ?? "?"} ${String(reason?.message ?? rejection.reason)}`.slice(0, 300);
        if (next !== lastEnsureError) {
          // Raw diagnostic to the runner's stdout/stderr stream (the make log),
          // which is NOT persisted evidence — the evidence reason stays sanitized.
          process.stderr.write(`[cloud-provision-1] /ensure rejection: ${next}\n`);
        }
        lastEnsureError = next;
      }
      if (ids.length > 0) {
        const distinct = new Set(ids);
        if (distinct.size > 1) {
          throw new Error(
            `completeAndConverge: replayed completion produced ${distinct.size} distinct sandbox ids ` +
              "(spec step 3 requires exactly one).",
          );
        }
        cloudSandboxId = ids[0]!;
        break;
      }
      await sleep(2_000);
    }
    if (!cloudSandboxId) {
      throw new Error(
        `completeAndConverge: no cloud sandbox materialized within ${AUTHORIZATION_TAIL_TIMEOUT_MS}ms ` +
          `(last /v1/cloud/cloud-sandbox/ensure error: ${lastEnsureError}).`,
      );
    }

    // The provider sandbox is spawned ASYNCHRONOUSLY by the server's
    // materializer after /ensure returns the row — poll bounded instead of a
    // single immediate lookup (a one-shot check here is exactly what leaked
    // orphan sandboxes: the spawn completed after failed runs tore down).
    // `findProviderSandbox` now drains EVERY page and returns ALL matches, so a
    // duplicate/orphan provider sandbox is observable (MCW-002) rather than
    // hidden behind `items[0]`.
    const providerDeadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
    let matches: NonNullable<Awaited<ReturnType<typeof findProviderSandbox>>["matches"]> = [];
    while (Date.now() < providerDeadline) {
      const found = await findProviderSandbox(cloudSandboxId);
      matches = found.matches ?? (found.providerSandboxId
        ? [{ providerSandboxId: found.providerSandboxId, state: found.state as "running" | "paused", templateId: null, startedAt: null }]
        : []);
      if (matches.length > 0) {
        break;
      }
      await sleep(5_000);
    }
    if (matches.length === 0) {
      throw new Error(
        `completeAndConverge: no provider sandbox found for the materialized cloud sandbox within ${SANDBOX_READY_TIMEOUT_MS}ms.`,
      );
    }
    // Register the kill for EVERY discovered provider sandbox BEFORE any
    // convergence assertion, so the negative case (a duplicate/orphan) can never
    // leave a provider sandbox running (idempotent; absent counts as killed).
    for (const match of matches) {
      const id = match.providerSandboxId;
      await world.registerCleanup?.("e2b_sandbox", id, async () => {
        await killProviderSandbox(id);
      });
    }
    if (matches.length > 1) {
      throw new Error(
        `completeAndConverge: found ${matches.length} provider sandboxes tagged with cloud_sandbox ${cloudSandboxId} ` +
          "(spec step 3 requires exactly one — a duplicate/orphan provider sandbox). All were registered for cleanup.",
      );
    }

    // Exactly one LOGICAL row too (spec step 3): the concurrent/replayed
    // completion must converge on one `cloud_sandbox`, not two.
    if (!world.box) {
      throw new Error(
        "completeAndConverge: the managed-cloud world exposes no box-exec seam; the logical-row convergence check " +
          "must query the candidate box's own cloud_sandbox table.",
      );
    }
    const logicalSandboxCount = await countLogicalSandboxes(world.box, actor.userId);
    if (logicalSandboxCount !== 1) {
      throw new Error(
        `completeAndConverge: the owner has ${logicalSandboxCount} live cloud_sandbox rows after replayed completion ` +
          "(spec step 3 requires exactly one logical row).",
      );
    }

    const only = matches[0]!;
    return {
      cloudSandboxId,
      providerSandboxId: only.providerSandboxId,
      providerSandboxCount: matches.length,
      logicalSandboxCount,
      observedTemplateId: only.templateId,
      observedStartedAt: only.startedAt,
    };
  },
  async verifyTemplateAndRunning(world, convergence) {
    // Re-observe the provider sandbox directly (its template id + start time),
    // and COMPARE the observed template id against the candidate template
    // receipt (MCW-003) — do not copy the receipt id into evidence blindly.
    const found = await findProviderSandbox(convergence.cloudSandboxId);
    const observed = (found.matches ?? []).find((m) => m.providerSandboxId === convergence.providerSandboxId)
      ?? (found.providerSandboxId === convergence.providerSandboxId
        ? { providerSandboxId: convergence.providerSandboxId, state: found.state as "running" | "paused", templateId: convergence.observedTemplateId, startedAt: convergence.observedStartedAt }
        : undefined);
    const state = await getProviderSandboxState(convergence.providerSandboxId);
    if (state.state !== "running") {
      throw new Error(`verifyTemplateAndRunning: provider sandbox state is "${state.state}", expected "running".`);
    }
    const templateReceipt = world.artifacts.template;
    const observedTemplateId = observed?.templateId ?? convergence.observedTemplateId;
    if (!observedTemplateId) {
      throw new Error(
        "verifyTemplateAndRunning: E2B reported no template id for the provider sandbox, so the sandbox's actual " +
          "template identity cannot be compared with the candidate receipt (spec step 4 requires provider-verified ids).",
      );
    }
    if (observedTemplateId !== templateReceipt.templateId) {
      throw new Error(
        `verifyTemplateAndRunning: the provider sandbox was spawned from template "${observedTemplateId}", not the ` +
          `candidate template "${templateReceipt.templateId}" (spec step 4: exact immutable template). A stale ` +
          "template alias would otherwise go green.",
      );
    }
    const runningSince = observed?.startedAt ?? convergence.observedStartedAt;
    return {
      templateId: observedTemplateId,
      buildId: templateReceipt.buildId,
      inputHash: templateReceipt.inputHash,
      // The genuine running interval comes from the provider's own start time,
      // not a local clock read (spec step 4: "a genuine running interval …
      // provider timing source recorded").
      runningSince: runningSince ?? new Date().toISOString(),
      timingSource: runningSince
        ? "e2b provider sandbox started_at (direct verification)"
        : "e2b provider sandbox state (direct verification; provider start time unavailable)",
    };
  },
  async verifyWorkerSupervisor(world, convergence) {
    // Whether the Worker enrolled is now asserted from the server's own
    // `cloud_runtime_worker` table (spec step 5) — there is no product API
    // exposing enrollment/heartbeat, and grepping in-sandbox `ps` cannot tell
    // an enrolled-and-heartbeating Worker from a process that merely started.
    // Bounded poll: `launch_worker_sidecar` enrolls asynchronously, so the row
    // can lag the sandbox otherwise being `running` by a few seconds.
    if (!world.box) {
      throw new Error(
        "verifyWorkerSupervisor: the managed-cloud world exposes no box-exec seam; the worker-enrollment " +
          "check must query the candidate box's own cloud_runtime_worker table.",
      );
    }
    await verifyWorkerEnrollmentOnServer(
      world.box,
      convergence.cloudSandboxId,
      workerEnrollmentPollTimeoutMs,
      workerEnrollmentPollIntervalMs,
    );

    // Whether the SUPERVISOR is that Worker's parent is DEFERRED to PR 9
    // (ruled 2026-07-15): on current main the fresh-provision path execs the
    // runtime directly and never launches the Supervisor
    // (build_detached_supervisor_launch_command has zero callers — see
    // Qualification Product Findings). PR 9 makes newly provisioned targets
    // Supervisor-parented and owns that assertion. PR 2 asserts only what the
    // current product provides: exactly one enrolled Worker + version identities.
    //
    // Binary locations come from the template's canonical bake destinations —
    // worker/supervisor live under /home/user/.proliferate/bin, not /home/user.
    const workerVersion = await exec(convergence.providerSandboxId, [
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.worker,
      "--version",
    ]);
    const supervisorVersion = await exec(convergence.providerSandboxId, [
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.supervisor,
      "--version",
    ]);
    const anyharnessVersion = await exec(convergence.providerSandboxId, [
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.anyharness,
      "--version",
    ]);

    // Exact-identity check (spec step 5 "…+hashes match the candidate receipts"
    // / MCW-003): sha256 each baked binary IN the sandbox and compare it to its
    // candidate-map receipt sha256. Version strings alone can collide across a
    // stale rebuild; the hash is the authoritative identity. A `--version`
    // match with a hash mismatch means the sandbox is running a DIFFERENT binary
    // than the candidate under test, which must fail rather than go green.
    await assertBinaryHashMatchesReceipt(
      exec,
      convergence.providerSandboxId,
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.anyharness,
      world.artifacts.anyharness.sha256,
      "anyharness",
    );
    await assertBinaryHashMatchesReceipt(
      exec,
      convergence.providerSandboxId,
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.worker,
      world.artifacts.worker.sha256,
      "worker",
    );
    await assertBinaryHashMatchesReceipt(
      exec,
      convergence.providerSandboxId,
      MANAGED_CLOUD_TEMPLATE_DESTINATIONS.supervisor,
      world.artifacts.supervisor.sha256,
      "supervisor",
    );

    return {
      workerVersion: observedVersionMatchingReceipt(workerVersion, world.artifacts.worker.version, "worker"),
      supervisorVersion: observedVersionMatchingReceipt(
        supervisorVersion,
        world.artifacts.supervisor.version,
        "supervisor",
      ),
      anyharnessVersion: observedVersionMatchingReceipt(
        anyharnessVersion,
        world.artifacts.anyharness.version,
        "anyharness",
      ),
      // Supervisor-parentage is PR 9's guarantee (see above); PR 2 does not
      // claim it. `false` records the honest current state in evidence.
      supervisorIsParent: false,
      heartbeatRecent: true,
      anyharnessHashMatchesReceipt: true,
      workerHashMatchesReceipt: true,
      supervisorHashMatchesReceipt: true,
    };
  },
  async verifyAnyharnessHealth(world, convergence) {
    if (!world.box) {
      throw new Error(
        "verifyAnyharnessHealth: the managed-cloud world exposes no box-exec seam; the runtime requires a " +
          "bearer token resolved from the candidate box's own DB.",
      );
    }
    const token = await resolveRuntimeBearerToken(world.box, convergence.cloudSandboxId);
    const health = await exec(
      convergence.providerSandboxId,
      curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents`),
    );
    if (!health.stdout.trim() || health.stdout.trim() === "[]") {
      throw new Error("verifyAnyharnessHealth: AnyHarness catalog is empty.");
    }
  },
  async verifyCoveredRepo(_world, convergence) {
    // The product materializes the covered repo under
    // <SANDBOX_REPOS_ROOT>/<owner>/<repo> = /home/user/workspace/repos/<owner>/<repo>
    // (materialization/paths.py `repo_path`), NOT /home/user/workspace.
    const repoDir = `${COVERED_REPO_CHECKOUT_ROOT}/${COVERED_REPO_OWNER}/${COVERED_REPO_NAME}`;
    const q = posixSingleQuote(repoDir);
    const remote = await exec(convergence.providerSandboxId, ["sh", "-c", `git -C ${q} remote get-url origin`]);
    if (remote.exitCode !== 0) {
      throw new Error(
        `verifyCoveredRepo: the covered repository is not a git checkout at ${repoDir} ` +
          `(git remote exit ${remote.exitCode}: ${remote.stderr.trim().slice(0, 200)}). The product did not ` +
          "materialize the covered repo where the materializer path resolves it (spec step 7).",
      );
    }
    if (/:[^@/]+@/.test(remote.stdout)) {
      throw new Error("verifyCoveredRepo: a credential appears in the remote URL.");
    }
    const commitResult = await exec(convergence.providerSandboxId, ["sh", "-c", `git -C ${q} rev-parse HEAD`]);
    const commit = commitResult.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) {
      throw new Error(`verifyCoveredRepo: could not read a HEAD commit from ${repoDir} (got "${commit.slice(0, 80)}").`);
    }

    // COMPARE the checked-out HEAD against the covered repo's pinned commit
    // (MCW-003), rather than trusting HEAD blindly. The product checks out the
    // remote's default branch (`git ls-remote --symref origin HEAD`, fallback
    // main — repo_environment.py), so the pinned commit is that same remote
    // ref's tip observed from inside the sandbox against the SAME origin the
    // product cloned (so the credential context matches).
    const pinnedResult = await exec(convergence.providerSandboxId, [
      "sh",
      "-c",
      `git -C ${q} ls-remote origin HEAD`,
    ]);
    const pinned = pinnedResult.stdout.trim().split(/\s+/)[0] ?? "";
    if (!/^[0-9a-f]{40}$/i.test(pinned)) {
      throw new Error(
        `verifyCoveredRepo: could not resolve the covered repo's pinned commit via ls-remote ` +
          `(git ls-remote exit ${pinnedResult.exitCode}: ${pinnedResult.stderr.trim().slice(0, 200)}).`,
      );
    }
    if (commit.toLowerCase() !== pinned.toLowerCase()) {
      throw new Error(
        `verifyCoveredRepo: the materialized checkout HEAD (${commit}) does not equal the covered repo's pinned ` +
          `commit (${pinned}) — a stale checkout would otherwise go green (spec step 7).`,
      );
    }
    return {
      name: `${COVERED_REPO_OWNER}/${COVERED_REPO_NAME}`,
      commit,
      noCredentialInRemote: true,
      commitMatchesPinned: true,
    };
  },
  allowlistModels: async (world) => {
    const preflight = await world.gateway.preflight();
    return preflight.eligibleClaudeModels;
  },
  async liveProbeModels(world, convergence, harnessKind) {
    if (!world.box) {
      throw new Error(
        "liveProbeModels: the managed-cloud world exposes no box-exec seam; the runtime requires a bearer " +
          "token resolved from the candidate box's own DB.",
      );
    }
    const token = await resolveRuntimeBearerToken(world.box, convergence.cloudSandboxId);
    // `POST /v1/agents/{kind}/catalog/refresh-gateway` — NOT the read-only
    // `GET .../catalog/gateway-models` (that endpoint can still answer
    // `source: "seed"`, the catalog's static defaults, when no probe row has
    // ever been recorded). A live probe is normally triggered by the desktop
    // pushing state via `PUT /agent-auth/state`
    // (`schedule_gateway_probes`, api/http/agent_auth.rs) — but the cloud
    // materializer writes `agent-auth/state.json` straight to the sandbox
    // filesystem (`materialize_agent_auth`), bypassing that endpoint entirely,
    // so nothing ever probes the gateway for a fresh cloud sandbox unless this
    // scenario forces it. `refresh-gateway` probes synchronously and returns
    // the raw, unfiltered model ids the gateway itself reports (`GET
    // {base_url}/v1/models`) — the exact ids-space the qualification allowlist
    // is drawn from, so the intersection in `selectCheapestEligibleClaudeModel`
    // is a plain exact-string match, not a format problem.
    //
    // Verified against the real route handler (RefreshGatewayResponse in
    // anyharness-lib/src/api/http/agent_gateway_catalog.rs): the body is a FLAT
    // `{ "models": ["<id>", ...], "probedAt": "<rfc3339>" }` — `models` is
    // `Vec<String>` (bare ids, NOT objects, NOT nested under `catalog`/`data`,
    // and there is no `source` field on this POST — that only exists on the GET
    // gateway-models plan). So `{models: string[]}` is the exact shape.
    //
    // It 400s (GATEWAY_REFRESH_NO_SELECTION / GATEWAY_REFRESH_NO_STATE) until
    // the materializer has written a gateway source into state.json, which runs
    // as part of the ASYNC `schedule_materialize_sandbox` background task
    // (github creds, secrets, per-repo preclone, THEN agent-auth, in that
    // order), and 502s (GATEWAY_REFRESH_PROBE_FAILED) if the probe itself
    // errors — so poll bounded rather than assume the sync already landed just
    // because the provider sandbox is "running".
    //
    // Surface the RAW refresh-gateway response (HTTP status + body, or a hard
    // curl exit) to the runner's stderr stream (the make log, NOT persisted
    // evidence) on each distinct non-returning attempt, so a probe that 400s,
    // 502s, returns 0 models, or an unexpected shape names itself — including
    // the exact runtime error CODE (`GATEWAY_REFRESH_NO_SELECTION` etc.) —
    // instead of being sanitized into the timeout `reason`. The bearer token
    // rides ONLY in the request header (`curlPostCaptureArgs`), never the
    // response body/stderr, so this cannot leak it. Deduplicated by signature so
    // ~24 identical polls log once (mirrors the `/ensure`-rejection dedup in
    // `completeAndConverge`). NB: a failed IN-SANDBOX curl surfaces here, not as
    // an `[e2b-verify]` line — the e2b probe subprocess exits 0 and reports the
    // inner curl's exit in `exitCode`, so its own error surfacing never fires
    // for a 400/502.
    const url = `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents/${harnessKind}/catalog/refresh-gateway`;
    const deadline = Date.now() + gatewayProbePollTimeoutMs;
    let lastFailure = "no attempt";
    let lastSurfaced = "";
    const surface = (line: string): void => {
      if (line === lastSurfaced) {
        return;
      }
      lastSurfaced = line;
      process.stderr.write(`[cloud-model-probe] ${line}\n`);
    };
    for (;;) {
      const probe = await exec(convergence.providerSandboxId, curlPostCaptureArgs(token, url));
      if (probe.exitCode !== 0) {
        // Non-zero curl exit means no HTTP response at all (connect/transport
        // failure), distinct from an HTTP error status. Surface the exit +
        // stderr and retry.
        lastFailure = `curl exited ${probe.exitCode}`;
        surface(`refresh-gateway exit=${probe.exitCode} stderr=${probe.stderr.trim().slice(0, 200)}`);
      } else {
        const { status, body } = splitBodyAndStatus(probe.stdout);
        if (status >= 200 && status < 300) {
          try {
            const parsed = JSON.parse(body) as { models?: unknown };
            if (Array.isArray(parsed.models)) {
              const models = parsed.models.filter((id): id is string => typeof id === "string");
              if (models.length > 0) {
                return models;
              }
              // 200 with zero models: the virtual key resolves to nothing on the
              // gateway. Retry (the sync may still be settling) and surface the
              // raw body so a persistent empty result is visible, not silently
              // blocked.
              lastFailure = "refresh-gateway returned 0 models";
            } else {
              lastFailure = 'refresh-gateway 2xx response had no "models" array';
            }
          } catch {
            lastFailure = "refresh-gateway 2xx response was not valid JSON";
          }
          surface(`refresh-gateway http=${status} body=${body.trim().slice(0, 600)}`);
        } else {
          // 400 (NO_SELECTION / NO_STATE / INCOMPLETE) or 502 (PROBE_FAILED):
          // the body carries the exact error code — surface it verbatim.
          lastFailure = `refresh-gateway http=${Number.isNaN(status) ? "?" : status}`;
          surface(`refresh-gateway http=${Number.isNaN(status) ? "?" : status} body=${body.trim().slice(0, 600)}`);
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `liveProbeModels: POST /v1/agents/${harnessKind}/catalog/refresh-gateway never returned a non-empty ` +
            `model list within ${gatewayProbePollTimeoutMs}ms (last: ${lastFailure}). The raw refresh-gateway ` +
            "response was surfaced to the runner log under [cloud-model-probe]. Either the cloud materialization " +
            "worker never synced the actor's gateway selection into the sandbox's agent-auth state (400), or the " +
            "gateway virtual key resolves to zero models (200 with an empty list).",
        );
      }
      await sleep(gatewayProbePollIntervalMs);
    }
  },
  async runGatewayTurn(world, actor, convergence, modelId, prompt, harnessKind) {
    // Reuses the PR 1 `productPage` fixture (renderer boot + session install)
    // pointed at this world's public candidate-API origin; the workspace shell
    // and composer DOM hooks (`data-home-composer-editor`,
    // `data-chat-send-button`, `data-composer-model-trigger`,
    // `data-workspace-shell`, `data-assistant-prose`) are the same components
    // Desktop renders for every launch kind (local/worktree/cloud/ssh) — see
    // `StandardWorkspaceShell.tsx` / `HomeComposerForm.tsx` /
    // `ComposerModelSelectorControl.tsx` — so `local-world-smoke-1`'s selectors
    // carry over unchanged. What differs from the local flow: by the time this
    // runs, the cloud sandbox already exists (spec step 3, `completeAndConverge`
    // already materialized it via the real authorization tail). The browser
    // lands on the home screen (fresh profile, nothing persisted); the send
    // itself is the product's real first-turn flow — it creates the cloud
    // workspace record for the covered repo and dispatches the prompt into the
    // actor's one personal sandbox (`ensureCloudLaunchTargetSelected` sets the
    // covered repo + "Cloud" runtime target first). Turn
    // completion is asserted from AnyHarness's own event stream INSIDE the
    // sandbox via `execInProviderSandbox` + an authenticated curl (there is no
    // host-reachable runtime client for the cloud world, unlike the local
    // world's `world.runtime.client`), mirroring `findErrorEvent`/`findTurnEndedEvent`.
    if (!world.box) {
      throw new Error(
        "runGatewayTurn: the managed-cloud world exposes no box-exec seam; cannot resolve the AnyHarness " +
          "runtime bearer token.",
      );
    }
    const token = await resolveRuntimeBearerToken(world.box, convergence.cloudSandboxId);

    // GATE the browser turn on the sandbox runtime's OWN launch-options
    // listing the harness with models (bounded poll; raw output surfaced under
    // [cloud-launch-options], and a per-agent `GET /v1/agents` readiness dump
    // on timeout). The home picker with a Cloud launch target reads the cloud
    // v2 catalog (not this endpoint), but the SEND launches the harness inside
    // the sandbox — dispatching before the runtime can launch it would fail
    // the turn. Waiting here makes the send deterministic.
    await waitForSandboxLaunchOptions(
      exec,
      convergence.providerSandboxId,
      token,
      harnessKind,
      launchOptionsPollTimeoutMs,
      launchOptionsPollIntervalMs,
    );

    const page = await productPage(asAuthenticatedActorWorld(world), actor);
    try {
      await ensureCloudLaunchTargetSelected(page);
      await selectModelInCloudComposer(page, modelId);
      // The home composer's explicit model selection is unpersisted component
      // state — no navigation/reload may happen between the selection above
      // and the send below (a reload silently reverts to the preference
      // default, sending a different model than the one this cell asserts).
      // Either composer surface is valid: the home composer (first turn from
      // the home screen) or the in-workspace composer (a prior send/reload
      // already opened the workspace) — both render the same editor contract.
      const editor = page.page
        .locator("[data-home-composer-editor], [data-chat-composer-editor]")
        .first();
      await editor.waitFor({ state: "visible", timeout: 15_000 });
      await editor.fill(prompt);
      const send = page.page.locator("[data-chat-send-button]:not([disabled])").first();
      try {
        await send.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        // The home composer prints WHY the send is disabled right under the
        // editor (`submitDisabledReason` — e.g. "Choose a base branch",
        // "Sign in to use cloud workspaces", "Loading cloud configuration").
        // Fold that into the failure so a disabled send names its gate
        // instead of a blind locator timeout.
        const disabledReason = await page.page
          .locator("[data-chat-send-button][disabled]")
          .first()
          .evaluate((button) => {
            const container = button.closest("form") ?? document.body;
            return (container.textContent ?? "").trim().slice(0, 400);
          })
          .catch(() => null);
        throw new Error(
          "runGatewayTurn: the composer send button never enabled within 15000ms. " +
            `Composer surface text: ${JSON.stringify(disabledReason ?? "unavailable")}.`,
        );
      }
      await send.click();

      // Positive dispatch signal, surfaced for diagnosis (make log, NOT
      // evidence): the shell's `data-workspace-session-id` goes non-empty the
      // moment the client optimistically activates the new session — so a
      // later empty `/v1/sessions` splits into "client never dispatched"
      // (attribute stayed empty) vs "dispatched but never reached the sandbox
      // runtime" (attribute set). The real assertion below stays the
      // sandbox-side session poll.
      let clientSessionId: string | null = null;
      const dispatchSignalDeadline = Date.now() + 30_000;
      while (Date.now() < dispatchSignalDeadline) {
        clientSessionId = await page.page
          .locator("[data-workspace-shell]")
          .first()
          .getAttribute("data-workspace-session-id")
          .catch(() => null);
        if (clientSessionId?.trim()) {
          break;
        }
        await sleep(1_000);
      }
      process.stderr.write(
        `[cloud-composer] post-send client session id: ${clientSessionId?.trim() ? "set" : "EMPTY"} — ` +
          `${clientSessionId?.trim() ? "the client dispatched a session" : "the client-side send never activated a session"}.\n`,
      );

      const sessionId = await resolveActiveSandboxSessionId(
        exec,
        convergence.providerSandboxId,
        token,
        SANDBOX_READY_TIMEOUT_MS,
      );
      const completion = await waitForSandboxTurnCompletion(
        exec,
        convergence.providerSandboxId,
        sessionId,
        token,
        TURN_TIMEOUT_MS,
      );
      if (completion.error) {
        throw new Error(`runGatewayTurn: assistant turn errored: ${completion.error}`);
      }
      if (!completion.ended) {
        throw new Error(`runGatewayTurn: assistant turn did not end within ${TURN_TIMEOUT_MS}ms.`);
      }
      const reply = await readAssistantReplyFromPage(page.page, 20_000);
      return { reply };
    } catch (uiError) {
      // Env-gated cloud browser-turn diagnostics: dump the DOM/screenshot, the
      // console+network sinks, and the exact cloud-repo-list gate inputs (/meta
      // capability contract + /v1/cloud/repositories) so a "no Project row" /
      // composer break names its true layer without a live browser. Never on
      // the green path; best-effort so it never masks the real error.
      await captureCloudTurnFailure(page, actor, "cloud-turn-ui-failure");
      throw uiError;
    } finally {
      await page.close().catch(() => undefined);
    }
  },
  snapshotSpend: (world, actor) => world.gateway.snapshotSpend(actor.gatewayKey),
  correlateTurn: (world, params) =>
    world.gateway.correlateTurn({
      actor: params.actor.gatewayKey,
      before: params.before,
      acceptedModelId: params.acceptedModelId,
      windowStartedAt: params.windowStartedAt,
      windowFinishedAt: params.windowFinishedAt,
    }),
  async verifyActorBIsolation(world, actorB, convergence) {
    // (1) Product-level discovery: actor B's OWN authenticated listing must not
    // reveal actor A's sandbox. Actor B is a real, independent user (invited),
    // so this is the genuine cross-tenant read. `GET /v1/cloud/cloud-sandbox`
    // returns actor B's own personal sandbox (or 404) — never actor A's. Derive
    // the boolean from the OBSERVED response: any body that surfaces actor A's
    // provider/cloud sandbox id fails the check.
    let actorBCannotDiscover = true;
    try {
      const listing = await actorB.api.get<{ id?: string; providerSandboxId?: string } | null>(
        "/v1/cloud/cloud-sandbox",
      );
      const serialized = JSON.stringify(listing ?? {});
      if (serialized.includes(convergence.cloudSandboxId) || serialized.includes(convergence.providerSandboxId)) {
        actorBCannotDiscover = false;
      }
    } catch (error) {
      // A 404 (actor B has no sandbox) is the expected isolation outcome; any
      // other status is an unexpected error, not a silent pass.
      if (!(typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404)) {
        throw error;
      }
    }
    if (!actorBCannotDiscover) {
      throw new Error(
        "verifyActorBIsolation: actor B's product listing surfaced actor A's sandbox id — cross-tenant isolation " +
          "is broken (spec step 9).",
      );
    }

    const runtimeUrl = `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents`;

    // (2) Missing-credential: an UNAUTHENTICATED request to the bearer-guarded
    // runtime must be rejected (the runtime is launched with
    // `--require-bearer-auth`). Derive the boolean from the OBSERVED status.
    const missingProbe = await exec(convergence.providerSandboxId, curlGetStatusNoAuthArgs(runtimeUrl));
    const { status: missingCredentialStatus } = splitBodyAndStatus(missingProbe.stdout);
    const runtimeRejectsMissing = missingProbe.exitCode === 0 && missingCredentialStatus === 401;

    // (3) Actor-B credential: the runtime must reject actor B's PRODUCT bearer
    // (it is not the sandbox's own runtime token). A product session token is
    // not a valid AnyHarness runtime bearer, so the runtime must answer 401.
    const actorBProbe = await exec(
      convergence.providerSandboxId,
      curlGetStatusWithBearerArgs(actorB.session.access_token, runtimeUrl),
    );
    const { status: actorBCredentialStatus } = splitBodyAndStatus(actorBProbe.stdout);
    const runtimeRejectsActorB = actorBProbe.exitCode === 0 && actorBCredentialStatus === 401;

    if (!runtimeRejectsMissing) {
      throw new Error(
        `verifyActorBIsolation: the direct runtime did not reject an unauthenticated request with 401 ` +
          `(observed status ${Number.isNaN(missingCredentialStatus) ? "unparseable" : missingCredentialStatus}, ` +
          `curl exit ${missingProbe.exitCode}) — spec step 9.`,
      );
    }
    if (!runtimeRejectsActorB) {
      throw new Error(
        `verifyActorBIsolation: the direct runtime did not reject actor B's product credential with 401 ` +
          `(observed status ${Number.isNaN(actorBCredentialStatus) ? "unparseable" : actorBCredentialStatus}, ` +
          `curl exit ${actorBProbe.exitCode}) — spec step 9.`,
      );
    }

    return {
      actorBCannotDiscover,
      runtimeRejectsMissing,
      runtimeRejectsActorB,
      missingCredentialStatus,
      actorBCredentialStatus,
    };
  },
  closeWorld: (world) => world.close(),
  };
}

/** Production singleton — `createCloudProvision1Driver()` with the real E2B exec seam. */
export const defaultCloudProvision1Driver: CloudProvision1Driver = createCloudProvision1Driver();

async function writeSecretEnvFile(dir: string, fileName: string, values: Record<string, string>): Promise<string> {
  const filePath = path.join(dir, fileName);
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await writeFile(filePath, `${body}\n`, { mode: 0o600 });
  return filePath;
}

/**
 * The real per-cell orchestration, independent of the matrix plumbing so it is
 * directly unit-testable against a fake `CloudProvision1Driver`. Builds the
 * world first; if construction inputs are missing or startup fails, the cell
 * fails cleanly (spec failure table) rather than throwing out of `runCells`.
 * World `close()` always runs exactly once, and its cleanup evidence is folded
 * into the green evidence block (or reported alongside a failure that reached
 * that point).
 */
export async function runCloudProvision1Cell(
  cell: PlannedCellV1,
  ctx: ScenarioRunContext,
  driver: CloudProvision1Driver,
): Promise<ScenarioCellOutcomeWithEvidence> {
  const inputs = resolveWorldConstructionInputs(ctx);
  if (!inputs.ok) {
    return { cellId: cell.cell_id, status: "failed", reason: { code: "scenario_failure", message: inputs.reason } };
  }

  let world: ManagedCloudWorld;
  try {
    world = await driver.buildWorld(inputs.value);
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: `world construction failed: ${describe(error)}` },
    };
  }

  const harnessKind = cell.dimensions.harness ?? REPRESENTATIVE_HARNESS;
  let worldClosed = false;
  try {
    const actor = await driver.createActor(world);
    await driver.fundCore(world, actor);
    // Enrol the actor's server-minted LiteLLM key + user + team into the
    // world's cleanup stack as soon as the key identity is resolved, so world
    // close() deletes them and populates the required evidence booleans.
    await driver.trackActorSubjects(world, actor);

    let boundary: GithubAuthorizationBoundary;
    try {
      boundary = await driver.authorizeGithub(world, actor);
    } catch (error) {
      if (error instanceof ScenarioBlockedError) {
        return { cellId: cell.cell_id, status: "blocked", reason: { code: "scenario_blocked", message: error.reason } };
      }
      throw error;
    }

    const convergence = await driver.completeAndConverge(world, actor, boundary);
    const templateVerification = await driver.verifyTemplateAndRunning(world, convergence);
    const workerVerification = await driver.verifyWorkerSupervisor(world, convergence);
    await driver.verifyAnyharnessHealth(world, convergence);
    const coveredRepo = await driver.verifyCoveredRepo(world, convergence);

    const [allowlist, liveProbe] = await Promise.all([
      driver.allowlistModels(world),
      driver.liveProbeModels(world, convergence, harnessKind),
    ]);
    const modelId = selectCheapestEligibleClaudeModel(allowlist, liveProbe);
    if (!modelId) {
      return {
        cellId: cell.cell_id,
        status: "blocked",
        reason: {
          code: "scenario_blocked",
          message:
            "no eligible non-Fable Claude model in the intersection of the qualification allowlist " +
            "and the sandbox's live gateway probe",
        },
      };
    }

    const before = await driver.snapshotSpend(world, actor);
    const windowStartedAt = new Date().toISOString();
    const { reply } = await driver.runGatewayTurn(
      world,
      actor,
      convergence,
      modelId,
      DETERMINISTIC_PROMPT,
      harnessKind,
    );
    if (!reply.trim()) {
      throw new Error("empty assistant reply");
    }
    const windowFinishedAt = new Date().toISOString();

    const correlated = await driver.correlateTurn(world, {
      actor,
      before,
      acceptedModelId: modelId,
      windowStartedAt,
      windowFinishedAt,
    });

    const actorB = await driver.createSecondActor(world, actor);
    // Actor B minted her own LiteLLM key/user/team on enrollment — enrol them
    // into the world's cleanup stack so world close() deletes them too.
    await driver.trackActorSubjects(world, actorB);
    const isolation = await driver.verifyActorBIsolation(world, actorB, convergence);

    const artifactIds = [
      world.artifacts.server.artifact_id,
      world.artifacts.anyharness.artifact_id,
      world.artifacts.worker.artifact_id,
      world.artifacts.supervisor.artifact_id,
      world.artifacts.credentialHelper.artifact_id,
      world.artifacts.desktopRenderer.artifact_id,
      world.artifacts.template.artifact_id,
      world.artifacts.candidateApi.artifact_id,
    ];

    const cleanup = await driver.closeWorld(world);
    worldClosed = true;

    const evidence: CloudProvisionTurnEvidenceV1 = {
      kind: "cloud_provision_turn",
      artifact_ids: artifactIds,
      server_version: world.artifacts.server.version,
      anyharness_version: workerVerification.anyharnessVersion,
      worker_version: workerVerification.workerVersion,
      supervisor_version: workerVerification.supervisorVersion,
      harness: "claude",
      model_id: modelId,
      template: {
        template_id: templateVerification.templateId,
        build_id: templateVerification.buildId,
        input_hash: templateVerification.inputHash,
      },
      sandbox_id_hash: sha256Hex(convergence.providerSandboxId),
      worker: {
        supervisor_is_parent: workerVerification.supervisorIsParent,
        heartbeat_recent: workerVerification.heartbeatRecent,
      },
      covered_repo: {
        name: coveredRepo.name,
        commit: coveredRepo.commit,
        no_credential_in_remote: coveredRepo.noCredentialInRemote,
      },
      isolation: {
        // Derived from OBSERVED responses (MCW-001), not hard-coded: actor B's
        // product listing did not reveal actor A's sandbox, AND the direct
        // runtime rejected both the missing-credential and actor-B-credential
        // probes. `verifyActorBIsolation` already throws unless all three hold,
        // so reaching here means every one was observed true.
        actor_b_denied:
          isolation.actorBCannotDiscover && isolation.runtimeRejectsMissing && isolation.runtimeRejectsActorB,
        runtime_rejects_missing: isolation.runtimeRejectsMissing,
        runtime_rejects_actor_b: isolation.runtimeRejectsActorB,
      },
      litellm: {
        token_id_hash: correlated.tokenIdHash,
        request_ids: correlated.requestIds,
        window_started_at: correlated.windowStartedAt,
        window_finished_at: correlated.windowFinishedAt,
        prompt_tokens: correlated.promptTokens,
        completion_tokens: correlated.completionTokens,
        total_tokens: correlated.totalTokens,
        spend_usd: correlated.spendUsd,
      },
      cleanup: {
        ledger_id_hash: cleanup.ledgerIdHash,
        registered: cleanup.registered,
        reconciled: cleanup.reconciled,
        failed: cleanup.failed,
        sandboxes_deleted: cleanup.sandboxesDeleted,
        template_deleted: cleanup.templateDeleted,
        template_custody_transferred: cleanup.templateCustodyTransferred === true,
        dns_record_deleted: cleanup.dnsRecordDeleted,
        ec2_terminated: cleanup.ec2Terminated,
        security_group_deleted: cleanup.securityGroupDeleted,
        key_pair_deleted: cleanup.keyPairDeleted,
        virtual_key_deleted: cleanup.virtualKeyDeleted,
        litellm_subjects_deleted: cleanup.litellmSubjectsDeleted,
        local_paths_removed: cleanup.localPathsRemoved,
      },
    };

    // Cleanup failure means the cell cannot remain green (spec failure table).
    if (cleanup.failed > 0 || !allCleanupBooleansTrue(cleanup)) {
      return {
        cellId: cell.cell_id,
        status: "failed",
        reason: { code: "scenario_failure", message: `cleanup did not fully reconcile (failed=${cleanup.failed})` },
        evidence,
      };
    }

    return { cellId: cell.cell_id, status: "green", evidence };
  } catch (error) {
    return {
      cellId: cell.cell_id,
      status: "failed",
      reason: { code: "scenario_failure", message: describe(error) },
    };
  } finally {
    if (!worldClosed) {
      await driver.closeWorld(world!).catch(() => undefined);
    }
  }
}

function allCleanupBooleansTrue(cleanup: {
  sandboxesDeleted: boolean;
  templateDeleted: boolean;
  templateCustodyTransferred?: boolean;
  dnsRecordDeleted: boolean;
  ec2Terminated: boolean;
  securityGroupDeleted: boolean;
  keyPairDeleted: boolean;
  virtualKeyDeleted: boolean;
  litellmSubjectsDeleted: boolean;
  localPathsRemoved: boolean;
}): boolean {
  return (
    cleanup.sandboxesDeleted &&
    cleanup.templateDeleted !== (cleanup.templateCustodyTransferred === true) &&
    cleanup.dnsRecordDeleted &&
    cleanup.ec2Terminated &&
    cleanup.securityGroupDeleted &&
    cleanup.keyPairDeleted &&
    cleanup.virtualKeyDeleted &&
    cleanup.litellmSubjectsDeleted &&
    cleanup.localPathsRemoved
  );
}

type WorldConstructionInputs =
  | { ok: true; value: CloudProvision1ConstructionInputs }
  | { ok: false; reason: string };

/**
 * Reads the world-construction inputs off the bridge context (see module
 * doc). Returns a typed failure instead of throwing so the cell can report a
 * clean `failed` outcome. `runDir` is scoped with a `cloud-provision-1/<cell>`
 * suffix so a run-scoped secrets directory never collides with a sibling cell.
 */
export function resolveWorldConstructionInputs(ctx: ScenarioRunContext): WorldConstructionInputs {
  const map = ctx.candidateBuildMap;
  if (!map) {
    return { ok: false, reason: "no candidate build map was supplied to this run; the cell cannot start a world" };
  }
  if (!ctx.runIdentity) {
    return { ok: false, reason: "no run identity was threaded into the scenario context" };
  }
  if (!ctx.runDir) {
    return { ok: false, reason: "no run/shard-scoped run directory was threaded into the scenario context" };
  }
  try {
    const adminBaseUrl = ctx.env.require("AGENT_GATEWAY_LITELLM_BASE_URL");
    const publicBaseUrl = ctx.env.require("AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL");
    const masterKey = ctx.env.require("AGENT_GATEWAY_LITELLM_MASTER_KEY");
    const e2bApiKey = ctx.env.require("RELEASE_E2E_E2B_API_KEY");
    const e2bTeamId = ctx.env.require("RELEASE_E2E_E2B_TEAM_ID");
    const region = ctx.env.require("RELEASE_E2E_CLOUD_AWS_REGION");
    const hostedZoneId = ctx.env.require("RELEASE_E2E_CLOUD_ROUTE53_ZONE_ID");
    const githubAppId = ctx.env.require("RELEASE_E2E_CLOUD_GITHUB_APP_ID");
    const githubClientId = ctx.env.require("RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID");
    const githubInstallationId = ctx.env.require("RELEASE_E2E_CLOUD_GITHUB_APP_INSTALLATION_ID");
    const githubPrivateKey = ctx.env.require("RELEASE_E2E_CLOUD_GITHUB_APP_PRIVATE_KEY");
    const githubClientSecret = ctx.env.require("RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET");
    const certificateBase64 = ctx.env.require("RELEASE_E2E_QUALIFICATION_TLS_CERTIFICATE_B64");
    const privateKeyBase64 = ctx.env.require("RELEASE_E2E_QUALIFICATION_TLS_PRIVATE_KEY_B64");
    return {
      ok: true,
      value: {
        map,
        litellm: { adminBaseUrl, publicBaseUrl, masterKey },
        run: ctx.runIdentity,
        runDir: ctx.runDir,
        aws: {
          region,
          hostedZoneId,
          zoneName: "qualification.proliferate.com",
          instanceType: "t3.small",
          // Bare SSM parameter name (resolveImageId calls `ssm get-parameters --names`
          // directly — the `resolve:ssm:` prefix is EC2 RunInstances ImageId syntax and
          // must not appear here). Matches the proven selfhost-box.sh precedent.
          imageRef: "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
        },
        e2bTeamId,
        e2bApiKey,
        tls: { certificateBase64, privateKeyBase64 },
        github: {
          appId: githubAppId,
          clientId: githubClientId,
          installationId: githubInstallationId,
          privateKey: githubPrivateKey,
          clientSecret: githubClientSecret,
        },
      },
    };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

/** The resolved inputs the automated GitHub refresh-seed needs (names only in docs). */
interface BotSeedForAutomation {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Where the rotated refresh token is persisted back after a live seed (local file). */
  seedFilePath: string;
  /** Which durable store the CURRENT token came from (governs where the rotated one is written). */
  source: BotSeedSource;
  /** The AWS SSM SecureString parameter the durable rotation writes to. */
  ssmParameterName: string;
  /** Explicit AWS region for the SSM read/write (the CI job maps RELEASE_E2E_CLOUD_AWS_REGION, not AWS_REGION). */
  region?: string;
}

/**
 * Resolves the D2 bot seed + staging App OAuth creds for the automated GitHub
 * refresh-seed, or `null` when any piece is missing (→ manual-assist locally /
 * blocked-honest in Actions). Resolution order for the refresh token (MCW-004):
 *
 *   1. `RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN` (env)  → source "env"
 *   2. the local seed file (`RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE`
 *      override, else the default path)                   → source "file"
 *   3. AWS SSM Parameter Store SecureString
 *      (`RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_SSM_PARAMETER` override, else the
 *      default parameter name)                            → source "ssm"
 *
 * The SSM lane is the only durable home for the ephemeral Actions runner: env
 * and local file do not survive there, and GitHub rotates the token on every
 * use. Async because the SSM read shells out. Never logs a token value.
 */
export async function resolveBotSeedForAutomation(
  env: NodeJS.ProcessEnv = process.env,
  // Injectable so unit tests never shell out to real `aws` for the SSM lane.
  getFromSsm: typeof getBotRefreshTokenFromSsm = getBotRefreshTokenFromSsm,
): Promise<BotSeedForAutomation | null> {
  const clientId = env.RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  const seedFilePath = env.RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE?.trim() || DEFAULT_BOT_SEED_PATH;
  const ssmParameterName =
    env.RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_SSM_PARAMETER?.trim() || DEFAULT_BOT_SEED_SSM_PARAMETER;
  // The CI job maps RELEASE_E2E_CLOUD_AWS_REGION (not the aws-CLI-native
  // AWS_REGION), so the SSM read/write must be told the region explicitly —
  // exactly like ec2.ts's resolveImageId. Omitted locally → ambient region.
  const region = env.RELEASE_E2E_CLOUD_AWS_REGION?.trim() || undefined;

  let refreshToken = env.RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN?.trim() || "";
  let source: BotSeedSource | null = refreshToken ? "env" : null;

  if (!refreshToken) {
    try {
      const raw = JSON.parse(readFileSync(seedFilePath, "utf8")) as { refresh_token?: unknown };
      if (typeof raw.refresh_token === "string" && raw.refresh_token.trim()) {
        refreshToken = raw.refresh_token.trim();
        source = "file";
      }
    } catch {
      // No seed file → try the durable SSM lane below.
    }
  }

  if (!refreshToken) {
    const ssm = await getFromSsm(ssmParameterName, undefined, region);
    if (ssm.refreshToken !== null) {
      refreshToken = ssm.refreshToken;
      source = "ssm";
    } else {
      // Raw diagnostic to the runner stream (make log, NOT evidence) so an
      // Actions run that falls through to blocked-honest names WHY the durable
      // seed was unavailable instead of a silent fallback. Never logs a value.
      process.stderr.write(`[cloud-bot-seed] SSM lane unavailable: ${ssm.reason}\n`);
    }
  }

  if (!refreshToken || !source) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, seedFilePath, source, ssmParameterName, region };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Parses the sha256 hex out of a coreutils `sha256sum <path>` line (`<hex>  <path>`). */
function parseSha256Sum(stdout: string): string | null {
  const match = stdout.trim().match(/^([0-9a-f]{64})\b/i);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Hashes a baked binary IN the sandbox (`sha256sum <path>`) and asserts it
 * equals the candidate-map receipt sha256 (spec step 5 / MCW-003). Throws on a
 * mismatch, an unreadable binary, or unparseable output — never records an
 * unverified `true`.
 */
async function assertBinaryHashMatchesReceipt(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  binaryPath: string,
  expectedSha256: string,
  label: string,
): Promise<void> {
  const result = await exec(providerSandboxId, ["sha256sum", binaryPath]);
  if (result.exitCode !== 0) {
    throw new Error(
      `assertBinaryHashMatchesReceipt: could not sha256 the ${label} binary at ${binaryPath} in the sandbox ` +
        `(sha256sum exit ${result.exitCode}: ${result.stderr.trim().slice(0, 200)}).`,
    );
  }
  const observed = parseSha256Sum(result.stdout);
  if (!observed) {
    throw new Error(
      `assertBinaryHashMatchesReceipt: sha256sum produced no parseable digest for the ${label} binary ` +
        `(stdout: ${result.stdout.trim().slice(0, 200)}).`,
    );
  }
  if (observed !== expectedSha256.toLowerCase()) {
    throw new Error(
      `assertBinaryHashMatchesReceipt: the in-sandbox ${label} binary sha256 (${observed}) does not match its ` +
        `candidate receipt (${expectedSha256}). The sandbox is running a different ${label} than the candidate ` +
        "under test (spec step 5 requires hashes to match the candidate receipts).",
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escapes a value for safe interpolation inside a `[attr="…"]` CSS selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * The exact home Project-menu row selector for the covered cloud-only repo. The
 * row carries `data-repo-source-root="<sourceRoot>"` (HomeProjectMenu.tsx); a
 * cloud-only repo's sourceRoot is `cloud:<owner>/<repo>` (repositories.ts). Used
 * for a deterministic click instead of a fuzzy getByText fallback.
 */
export function coveredRepoSourceRootSelector(): string {
  return `[data-repo-source-root="${cssAttr(`cloud:${COVERED_REPO_OWNER}/${COVERED_REPO_NAME}`)}"]`;
}

/**
 * Env-gated (`MANAGED_CLOUD_SMOKE_DEBUG_DIR`) failure capture for the cloud
 * browser turn — the managed-cloud analogue of `local-world-smoke-1`'s
 * `captureUiFailure`. CLOUD-PROVISION-1's browser step previously threw only its
 * error text, so a "no Project row" / composer break could not be root-caused
 * without a live browser (attempts 2–3 blind spot). This dumps, best-effort:
 *
 *   - the live rendered DOM + a full-page screenshot at the failure point;
 *   - the browser console + non-2xx/failed network log (now populated in the
 *     cloud lane because `productPage` honours this lane's debug dir); and
 *   - the two exact inputs to the home cloud-repo list gate: the server's public
 *     `/meta` capability contract (`cloudWorkspaces` / `managedCloud.status` /
 *     `githubRepositoryAccess.status` — the client's `cloudActive` factor) and
 *     the actor's own `/v1/cloud/repositories` listing (the rows the menu is
 *     built from). Together these disambiguate a server gate (cloudWorkspaces
 *     false) from a client readiness/selector issue (gate true, row present).
 *
 * A no-op off the debug dir, so it never touches the green path; every written
 * string is scrubbed of secret shapes. It never throws — diagnostics must not
 * mask the real failure.
 */
async function captureCloudTurnFailure(page: ProductPage, actor: AuthenticatedActor, label: string): Promise<void> {
  const dir = resolveDiagnosticsDir();
  if (!dir) {
    return;
  }
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const nodePath = await import("node:path");
    mkdirSync(dir, { recursive: true });
    const stamp = `${label.replace(/[^A-Za-z0-9._-]+/g, "-")}-${Date.now()}`;
    writeFileSync(
      nodePath.join(dir, `${stamp}.html`),
      scrubSecretText(await page.page.content().catch(() => "<no content>")),
    );
    await page.page
      .screenshot({ path: nodePath.join(dir, `${stamp}.png`), fullPage: true })
      .catch(() => undefined);
    writeFileSync(nodePath.join(dir, `${stamp}.console.txt`), scrubSecretText(page.debug.console.join("\n")));
    writeFileSync(nodePath.join(dir, `${stamp}.network.txt`), scrubSecretText(page.debug.network.join("\n")));
    // The exact cloud-repo-list gate inputs. `/meta` is the public capability
    // contract (unauthenticated); `/v1/cloud/repositories` needs the actor
    // bearer. Capture both outcomes (value or error) so the layer names itself.
    const meta = await actor.api
      .get<unknown>("/meta")
      .then((value) => ({ ok: true, value }))
      .catch((error: unknown) => ({ ok: false, error: describe(error) }));
    const repos = await actor.api
      .get<unknown>("/v1/cloud/repositories")
      .then((value) => ({ ok: true, value }))
      .catch((error: unknown) => ({ ok: false, error: describe(error) }));
    writeFileSync(
      nodePath.join(dir, `${stamp}.gate.json`),
      scrubSecretText(JSON.stringify({ meta, cloud_repositories: repos }, null, 2)),
    );
  } catch {
    // Diagnostics are best-effort; never let a capture failure mask the error.
  }
}

/**
 * Brings the browser to a state where the composer can dispatch a turn into
 * the actor's cloud sandbox. Two observed states are valid:
 *
 *   1. A workspace is already open (Desktop rehydrated a prior selection): the
 *      in-workspace composer (`data-chat-composer-editor`) is live.
 *   2. The home screen: select the covered repo + the "Cloud" runtime option
 *      (`HomeTargetPicker.tsx`). Selecting the runtime sets the launch TARGET
 *      only — no workspace opens until the send itself, which is the product's
 *      real first-turn flow: the home send creates the cloud workspace and
 *      dispatches the prompt into the personal sandbox.
 *
 * The prior revision early-returned when `[data-workspace-shell]` with
 * `data-pending-workspace="false"` was attached — but `StandardWorkspaceShell`
 * renders that outer div UNCONDITIONALLY (the home screen swaps in as its
 * CONTENT), so the check passed on the home screen without ever selecting the
 * Cloud runtime. The composer then sat on the persisted default launch kind
 * ("worktree" — a LOCAL target, and this world has no local runtime): the
 * model picker read the empty local launch-options (the observed empty `[]`
 * picker) and a send dispatched a local launch that never touched the sandbox
 * (the observed persistently-empty `/v1/sessions`). It also waited for a
 * workspace shell right after picking the runtime, which never opens one.
 */
async function ensureCloudLaunchTargetSelected(page: ProductPage): Promise<void> {
  const p = page.page;
  const deadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
  for (;;) {
    // Home's rich editor also has data-chat-composer-editor, so classify home
    // first and use the exclusive workspace selector below. The opposite order
    // silently skipped Project + Runtime selection after the rich-composer
    // migration and left the picker on the unavailable local target.
    if (await p.locator(HOME_COMPOSER_EDITOR_SELECTOR).first().isVisible().catch(() => false)) {
      break;
    }
    if (await p.locator(WORKSPACE_COMPOSER_EDITOR_SELECTOR).first().isVisible().catch(() => false)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "ensureCloudLaunchTargetSelected: neither the home composer nor an open workspace composer became " +
          `visible within ${SANDBOX_READY_TIMEOUT_MS}ms.`,
      );
    }
    await sleep(1_000);
  }

  await clickByRole(p, "button", /^Project:/, "home Project picker trigger");
  // Deterministic covered-repo selection: the home Project menu renders each row
  // with `data-repo-source-root="<sourceRoot>"` (HomeProjectMenu.tsx), where a
  // cloud-only repo's sourceRoot is `cloud:<owner>/<repo>` (repositories.ts).
  // Click that exact row — NOT a fuzzy getByText, which can no-op / mis-click for
  // the cloud-only repo and leave destination on "cowork" so the Runtime button
  // (rendered only when destination === "repository") never mounts (the observed
  // regression red).
  const coveredRepoRow = p.locator(coveredRepoSourceRootSelector()).first();
  try {
    await coveredRepoRow.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    throw new Error(
      `ensureCloudLaunchTargetSelected: the covered cloud-only repo row ` +
        `(${coveredRepoSourceRootSelector()}) never appeared in the home Project menu within 20000ms — the ` +
        "covered cloud-only repo is not listed for this actor (cloudActive gating or a repo_environment listing " +
        "gap; see use-cloud-availability-state.ts). The Runtime picker is downstream of this selection, so this " +
        "names the true failing layer rather than a Runtime-row timeout.",
    );
  }
  await coveredRepoRow.click();
  // Assert the Project selection settled (destination flipped to "repository")
  // BEFORE touching Runtime: the Project row's aria-label becomes
  // "Project: <repo>" (homeTargetProjectAriaLabel) and the Runtime button mounts
  // only in that state. Without this wait the next clickByRole(/^Runtime:/) can
  // race a not-yet-mounted button.
  try {
    await p
      .getByRole("button", { name: new RegExp(`^Project: ${COVERED_REPO_NAME}`) })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const observed = await p
      .getByRole("button", { name: /^Project:/ })
      .first()
      .getAttribute("aria-label")
      .catch(() => null);
    throw new Error(
      `ensureCloudLaunchTargetSelected: the home Project row did not settle on "Project: ${COVERED_REPO_NAME}" ` +
        `(observed: ${observed ?? "no Project row"}) — destination never flipped to "repository", so the Runtime ` +
        "picker (rendered only for a repository destination) would not mount.",
    );
  }
  await clickByRole(p, "button", /^Runtime:/, "home Runtime picker trigger");
  await clickMenuItemByText(p, "Cloud", '"Cloud" runtime option');
  // Postcondition: the runtime row must settle on exactly "Runtime: Cloud"
  // (`homeTargetRuntimeAriaLabel`). The row shows "Cloud unavailable" /
  // "Configure cloud" when the cloud connection or the repo_environment
  // precondition is missing — a real product-state gap this run must name
  // instead of sending into whatever target was previously persisted.
  try {
    await p
      .getByRole("button", { name: /^Runtime: Cloud$/ })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const observed = await p
      .getByRole("button", { name: /^Runtime:/ })
      .first()
      .getAttribute("aria-label")
      .catch(() => null);
    throw new Error(
      'ensureCloudLaunchTargetSelected: the home Runtime row did not settle on "Runtime: Cloud" ' +
        `(observed: ${observed ?? "no Runtime row"}) — the covered repo is not cloud-launchable for this actor.`,
    );
  }
}

/**
 * Selects `modelId` in the composer's model picker; identical DOM contract to
 * `local-world-smoke-1`'s `selectModelInUi` (`ComposerModelSelectorControl`
 * renders the same `data-composer-model-trigger`/`data-model-option` hooks on
 * both the home and in-workspace composers).
 *
 * Source of the menu: with the home Runtime target set to "Cloud"
 * (`ensureCloudLaunchTargetSelected`), the picker is fed by the cloud v2
 * catalog registries alone (`use-home-next-model-selection.ts` passes the
 * local runtime's launch options as `null` for a cloud launch target), so it
 * populates as soon as `GET /v1/agents/catalog` resolves — it does NOT wait on
 * the sandbox runtime. The pre-turn `waitForSandboxLaunchOptions` gate still
 * matters for the SEND (the sandbox must be able to launch the harness), but
 * the picker itself has no sandbox dependency. The failure message folds the
 * available `data-model-option` values and composer state into the error so a
 * genuine mismatch names itself. `pickerOpened=false` means the trigger never
 * enabled, which is distinct from an opened picker with zero options and must
 * not be reported as though the menu was inspected.
 *
 * A bounded periodic reload remains as the safety net for a cold catalog
 * query. IMPORTANT: the home composer's explicit model selection is plain
 * component state (`HomeNextScreen`'s `modelSelectionOverride`) — a reload
 * WIPES it — so this function must fully succeed (select + observe the
 * trigger reflect the selection) with no reload afterwards; the caller sends
 * immediately after this returns, with no intervening navigation.
 */
async function selectModelInCloudComposer(page: ProductPage, modelId: string): Promise<void> {
  const p = page.page;
  const start = Date.now();
  const deadline = start + MODEL_PICKER_TIMEOUT_MS;
  const optionSelector = `[data-model-option="${cssAttr(modelId)}"]`;
  let lastAvailable: Array<string | null> = [];
  let pickerOpened = false;
  let lastComposerState = await readCloudComposerUiState(page);
  const RELOAD_EVERY_MS = 30_000;
  let lastReloadAt = start;
  let surfacedEmpty = false;
  while (Date.now() < deadline) {
    const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
    try {
      await trigger.waitFor({ state: "visible", timeout: 5_000 });
      await trigger.click();
    } catch {
      lastComposerState = await readCloudComposerUiState(page);
      if (!cloudComposerTargetSelectionIsStable(lastComposerState)) {
        throw new Error(
          "selectModelInCloudComposer: the home composer lost its already-verified Cloud launch target before " +
            `the model trigger enabled. Observed composer state: ${JSON.stringify(lastComposerState)}.`,
        );
      }
      await sleep(1_500);
      continue;
    }
    pickerOpened = true;
    const option = p.locator(optionSelector).first();
    if (await option.count().catch(() => 0)) {
      await option.click();
      await p
        .locator(`[data-composer-model-trigger][data-composer-selected-model="${cssAttr(modelId)}"]`)
        .first()
        .waitFor({ state: "attached", timeout: 10_000 });
      return;
    }
    lastAvailable = await p
      .locator("[data-model-option]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-model-option")))
      .catch(() => []);
    lastComposerState = await readCloudComposerUiState(page);
    // Surface an empty picker once to the runner log (make log, NOT evidence):
    // with the Cloud launch target selected this menu comes from the cloud v2
    // catalog, so an [] means the catalog query has not resolved (or lists
    // nothing for this actor) — distinct from any sandbox-side gap.
    if (lastAvailable.length === 0 && !surfacedEmpty) {
      surfacedEmpty = true;
      process.stderr.write(
        "[cloud-composer] model picker empty; the cloud catalog query has not surfaced models yet — " +
          "reloading to remount it.\n",
      );
    }
    await p.keyboard.press("Escape").catch(() => undefined);
    if (Date.now() - lastReloadAt > RELOAD_EVERY_MS) {
      lastReloadAt = Date.now();
      await p.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      // A reload resets the home target selection UI state; re-establish the
      // Cloud launch target before retrying the picker. A failed reselection is
      // a more precise product-state boundary than the eventual generic model
      // timeout, so preserve it instead of swallowing it.
      try {
        await ensureCloudLaunchTargetSelected(page);
      } catch (error) {
        lastComposerState = await readCloudComposerUiState(page);
        throw new Error(
          "selectModelInCloudComposer: after a cold-catalog reload, the Cloud launch target could not be " +
            `re-established: ${describe(error)} Observed composer state: ` +
            `${JSON.stringify(lastComposerState)}.`,
        );
      }
    }
    await sleep(2_000);
  }
  lastComposerState = await readCloudComposerUiState(page);
  throw new Error(
    `selectModelInCloudComposer: model "${modelId}" was not offered by the composer picker within ` +
      `${MODEL_PICKER_TIMEOUT_MS}ms. Picker opened: ${pickerOpened}. ` +
      `Last available options: ${JSON.stringify(lastAvailable)}. ` +
      `Last composer state: ${JSON.stringify(lastComposerState)}.`,
  );
}

interface CloudComposerUiState {
  homeComposerVisible: boolean;
  workspaceComposerVisible: boolean;
  modelTriggerPresent: boolean;
  modelTriggerDisabled: boolean | null;
  modelTriggerText: string | null;
  selectedModel: string | null;
  projectAriaLabel: string | null;
  runtimeAriaLabel: string | null;
}

export function cloudComposerTargetSelectionIsStable(
  state: Pick<
    CloudComposerUiState,
    "homeComposerVisible" | "projectAriaLabel" | "runtimeAriaLabel"
  >,
): boolean {
  return !state.homeComposerVisible
    || (
      state.projectAriaLabel === `Project: ${COVERED_REPO_NAME}`
      && state.runtimeAriaLabel === "Runtime: Cloud"
    );
}

/**
 * Bounded, secret-free browser-state receipt for model-picker failures. This
 * intentionally records only stable composer hooks and aria labels: it makes
 * "trigger never enabled" and "picker opened but model absent" distinguishable
 * without placing the page body or actor data in runner output/evidence.
 */
async function readCloudComposerUiState(page: ProductPage): Promise<CloudComposerUiState> {
  return page.page.evaluate(() => {
    const trigger = document.querySelector<HTMLButtonElement>("[data-composer-model-trigger]");
    const ariaButton = (prefix: string): HTMLButtonElement | null =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
        .find((button) => button.getAttribute("aria-label")?.startsWith(prefix)) ?? null;
    return {
      homeComposerVisible: document.querySelector("[data-home-composer-editor]") !== null,
      workspaceComposerVisible:
        document.querySelector("[data-chat-composer-editor]:not([data-home-composer-editor])") !== null,
      modelTriggerPresent: trigger !== null,
      modelTriggerDisabled: trigger ? trigger.disabled : null,
      modelTriggerText: trigger?.textContent?.trim().slice(0, 120) || null,
      selectedModel: trigger?.getAttribute("data-composer-selected-model") || null,
      projectAriaLabel: ariaButton("Project:")?.getAttribute("aria-label") ?? null,
      runtimeAriaLabel: ariaButton("Runtime:")?.getAttribute("aria-label") ?? null,
    };
  }).catch(() => ({
    homeComposerVisible: false,
    workspaceComposerVisible: false,
    modelTriggerPresent: false,
    modelTriggerDisabled: null,
    modelTriggerText: null,
    selectedModel: null,
    projectAriaLabel: null,
    runtimeAriaLabel: null,
  }));
}

/**
 * Resolves the AnyHarness native session id for the sandbox's one active
 * workspace by exec'ing an authenticated curl into the sandbox (there is no
 * host-reachable runtime client for the cloud world; `execInProviderSandbox`
 * is the only seam). Reuses the same `/v1/sessions` shape as the local
 * world's `LocalRuntimeClient.listSessions` (`local-runtime.ts`), just
 * reached over the sandbox's loopback instead of a forwarded port.
 */
async function resolveActiveSandboxSessionId(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  token: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  // Self-diagnosing on timeout (mirrors [cloud-launch-options]/[cloud-model-probe]):
  // a blind "no session in 300s" hides WHY. Surface each distinct raw
  // /v1/sessions outcome to the runner log (make log, NOT evidence) so a
  // persistent empty list (browser send never dispatched a turn to this
  // sandbox) is distinguishable from an auth/transport error. The bearer token
  // rides only in the request header (curlWithBearerArgs), never surfaced.
  let lastFailure = "no attempt";
  let lastSurfaced = "";
  const surface = (line: string): void => {
    if (line === lastSurfaced) {
      return;
    }
    lastSurfaced = line;
    process.stderr.write(`[cloud-session] ${line}\n`);
  };
  while (Date.now() < deadline) {
    const result = await exec(
      providerSandboxId,
      curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/sessions`),
    ).catch(() => null);
    if (result && result.exitCode !== 0) {
      lastFailure = `sessions curl exited ${result.exitCode}`;
      surface(`curl exit=${result.exitCode} stderr=${result.stderr.trim().slice(0, 200)}`);
    } else if (result?.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout) as { sessions?: Array<{ id: string }> } | Array<{ id: string }>;
        const sessions = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
        if (sessions.length > 0) {
          return sessions[sessions.length - 1]!.id;
        }
        lastFailure = "sessions list is empty (no turn dispatched to this sandbox yet)";
        surface(`empty session list: ${result.stdout.trim().slice(0, 300)}`);
      } catch {
        lastFailure = "sessions response was not valid JSON";
        surface(`invalid JSON: ${result.stdout.trim().slice(0, 300)}`);
      }
    }
    await sleep(1_000);
  }
  throw new Error(
    `resolveActiveSandboxSessionId: no AnyHarness session materialized within ${timeoutMs}ms (last: ${lastFailure}). ` +
      "The raw /v1/sessions outcome was surfaced to the runner log under [cloud-session]: a persistently empty list " +
      "means the product UI send never started a session in this sandbox (the disclosed unverified browser→cloud " +
      "turn path), distinct from an auth/transport error.",
  );
}

/**
 * Polls the sandbox's own AnyHarness event stream (over `execInProviderSandbox`
 * + an authenticated curl) for `turn_ended`/`error`, mirroring
 * `findErrorEvent`/`findTurnEndedEvent` (`local-runtime.ts`) against the same
 * event shape.
 */
async function waitForSandboxTurnCompletion(
  exec: typeof execInProviderSandbox,
  providerSandboxId: string,
  sessionId: string,
  token: string,
  timeoutMs: number,
): Promise<{ ended: boolean; error: string | undefined }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await exec(
      providerSandboxId,
      curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/sessions/${sessionId}/events?limit=200`),
    ).catch(() => null);
    if (result?.stdout.trim()) {
      try {
        const events = JSON.parse(result.stdout) as Array<{ event: { type: string; message?: string } }>;
        const errorEvent = events.find((entry) => entry.event.type === "error");
        if (errorEvent) {
          return { ended: true, error: String(errorEvent.event.message ?? "unknown error") };
        }
        if (events.some((entry) => entry.event.type === "turn_ended")) {
          return { ended: true, error: undefined };
        }
      } catch {
        // fall through to retry
      }
    }
    await sleep(1_000);
  }
  return { ended: false, error: undefined };
}

/**
 * Waits for a non-streaming assistant prose block to carry non-empty text and
 * returns the last one's trimmed content (the final assistant answer). Same
 * DOM contract as `local-world-smoke-1`'s `readAssistantReply`.
 */
async function readAssistantReplyFromPage(page: ProductPage["page"], timeoutMs: number): Promise<string> {
  const settled = page.locator('[data-assistant-prose][data-assistant-streaming="false"]').last();
  await settled.waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const text = (await settled.textContent().catch(() => null)) ?? "";
  return text.trim();
}

async function clickByRole(page: ProductPage["page"], role: "button", name: RegExp, what: string): Promise<void> {
  const locator = page.getByRole(role, { name }).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (role=${role}, name=${name}): ${describe(error)}`);
  }
  await locator.click();
}

/** Clicks a popover menu row by its visible text (menu rows are native buttons). */
async function clickMenuItemByText(page: ProductPage["page"], text: string, what: string): Promise<void> {
  const byRole = page.getByRole("button", { name: text, exact: false }).first();
  if (await byRole.count().catch(() => 0)) {
    await byRole.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    if (await byRole.isVisible().catch(() => false)) {
      await byRole.click();
      return;
    }
  }
  const byText = page.getByText(text, { exact: false }).first();
  try {
    await byText.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    throw new Error(`could not find ${what} (text="${text}"): ${describe(error)}`);
  }
  await byText.click();
}
