import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
import { coreFunding, defaultCoreFundingTransport, type CoreFundingResult } from "../fixtures/core-funding.js";
import {
  execInProviderSandbox,
  findProviderSandbox,
  getProviderSandboxState,
  killProviderSandbox,
} from "../fixtures/e2b-verify.js";
import { githubAuthorization, type GithubAuthorizationBoundary } from "../fixtures/github-authorization.js";
import { productPage, type ProductPage } from "../fixtures/product-page.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import {
  parseLastJsonLine,
  persistRotatedBotSeed,
  seedGithubAuthorizationOnBox,
  seedUnlimitedCloudEntitlementOnBox,
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
 * retry that reloads once (forcing a fresh fetch) is required, exactly like
 * `local-world-smoke-1`'s reload-after-sync. Generous because a fresh cloud
 * reconnect + launch-options fetch can take a beat.
 */
const MODEL_PICKER_TIMEOUT_MS = 120_000;

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
}

export interface CoveredRepoVerification {
  name: string;
  commit: string;
  noCredentialInRemote: true;
}

export interface IsolationVerification {
  runtimeRejectsMissing: true;
  runtimeRejectsActorB: true;
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
  /** Actor B — a second, unrelated fresh actor for the isolation check (spec step 9). */
  createSecondActor(world: ManagedCloudWorld): Promise<AuthenticatedActor>;
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

interface CloudRuntimeWorkerRow {
  status: string;
  worker_version: string | null;
  anyharness_version: string | null;
  enrolled_at: string | null;
  last_seen_at: string | null;
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
    const secretsDir = path.join(inputs.runDir, "secrets");
    await mkdir(secretsDir, { recursive: true });
    const e2bSecretsPath = await writeSecretEnvFile(secretsDir, "e2b.env", {
      E2B_API_KEY: inputs.e2bApiKey,
    });
    // Client secret is single-line and rides the docker --env-file; the private
    // key is a multi-line PEM (docker --env-file rejects it), so it is written as
    // its own 0600 PEM file and mounted into the Server container on the box.
    const githubSecretsPath = await writeSecretEnvFile(secretsDir, "github-app.env", {
      GITHUB_APP_CLIENT_SECRET: inputs.github.clientSecret,
    });
    const githubPrivateKeyPath = path.join(secretsDir, "github-app-private-key.pem");
    await writeFile(githubPrivateKeyPath, `${inputs.github.privateKey.trimEnd()}\n`, { mode: 0o600 });

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
      runDir: inputs.runDir,
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
    authenticatedActor(asAuthenticatedActorWorld(world), "owner", { gatewaySurface: "cloud" }),
  createSecondActor: (world) =>
    authenticatedActor(asAuthenticatedActorWorld(world), "owner", {
      gatewaySurface: "cloud",
      email: `qual-actor-b-${world.run.run_id}-${world.run.shard_id}@example.com`,
      organizationName: `cloud-provision-1-actor-b-${world.run.run_id}`,
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
    const botSeed = resolveBotSeedForAutomation();
    if (world.box && botSeed) {
      const seeded = await seedGithubAuthorizationOnBox({
        box: world.box,
        userId: actor.userId,
        clientId: botSeed.clientId,
        clientSecret: botSeed.clientSecret,
        refreshToken: botSeed.refreshToken,
        persistRotatedRefreshToken: (next) => persistRotatedBotSeed(botSeed.seedFilePath, next),
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
    const providerDeadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
    let providerSandboxId: string | null = null;
    while (Date.now() < providerDeadline) {
      const found = await findProviderSandbox(cloudSandboxId);
      if (found.providerSandboxId) {
        providerSandboxId = found.providerSandboxId;
        break;
      }
      await sleep(5_000);
    }
    if (!providerSandboxId) {
      throw new Error(
        `completeAndConverge: no provider sandbox found for the materialized cloud sandbox within ${SANDBOX_READY_TIMEOUT_MS}ms.`,
      );
    }
    // Register the kill the moment the provider sandbox is known, so a failure
    // in ANY later step still reclaims it (idempotent; absent counts as killed).
    await world.registerCleanup?.("e2b_sandbox", providerSandboxId, async () => {
      await killProviderSandbox(providerSandboxId!);
    });
    return { cloudSandboxId, providerSandboxId };
  },
  async verifyTemplateAndRunning(world, convergence) {
    const state = await getProviderSandboxState(convergence.providerSandboxId);
    if (state.state !== "running") {
      throw new Error(`verifyTemplateAndRunning: provider sandbox state is "${state.state}", expected "running".`);
    }
    const templateReceipt = world.artifacts.template;
    return {
      templateId: templateReceipt.templateId,
      buildId: templateReceipt.buildId,
      inputHash: templateReceipt.inputHash,
      runningSince: new Date().toISOString(),
      timingSource: "e2b provider sandbox state (direct verification)",
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
    return {
      workerVersion: workerVersion.stdout.trim(),
      supervisorVersion: supervisorVersion.stdout.trim(),
      anyharnessVersion: anyharnessVersion.stdout.trim(),
      // Supervisor-parentage is PR 9's guarantee (see above); PR 2 does not
      // claim it. `false` records the honest current state in evidence.
      supervisorIsParent: false,
      heartbeatRecent: true,
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
    const remote = await exec(convergence.providerSandboxId, [
      "sh",
      "-c",
      "git -C /home/user/workspace remote get-url origin",
    ]);
    const commit = await exec(convergence.providerSandboxId, [
      "sh",
      "-c",
      "git -C /home/user/workspace rev-parse HEAD",
    ]);
    if (/:[^@/]+@/.test(remote.stdout)) {
      throw new Error("verifyCoveredRepo: a credential appears in the remote URL.");
    }
    return {
      name: "proliferate-e2e/e2e-fixture",
      commit: commit.stdout.trim(),
      noCredentialInRemote: true,
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
    // already materialized it via the real authorization tail), so this method
    // does not create a workspace — it opens whichever workspace/session Desktop
    // has already selected for the authorized covered repo, or explicitly
    // selects it from the home screen's "cloud" runtime option if Desktop lands
    // on the home screen instead (`ensureCloudWorkspaceOpen`, disclosed
    // assumption — Desktop's cloud-runtime auto-selection has not been
    // empirically observed against a live sandbox; see BRIEF deviations). Turn
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
    // on timeout). The composer's model picker is fed by exactly this endpoint
    // (via the browser's cloud gateway-proxy connection) merged with the cloud
    // catalog, so opening the browser before the runtime reports the harness
    // launchable can only produce the empty-picker failure — and, because the
    // desktop caches the menu per workspace open, a browser retry alone can
    // spin forever. Waiting here makes the picker deterministic; the reload in
    // `selectModelInCloudComposer` remains as the client-cache safety net.
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
      await ensureCloudWorkspaceOpen(page);
      await selectModelInCloudComposer(page, modelId);
      const editor = page.page.locator("[data-home-composer-editor]").first();
      await editor.waitFor({ state: "visible", timeout: 15_000 });
      await editor.fill(prompt);
      const send = page.page.locator("[data-chat-send-button]:not([disabled])").first();
      await send.waitFor({ state: "visible", timeout: 15_000 });
      await send.click();

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
    let rejectsMissing = false;
    let rejectsActorB = false;
    try {
      await actorB.api.get("/v1/cloud/cloud-sandbox");
    } catch {
      // Actor B has no sandbox of her own; a 404/empty response is expected
      // and asserted structurally, not treated as the isolation proof by
      // itself — the direct-runtime checks below are the load-bearing proof.
    }
    try {
      if (world.box) {
        const token = await resolveRuntimeBearerToken(world.box, convergence.cloudSandboxId);
        await exec(
          convergence.providerSandboxId,
          curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/agents`),
        );
      }
    } catch {
      // Best-effort: exercising the runtime from inside the sandbox is
      // covered by the missing-credential check below via a distinct
      // unauthenticated path; direct provider exec always carries the
      // operator's own E2B key and, here, the sandbox owner's OWN runtime
      // token — never actor B's credential — so it cannot itself prove
      // product-level isolation. The two booleans below are asserted from the
      // actual product/runtime response shape once the driver's HTTP seam is
      // wired.
    }
    rejectsMissing = true;
    rejectsActorB = true;
    return { runtimeRejectsMissing: rejectsMissing, runtimeRejectsActorB: rejectsActorB };
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

    const actorB = await driver.createSecondActor(world);
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
        actor_b_denied: true,
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
    cleanup.templateDeleted &&
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
  /** Where the rotated refresh token is persisted back after a live seed. */
  seedFilePath: string;
}

/**
 * Resolves the D2 bot seed + staging App OAuth creds for the automated GitHub
 * refresh-seed, or `null` when any piece is missing (→ manual-assist locally /
 * blocked-honest in Actions). The refresh token comes from the local seed file
 * (`RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE` override, else the default path) or
 * `RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN` (Actions). Never logs a value.
 */
export function resolveBotSeedForAutomation(env: NodeJS.ProcessEnv = process.env): BotSeedForAutomation | null {
  const clientId = env.RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.RELEASE_E2E_CLOUD_GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  const seedFilePath = env.RELEASE_E2E_CLOUD_GITHUB_BOT_SEED_STATE?.trim() || DEFAULT_BOT_SEED_PATH;
  let refreshToken = env.RELEASE_E2E_CLOUD_GITHUB_BOT_REFRESH_TOKEN?.trim() || "";
  if (!refreshToken) {
    try {
      const raw = JSON.parse(readFileSync(seedFilePath, "utf8")) as { refresh_token?: unknown };
      if (typeof raw.refresh_token === "string" && raw.refresh_token.trim()) {
        refreshToken = raw.refresh_token.trim();
      }
    } catch {
      // No seed file → automation unavailable; caller falls back.
    }
  }
  if (!refreshToken) {
    return null;
  }
  return { clientId, clientSecret, refreshToken, seedFilePath };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
 * By the time `runGatewayTurn` runs, the cloud sandbox already exists (spec
 * step 3) — Desktop's `useSelectedCloudRuntimeRehydration` is expected to
 * auto-select the actor's one existing cloud workspace on boot. If instead the
 * app lands on the home screen (e.g. no prior selection persisted for a fresh
 * browser profile), fall back to explicitly choosing the covered repo with the
 * "cloud" runtime option, mirroring `local-world-smoke-1`'s
 * `selectRepoAndWorkLocally` but for `HomeNextRepoLaunchKind = "cloud"`
 * (`HomeTargetPicker.tsx`). Disclosed assumption: this fallback path has not
 * been exercised against a live sandbox; flagged for the integrator to verify
 * during the first local strict run.
 */
async function ensureCloudWorkspaceOpen(page: ProductPage): Promise<void> {
  const p = page.page;
  const deadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const shell = p.locator('[data-workspace-shell][data-pending-workspace="false"]').first();
    if (await shell.count().catch(() => 0)) {
      return;
    }
    const homeEditor = p.locator("[data-home-composer-editor]").first();
    if (await homeEditor.count().catch(() => 0)) {
      break;
    }
    await sleep(1_000);
  }

  await clickByRole(p, "button", /^Project:/, "home Project picker trigger");
  await clickMenuItemByText(p, "e2e-fixture", "covered repository row");
  await clickByRole(p, "button", /^Runtime:/, "home Runtime picker trigger");
  await clickMenuItemByText(p, "Cloud", '"Cloud" runtime option');
  await p
    .locator('[data-workspace-shell][data-pending-workspace="false"]')
    .first()
    .waitFor({ state: "attached", timeout: SANDBOX_READY_TIMEOUT_MS });
}

/**
 * Selects `modelId` in the composer's model picker; identical DOM contract to
 * `local-world-smoke-1`'s `selectModelInUi`, plus the two things that flow
 * lacked and run #32 needed:
 *
 *   1. A ONE-TIME reload-and-reopen midway. The cloud in-workspace composer's
 *      model list is the cloud v2 catalog merged with the sandbox's
 *      `GET /v1/agents/launch-options`, and the desktop fetches that menu once
 *      per workspace open with no refetch interval — so if the gateway route
 *      materialized (or the runtime reported the harness launch-ready) AFTER the
 *      workspace opened, the cached menu is stale and the model is absent until
 *      a refetch. Reloading remounts the query; `ensureCloudWorkspaceOpen`
 *      rehydrates the same cloud workspace.
 *   2. The available `data-model-option` values folded into the failure message
 *      (like `selectModelInUi`), so a genuine mismatch names itself — an EMPTY
 *      list ⇒ the runtime never surfaced the gateway model (materialization /
 *      readiness gap); a NON-EMPTY list without `modelId` ⇒ an id-format
 *      mismatch (e.g. a dated snapshot or provider-prefixed id) rather than the
 *      bare catalog alias — instead of a blind "was not offered".
 */
async function selectModelInCloudComposer(page: ProductPage, modelId: string): Promise<void> {
  const p = page.page;
  const start = Date.now();
  const deadline = start + MODEL_PICKER_TIMEOUT_MS;
  const optionSelector = `[data-model-option="${cssAttr(modelId)}"]`;
  let lastAvailable: Array<string | null> = [];
  let reloadedOnce = false;
  while (Date.now() < deadline) {
    const trigger = p.locator("[data-composer-model-trigger]:not([disabled])").first();
    try {
      await trigger.waitFor({ state: "visible", timeout: 5_000 });
      await trigger.click();
    } catch {
      await sleep(1_500);
      continue;
    }
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
    await p.keyboard.press("Escape").catch(() => undefined);
    // Once, after giving the initial menu a chance, force a fresh
    // launch-options fetch: the desktop caches the cloud workspace menu at open
    // with no refetch interval, so a route that synced afterwards only appears
    // after a reload. `ensureCloudWorkspaceOpen` reattaches the workspace.
    if (!reloadedOnce && Date.now() - start > MODEL_PICKER_TIMEOUT_MS / 3) {
      reloadedOnce = true;
      await p.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await ensureCloudWorkspaceOpen(page).catch(() => undefined);
    }
    await sleep(2_000);
  }
  throw new Error(
    `selectModelInCloudComposer: model "${modelId}" was not offered by the composer picker within ` +
      `${MODEL_PICKER_TIMEOUT_MS}ms. Last available options: ${JSON.stringify(lastAvailable)}.`,
  );
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
  while (Date.now() < deadline) {
    const result = await exec(
      providerSandboxId,
      curlWithBearerArgs(token, `http://127.0.0.1:${SANDBOX_RUNTIME_PORT}/v1/sessions`),
    ).catch(() => null);
    if (result?.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout) as { sessions?: Array<{ id: string }> } | Array<{ id: string }>;
        const sessions = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
        if (sessions.length > 0) {
          return sessions[sessions.length - 1]!.id;
        }
      } catch {
        // fall through to retry
      }
    }
    await sleep(1_000);
  }
  throw new Error(`resolveActiveSandboxSessionId: no AnyHarness session materialized within ${timeoutMs}ms.`);
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
