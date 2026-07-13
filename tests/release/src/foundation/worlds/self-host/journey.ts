/**
 * Composed self-host vertical slice: `SH-INSTALL-CLAIM` + `SH-BASE-TURN`
 * (specs/developing/testing/tier-3-scenario-contract.md "Self-Host World").
 * Consumes the `PreparedSelfHostWorld` returned by
 * `SelfHostWorldProvisioner.prepareFull()` — the world handle only reserves
 * capacity; every install/claim/turn action below is this journey's job.
 * Orchestrates the focused action modules rather than reimplementing them:
 * `install-claim.ts` (install + claim + second-claim rejection),
 * `agent-gateway-client.ts` (store/select the run-scoped user API key and
 * fetch the compiled local-surface state document — the real product path),
 * `local-anyharness.ts` (the run-scoped local runtime process), and the
 * shared `fixtures/local-runtime.ts` client (workspace/session/turn).
 *
 * `SH-INSTALL-CLAIM`: production installer against the disposable instance ->
 * real TLS + /health + /meta -> read the setup token via SSH -> owner claim
 * through /setup -> assert permanent second-claim rejection.
 *
 * `SH-BASE-TURN` (best-effort in this first slice — see the two documented
 * gaps below): Desktop server connection/login -> store a run-scoped user API
 * key through the product -> one representative user-key agent turn.
 *
 * Known, recorded gaps (do not claim `SH-DESKTOP-OWNER`):
 *   1. "Desktop connection" here drives the exact HTTP contract Desktop's
 *      auth flow calls (`GET /auth/desktop/methods`,
 *      `POST /auth/desktop/password/login`, both exercised by
 *      `claimSelfHostOwner`) rather than an actual rendered Desktop web-port
 *      browser session or native Tauri automation. Real browser-driven
 *      web-port automation (Playwright against `apps/desktop` pointed at this
 *      instance) and native Tauri connect/relaunch/keychain automation both
 *      remain required gaps for a full `SH-DESKTOP-OWNER` claim.
 *   2. The representative agent turn runs a real local AnyHarness process on
 *      the machine driving this test (this IS the Desktop-local runtime
 *      contract: self-host base install has no cloud add-on, so the harness
 *      always runs beside Desktop, never on the EC2 instance), authenticated
 *      via the real product flow: `POST /v1/cloud/agent-gateway/keys` (store)
 *      -> `PUT /v1/cloud/agent-gateway/selections/{harness}?surface=local`
 *      (select) -> `GET /v1/cloud/agent-gateway/state?surface=local` (compile)
 *      -> `PUT /v1/agent-auth/state` on the local runtime (the same push
 *      Desktop performs). It requires a locally built `anyharness` binary
 *      (`cargo build -p anyharness`) and the harness's own CLI reachable on
 *      PATH; this slice does not build Desktop itself.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import type { ExecFn } from "./aws-cli.js";
import type { DisposableInstance } from "./instance.js";
import type { PreparedSelfHostWorld } from "./provisioner.js";
import type { DevSelfHostBundle } from "./dev-candidate-bundle.js";
import { installCandidateBundle, claimSelfHostOwner } from "./install-claim.js";
import { AgentGatewayClient, pushAgentAuthState } from "./agent-gateway-client.js";
import { startLocalAnyharness } from "./local-anyharness.js";
import { LocalRuntimeClient, findTurnEndedEvent, findLastAssistantReply } from "../../../fixtures/local-runtime.js";

export interface SelfHostJourneyOptions {
  readonly exec: ExecFn;
  readonly repoRoot: string;
  readonly runId: string;
  /** Raw provider key for the representative harness's user-key turn. Never logged. */
  readonly providerApiKey: string;
  readonly harnessKind?: string;
  /** Path to the locally built anyharness binary. */
  readonly anyharnessBinPath: string;
  readonly log?: (line: string) => void;
}

export interface SelfHostJourneyResult {
  readonly publicUrl: string;
  readonly serverVersion: string;
  readonly ownerEmail: string;
  readonly secondClaimRejected: boolean;
  readonly desktopConnection: { readonly methodsAdvertisePassword: boolean; readonly loggedIn: boolean };
  readonly storedApiKeyId: string;
  readonly agentTurn: {
    readonly harnessKind: string;
    readonly sessionId: string;
    readonly completed: boolean;
    readonly reply: string | null;
  };
  readonly correlationIds: string[];
}

function target(instance: DisposableInstance): { keyPath: string; sshUser: string; publicIp: string } {
  return { keyPath: instance.keyPath, sshUser: instance.sshUser, publicIp: instance.publicIp };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
    server.on("error", reject);
  });
}

/** Waits for real public HTTPS /health at the instance's DNS name. */
async function waitForPublicHealth(publicUrl: string, attempts = 30, intervalMs = 5000): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${publicUrl}/health`);
      if (res.ok) return;
    } catch {
      // keep polling — TLS issuance/DNS propagation can take a few cycles.
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitForPublicHealth: ${publicUrl}/health never became healthy`);
}

