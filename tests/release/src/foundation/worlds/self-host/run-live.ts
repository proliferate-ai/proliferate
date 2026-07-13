/**
 * Manual live-proof entrypoint for the self-host world (not part of `pnpm
 * test`; not auto-discovered — invoked directly with `npx tsx run-live.ts`
 * from `tests/release`). Provisions one real disposable EC2 instance,
 * installs the exact candidate self-host bundle, claims the owner, asserts
 * permanent second-claim rejection, and attempts the SH-BASE-TURN tail
 * (store+select a run-scoped user API key, push agent-auth state, one real
 * agent turn) — reporting that tail `blocked` rather than fabricating it if
 * no real provider credential is available locally. Always tears down via
 * the cleanup ledger, whatever happens.
 *
 * Requires: AWS credentials (ambient `aws` CLI config) able to create a
 * throwaway key pair/security group/instance in the default VPC; Docker
 * running locally (candidate bundle build); a locally built `anyharness`
 * binary (`cargo build -p anyharness`, or set ANYHARNESS_BIN_PATH).
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type { WorldContext } from "../../contracts/world.js";
import type { CandidateManifest } from "../../contracts/artifacts.js";
import { SelfHostWorldProvisioner } from "./provisioner.js";
import { installCandidateBundle, claimSelfHostOwner } from "./install-claim.js";
import { AgentGatewayClient, pushAgentAuthState } from "./agent-gateway-client.js";
import { startLocalAnyharness } from "./local-anyharness.js";
import { LocalRuntimeClient, findTurnEndedEvent, findLastAssistantReply } from "../../../fixtures/local-runtime.js";
import { LocalJsonlEvidenceSink } from "./local-evidence.js";
import { LocalFileLedger } from "./local-ledger.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..", "..");

function unavailable(reason: string): { available: false; reason: string } {
  return { available: false, reason };
}

function emptyCandidateManifest(sourceSha: string): CandidateManifest {
  return {
    schemaVersion: 1,
    kind: "candidate",
    sourceSha,
    sourceContentHash: sourceSha,
    serverImage: unavailable("run-live: not needed, self-host builds its own bundle"),
    webBuild: unavailable("run-live: not needed"),
    desktopApp: unavailable("run-live: not needed"),
    desktopUpdater: unavailable("run-live: not needed"),
    anyharness: {},
    worker: {},
    supervisor: {},
    catalogHash: unavailable("run-live: not needed"),
    registryHash: unavailable("run-live: not needed"),
    e2bTemplate: unavailable("run-live: not needed"),
    selfHostBundle: unavailable("run-live: forcing the local dev-bundle build path"),
    litellm: unavailable("run-live: not needed"),
  };
}

/** Parses a simple `KEY=value` / `export KEY=value` env file as data. Never logs values. */
async function parseEnvFile(path: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

async function main(): Promise<void> {
  const runId = `sh-${randomUUID().slice(0, 8)}`;
  log(`[run-live] runId=${runId} repoRoot=${REPO_ROOT}`);

  // Secure local secret loading: parse as data, ambient wins, names only.
  const localSecrets = await parseEnvFile(join(process.env.HOME ?? "", ".proliferate-local/dev/release-e2e.env"));
  const providerApiKey = process.env.ANTHROPIC_API_KEY ?? localSecrets.ANTHROPIC_API_KEY ?? null;
  log(
    `[run-live] provider credential for the SH-BASE-TURN tail: ${
      providerApiKey ? "present (name=ANTHROPIC_API_KEY)" : "ABSENT — that tail will report blocked, not fabricated"
    }`,
  );

  const sourceSha = (await import("node:child_process")).execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();

  const run: WorldContext["run"] = {
    runId,
    sourceSha,
    candidateManifestHash: "run-live-dev",
    retainedManifestHash: null,
    executionHost: "local",
    origin: `local:${process.env.HOSTNAME ?? "dev"}`,
    createdAt: new Date().toISOString(),
  };
  const shard: WorldContext["shard"] = { runId, shardId: "shard-1-of-1", shardIndex: 0, shardCount: 1 };

  const evidencePath = join(await mkdtemp(join(tmpdir(), "selfhost-e2e-evidence-")), "evidence.jsonl");
  const evidence = new LocalJsonlEvidenceSink(evidencePath);
  log(`[run-live] evidence sink: ${evidencePath}`);

  const ledgerPath = join(tmpdir(), `selfhost-e2e-ledger-${runId}.json`);
  log(`[run-live] cleanup ledger: ${ledgerPath}`);

  const ctx: WorldContext = {
    run,
    shard,
    candidate: emptyCandidateManifest(sourceSha),
    retained: null,
    // Unused by SelfHostWorldProvisioner, which constructs and owns its own
    // LocalFileLedger (see prepareFull) so it can register per-resource
    // destructors — a convenience beyond the frozen CleanupLedger interface.
    // A real (but unused here) ledger still satisfies WorldContext's shape.
    ledger: new LocalFileLedger(join(tmpdir(), `selfhost-e2e-context-ledger-${runId}.json`)),
    evidence,
  };

  const provisioner = new SelfHostWorldProvisioner({
    repoRoot: REPO_ROOT,
    ledgerPath,
    log,
  });

  const prepared = await provisioner.prepareFull(ctx);
  log(`[run-live] world prepared: instance=${prepared.instance.instanceId} dns=${prepared.instance.dnsName}`);

  const bundle = {
    imageTag: `proliferate-server:candidate-${sourceSha.slice(0, 12)}`,
    tarPath: "", // unused directly here; installCandidateBundle re-derives the same bundle below.
    locator: { locator: prepared.handle.bundleLocator, digest: prepared.handle.bundleDigest, algorithm: "sha256" as const, sizeBytes: null },
  };

  let localRuntime: Awaited<ReturnType<typeof startLocalAnyharness>> | null = null;
  const outcome: Record<string, unknown> = { runId };

  try {
    await installCandidateBundle({
      exec: (await import("./aws-cli.js")).realExec,
      target: { keyPath: prepared.instance.keyPath, sshUser: prepared.instance.sshUser, publicIp: prepared.instance.publicIp },
      repoRoot: REPO_ROOT,
      imageTarPath: prepared.handle.bundleLocator,
      imageTag: bundle.imageTag,
      log,
    });

    const publicUrl = `https://${prepared.instance.dnsName}`;
    await waitForHealth(publicUrl);
    const meta = (await (await fetch(`${publicUrl}/meta`)).json()) as { serverVersion?: string };
    log(`[run-live] SH-INSTALL-CLAIM: /meta serverVersion=${meta.serverVersion}`);
    outcome.serverVersion = meta.serverVersion;
    outcome.publicUrl = publicUrl;

    const claim = await claimSelfHostOwner({
      exec: (await import("./aws-cli.js")).realExec,
      target: { keyPath: prepared.instance.keyPath, sshUser: prepared.instance.sshUser, publicIp: prepared.instance.publicIp },
      baseUrl: publicUrl,
      runId,
    });
    log(`[run-live] SH-INSTALL-CLAIM complete: owner=${claim.ownerEmail} org=${claim.organizationId}, second-claim permanently rejected`);
    outcome.installClaim = "green";
    outcome.ownerEmail = claim.ownerEmail;

    if (!providerApiKey) {
      log("[run-live] SH-BASE-TURN tail: BLOCKED — no ANTHROPIC_API_KEY available locally (ambient env or ~/.proliferate-local/dev/release-e2e.env). Not fabricating a turn.");
      outcome.baseTurn = "blocked: missing named credential ANTHROPIC_API_KEY";
      return;
    }

    const gateway = new AgentGatewayClient({ baseUrl: publicUrl, bearerToken: claim.accessToken });
    const apiKey = await gateway.createApiKey("release-e2e self-host user key", providerApiKey);
    await gateway.selectApiKeyForHarness("claude", "local", apiKey.id);
    const stateDocument = await gateway.getState("local");
    log(`[run-live] stored+selected run-scoped user API key ${apiKey.id} for claude/local`);
    outcome.storedApiKeyId = apiKey.id;

    const anyharnessBinPath = process.env.ANYHARNESS_BIN_PATH ?? join(REPO_ROOT, "target/debug/anyharness");
    localRuntime = await startLocalAnyharness({
      binaryPath: anyharnessBinPath,
      runtimeHome: await mkdtemp(join(tmpdir(), "selfhost-e2e-runtime-")),
      port: 0,
      runId,
      ledger: prepared.ledger,
      owningWorld: "self-host",
      log,
    }).catch(async (error) => {
      // port:0 is not valid for the child process arg; retry with a real free port.
      const { createServer } = await import("node:net");
      const port: number = await new Promise((resolvePromise, reject) => {
        const server = createServer();
        server.listen(0, () => {
          const address = server.address();
          const p = typeof address === "object" && address ? address.port : 0;
          server.close(() => resolvePromise(p));
        });
        server.on("error", reject);
      });
      log(`[run-live] retrying local anyharness start on free port ${port} (${(error as Error).message})`);
      return startLocalAnyharness({
        binaryPath: anyharnessBinPath,
        runtimeHome: await mkdtemp(join(tmpdir(), "selfhost-e2e-runtime-")),
        port,
        runId,
        ledger: prepared.ledger,
        owningWorld: "self-host",
        log,
      });
    });

    await pushAgentAuthState(localRuntime.baseUrl, stateDocument);
    log("[run-live] pushed compiled local-surface agent-auth state to the local runtime");

    const runtimeClient = new LocalRuntimeClient({ baseUrl: localRuntime.baseUrl });
    await runtimeClient.installAgent("claude").catch((error) => log(`[run-live] installAgent(claude): ${(error as Error).message}`));

    const scratchRepo = await mkdtemp(join(tmpdir(), "selfhost-e2e-repo-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["-C", scratchRepo, "init", "-q"]);
    await (await import("node:fs/promises")).writeFile(join(scratchRepo, "README.md"), "# self-host e2e scratch\n");
    execFileSync("git", ["-C", scratchRepo, "add", "."]);
    execFileSync("git", ["-C", scratchRepo, "-c", "user.email=e2e@proliferate.dev", "-c", "user.name=release-e2e", "commit", "-q", "-m", "init"]);

    const { workspace } = await runtimeClient.createLocalWorkspace(scratchRepo);
    const session = await runtimeClient.createSession({ workspaceId: workspace.id, agentKind: "claude" });
    await runtimeClient.prompt(session.id, "Reply with exactly the single word: ok");
    const finalSession = await runtimeClient.waitForIdle(session.id, { timeoutMs: 120_000 });
    const events = await runtimeClient.getEvents(session.id);
    const turnEnded = findTurnEndedEvent(events);
    const reply = findLastAssistantReply(events);
    log(`[run-live] SH-BASE-TURN: session=${session.id} status=${finalSession.status} turnEnded=${Boolean(turnEnded)} reply=${JSON.stringify(reply)}`);
    outcome.baseTurn = turnEnded ? "green" : `not-completed (status=${finalSession.status})`;
    outcome.sessionId = session.id;
    outcome.reply = reply ?? null;
  } finally {
    if (localRuntime) await localRuntime.stop().catch(() => {});
    const reconciliation = await prepared.ledger.reconcile();
    outcome.cleanup = reconciliation;
    log(`[run-live] teardown reconciliation: ${JSON.stringify(reconciliation)}`);
    console.log(`\n=== RUN-LIVE OUTCOME ===\n${JSON.stringify(outcome, null, 2)}\n`);
  }
}

async function waitForHealth(publicUrl: string, attempts = 30, intervalMs = 5000): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${publicUrl}/health`);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`waitForHealth: ${publicUrl}/health never became healthy`);
}

main().catch((error) => {
  console.error("[run-live] FATAL:", error);
  process.exitCode = 1;
});