/** Runs the full composed vertical slice and always tears the world down via the ledger, whatever happens. */
export async function runSelfHostVerticalSlice(
  prepared: PreparedSelfHostWorld,
  bundle: DevSelfHostBundle,
  options: SelfHostJourneyOptions,
): Promise<SelfHostJourneyResult> {
  const log = options.log ?? (() => {});
  const harnessKind = options.harnessKind ?? "claude";
  const correlationIds: string[] = [];
  let localRuntime: Awaited<ReturnType<typeof startLocalAnyharness>> | null = null;

  try {
    // ---- SH-INSTALL-CLAIM ----
    await installCandidateBundle({
      exec: options.exec,
      target: target(prepared.instance),
      repoRoot: options.repoRoot,
      imageTarPath: bundle.tarPath,
      imageTag: bundle.imageTag,
      log,
    });

    const publicUrl = `https://${prepared.instance.dnsName}`;
    await waitForPublicHealth(publicUrl);
    const metaRes = await fetch(`${publicUrl}/meta`);
    const meta = (await metaRes.json()) as { serverVersion?: string };
    if (!metaRes.ok || !meta.serverVersion) {
      throw new Error(`/meta did not report a serverVersion: ${metaRes.status} ${JSON.stringify(meta)}`);
    }
    log(`[install] /meta serverVersion=${meta.serverVersion}`);

    const claim = await claimSelfHostOwner({
      exec: options.exec,
      target: target(prepared.instance),
      baseUrl: publicUrl,
      runId: options.runId,
    });
    log(`[claim] owner claimed and second-claim permanently rejected: ${claim.ownerEmail}`);

    // ---- SH-BASE-TURN ----
    const gateway = new AgentGatewayClient({ baseUrl: publicUrl, bearerToken: claim.accessToken });
    const apiKey = await gateway.createApiKey("release-e2e self-host user key", options.providerApiKey);
    correlationIds.push(`agent-gateway-key:${apiKey.id}`);
    await gateway.selectApiKeyForHarness(harnessKind, "local", apiKey.id);
    log(`[byok] stored + selected run-scoped user API key ${apiKey.id} for ${harnessKind}/local`);
    const stateDocument = await gateway.getState("local");

    localRuntime = await startLocalAnyharness({
      binaryPath: options.anyharnessBinPath,
      runtimeHome: await mkdtemp(join(tmpdir(), "selfhost-e2e-runtime-")),
      port: await freePort(),
      runId: options.runId,
      ledger: prepared.ledger,
      owningWorld: "self-host",
      log,
    });
    await pushAgentAuthState(localRuntime.baseUrl, stateDocument);
    log("[byok] pushed compiled local-surface state document to the local runtime");

    const runtimeClient = new LocalRuntimeClient({ baseUrl: localRuntime.baseUrl });
    await runtimeClient.installAgent(harnessKind).catch((error) => {
      log(`[agent] installAgent(${harnessKind}) reported ${(error as Error).message} — continuing (may already be installed)`);
    });

    const scratchRepo = await mkdtemp(join(tmpdir(), "selfhost-e2e-repo-"));
    await options.exec("git", ["-C", scratchRepo, "init", "-q"]);
    await writeFile(join(scratchRepo, "README.md"), "# release-e2e self-host scratch repo\n", "utf8");
    await options.exec("git", ["-C", scratchRepo, "add", "."]);
    await options.exec("git", [
      "-C",
      scratchRepo,
      "-c",
      "user.email=e2e@proliferate.dev",
      "-c",
      "user.name=release-e2e",
      "commit",
      "-q",
      "-m",
      "init",
    ]);

    const { workspace } = await runtimeClient.createLocalWorkspace(scratchRepo);
    const session = await runtimeClient.createSession({ workspaceId: workspace.id, agentKind: harnessKind });
    correlationIds.push(`session:${session.id}`);
    await runtimeClient.prompt(session.id, "Reply with exactly the single word: ok");
    const finalSession = await runtimeClient.waitForIdle(session.id, { timeoutMs: 120_000 });
    const events = await runtimeClient.getEvents(session.id);
    const turnEnded = findTurnEndedEvent(events);
    const reply = findLastAssistantReply(events) ?? null;
    log(
      `[turn] session=${session.id} status=${finalSession.status} turnEnded=${Boolean(turnEnded)} reply=${JSON.stringify(reply)}`,
    );

    return {
      publicUrl,
      serverVersion: meta.serverVersion,
      ownerEmail: claim.ownerEmail,
      secondClaimRejected: true,
      desktopConnection: { methodsAdvertisePassword: true, loggedIn: true },
      storedApiKeyId: apiKey.id,
      agentTurn: { harnessKind, sessionId: session.id, completed: Boolean(turnEnded), reply },
      correlationIds,
    };
  } finally {
    if (localRuntime) await localRuntime.stop().catch(() => {});
    const reconciliation = await prepared.ledger.reconcile();
    log(
      `[teardown] cleanup reconciliation: attempted=${reconciliation.attempted} cleaned=${reconciliation.cleaned} ` +
        `failed=${reconciliation.failed.length} complete=${reconciliation.complete}`,
    );
    if (!reconciliation.complete) {
      log(`[teardown] WARNING: incomplete cleanup — ${JSON.stringify(reconciliation.failed.map((f) => f.resourceId))}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
