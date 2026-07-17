import {
  billingThresholdReceiptFile,
  restoreBillingFixtureAdjustment,
} from "./billing-threshold.js";
import {
  findProviderSandbox,
  killProviderSandbox,
  type E2BFindResult,
} from "./e2b-verify.js";
import {
  deleteCustomerByIdHttp,
  deleteRunCustomersByTag,
  stripeSmokeResourceReplayHandlers,
} from "./stripe-smoke-resources.js";
import {
  STRIPE_INTENT_RECOVERY_WINDOW_MS,
  stripeCleanupReplayHandlers,
  type StripeHttp,
} from "./stripe-test-clock.js";
import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import { RELAY_DIRNAME } from "../worlds/managed-cloud/callback-relay-agent.js";
import {
  assertCallbackRelayStopOutput,
  callbackRelayStopCommand,
  REMOTE_WORKDIR,
} from "../worlds/managed-cloud/ingress.js";
import type {
  CleanupHandler,
  CleanupLedger,
  CleanupLedgerEntry,
  CleanupResourceKind,
} from "../worlds/local-workspace/cleanup-ledger.js";

/** The only cleanup kinds owned by fixture-smoke Cells A-D. */
export const FIXTURE_REPLAY_KINDS: ReadonlySet<CleanupResourceKind> = new Set([
  "billing_fixture_adjustment",
  "callback_relay_spool",
  "callback_relay_process",
  "e2b_sandbox",
  "stripe_test_clock",
  "stripe_customer",
  "stripe_webhook_endpoint",
  "stripe_product_price",
]);

const E2B_SANDBOX_CLEANUP_PREFIX = "e2b-sandbox:";

export interface E2bSandboxCleanupIdentity {
  cloudSandboxId: string;
  providerSandboxId: string | null;
}

/** Keeps the product logical id durable even after provider-id replacement. */
export function encodeE2bSandboxCleanupIdentity(identity: E2bSandboxCleanupIdentity): string {
  const params = new URLSearchParams({ cloud: identity.cloudSandboxId });
  if (identity.providerSandboxId) {
    params.set("provider", identity.providerSandboxId);
  }
  return `${E2B_SANDBOX_CLEANUP_PREFIX}${params.toString()}`;
}

export function decodeE2bSandboxCleanupIdentity(value: string): E2bSandboxCleanupIdentity | null {
  if (!value.startsWith(E2B_SANDBOX_CLEANUP_PREFIX)) {
    return null;
  }
  const params = new URLSearchParams(value.slice(E2B_SANDBOX_CLEANUP_PREFIX.length));
  const cloudSandboxId = params.get("cloud");
  const providerSandboxId = params.get("provider");
  if (!cloudSandboxId) {
    return null;
  }
  return { cloudSandboxId, providerSandboxId: providerSandboxId || null };
}

export interface FixtureReplayProviderDeps {
  findSandbox(cloudSandboxId: string, env: NodeJS.ProcessEnv): Promise<E2BFindResult>;
  killSandbox(providerSandboxId: string, env: NodeJS.ProcessEnv): Promise<{ killed: boolean }>;
  now(): Date;
  sleep?(ms: number): Promise<void>;
}

const DEFAULT_PROVIDER_DEPS: FixtureReplayProviderDeps = {
  findSandbox: findProviderSandbox,
  killSandbox: killProviderSandbox,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const E2B_INTENT_OBSERVATIONS = 3;
const E2B_INTENT_OBSERVATION_INTERVAL_MS = 2_000;
const E2B_INTENT_RECOVERY_GRACE_MS = 30_000;

function exactE2bMatches(result: E2BFindResult): NonNullable<E2BFindResult["matches"]> {
  if (!Array.isArray(result.matches) || !Number.isSafeInteger(result.count) || result.count! < 0) {
    throw new Error("E2B cleanup inventory omitted its exhaustive matches/count proof.");
  }
  if (result.count !== result.matches.length) {
    throw new Error("E2B cleanup inventory count does not match its exhaustive match list.");
  }
  if (
    (result.matches.length === 0 && (result.providerSandboxId !== null || result.state !== null)) ||
    (result.matches.length > 0 && result.providerSandboxId !== result.matches[0]?.providerSandboxId)
  ) {
    throw new Error("E2B cleanup inventory compatibility identity disagrees with its exhaustive match list.");
  }
  return result.matches;
}

export interface ManagedCloudFixtureReplayInputs {
  box: BoxExec;
  runTag: string;
  stripeSecretKey: string;
  stripeHttp: StripeHttp;
  ledgerEntries: readonly CleanupLedgerEntry[];
  env?: NodeJS.ProcessEnv;
  providers?: FixtureReplayProviderDeps;
}

function relayDirOnBox(): string {
  return `${REMOTE_WORKDIR}/${RELAY_DIRNAME}`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function billingReceiptFromPersistedIdentity(runTag: string, providerId: string): string {
  const prefix = `billing-threshold:${runTag}:`;
  if (!providerId.startsWith(prefix)) {
    throw new Error("billing fixture cleanup identity does not belong to this run.");
  }
  const actorAndLedger = providerId.slice(prefix.length);
  const separator = actorAndLedger.lastIndexOf(":");
  const actorId = separator > 0 ? actorAndLedger.slice(0, separator) : "";
  const ledger = separator > 0 ? actorAndLedger.slice(separator + 1) : "";
  if (!actorId || (ledger !== "llm" && ledger !== "compute")) {
    throw new Error("billing fixture cleanup identity is malformed.");
  }
  return billingThresholdReceiptFile(runTag, actorId, ledger);
}

/**
 * Reconstructs every Cell A-D handler from persisted bounded identity plus
 * stable service access. No handler captures a create-time controller.
 */
export function managedCloudFixtureReplayHandlers(
  inputs: ManagedCloudFixtureReplayInputs,
): Partial<Record<CleanupResourceKind, CleanupHandler>> {
  const providers = inputs.providers ?? DEFAULT_PROVIDER_DEPS;
  const env = inputs.env ?? process.env;
  const stripeHandlers = stripeCleanupReplayHandlers({
    secretKey: inputs.stripeSecretKey,
    ledgerEntries: inputs.ledgerEntries,
    now: providers.now,
  });
  return {
    ...stripeHandlers,
    ...stripeSmokeResourceReplayHandlers({
      secretKey: inputs.stripeSecretKey,
      http: inputs.stripeHttp,
    }),
    stripe_customer: async (entry) => {
      const providerId = entry.providerId ?? "";
      if (providerId.startsWith("cus_")) {
        await deleteCustomerByIdHttp(inputs.stripeSecretKey, providerId, inputs.stripeHttp);
        return;
      }
      const prefix = "intent:customer:runTag=";
      if (providerId.startsWith(prefix) && providerId.endsWith(":cellA")) {
        const ownedRunTag = providerId.slice(prefix.length, -":cellA".length);
        const deleted = await deleteRunCustomersByTag(
          { secretKey: inputs.stripeSecretKey, runTag: ownedRunTag, cellTag: "cellA" },
          inputs.stripeHttp,
        );
        if (deleted === 0) {
          const createdAt = Date.parse(entry.createdAt);
          if (Number.isNaN(createdAt)) {
            throw new Error("callback customer cleanup entry has a malformed createdAt timestamp.");
          }
          if (providers.now().getTime() - createdAt < STRIPE_INTENT_RECOVERY_WINDOW_MS) {
            throw new Error("callback customer intent is not visible yet; preserving cleanup custody for retry.");
          }
        }
        return;
      }
      const clockHandler = stripeHandlers.stripe_customer;
      if (!clockHandler) {
        throw new Error("stripe customer cleanup handler is unavailable.");
      }
      await clockHandler(entry);
    },
    billing_fixture_adjustment: async (entry) => {
      await restoreBillingFixtureAdjustment(
        inputs.box,
        billingReceiptFromPersistedIdentity(inputs.runTag, entry.providerId ?? ""),
      );
    },
    callback_relay_process: async (entry) => {
      const expectedPidfile = `${relayDirOnBox()}/relay.pid`;
      if (!(entry.providerId ?? "").endsWith(`:${expectedPidfile}`)) {
        throw new Error("callback relay process cleanup identity is malformed.");
      }
      const result = await inputs.box.exec(callbackRelayStopCommand());
      assertCallbackRelayStopOutput(result.stdout);
    },
    callback_relay_spool: async (entry) => {
      if (entry.providerId !== relayDirOnBox()) {
        throw new Error("callback relay spool cleanup identity is malformed.");
      }
      await inputs.box.exec(`rm -rf ${shellSingleQuote(relayDirOnBox())}`);
    },
    e2b_sandbox: async (entry) => {
      const identity = decodeE2bSandboxCleanupIdentity(entry.providerId ?? "");
      if (!identity) {
        throw new Error("E2B sandbox cleanup identity is malformed.");
      }
      let discovered = await providers.findSandbox(identity.cloudSandboxId, env);
      let matches = exactE2bMatches(discovered);
      // An intent-only ledger identity means the process may have died between
      // provider acceptance and durable provider-id promotion. One empty read
      // is not proof of absence under eventual consistency: observe a bounded
      // series, then preserve custody until the grace window has elapsed.
      if (!identity.providerSandboxId && matches.length === 0) {
        for (let attempt = 1; attempt < E2B_INTENT_OBSERVATIONS; attempt += 1) {
          await (providers.sleep ?? DEFAULT_PROVIDER_DEPS.sleep!)(E2B_INTENT_OBSERVATION_INTERVAL_MS);
          discovered = await providers.findSandbox(identity.cloudSandboxId, env);
          matches = exactE2bMatches(discovered);
          if (matches.length > 0) break;
        }
        const createdAt = Date.parse(entry.createdAt);
        if (!Number.isFinite(createdAt)) {
          throw new Error("E2B sandbox cleanup intent has a malformed createdAt timestamp.");
        }
        if (matches.length === 0 && providers.now().getTime() - createdAt < E2B_INTENT_RECOVERY_GRACE_MS) {
          throw new Error("E2B sandbox intent is not visible yet; preserving cleanup custody for retry.");
        }
      }
      const providerIds = new Set(matches.map((match) => match.providerSandboxId));
      if (identity.providerSandboxId) {
        providerIds.add(identity.providerSandboxId);
      }
      for (const providerSandboxId of providerIds) {
        const result = await providers.killSandbox(providerSandboxId, env);
        if (result.killed !== true) {
          throw new Error(`E2B did not positively affirm cleanup of sandbox ${providerSandboxId}.`);
        }
      }
      const remaining = await providers.findSandbox(identity.cloudSandboxId, env);
      const remainingCount = exactE2bMatches(remaining).length;
      if (remainingCount > 0) {
        throw new Error(`E2B sandbox cleanup left ${remainingCount} run-owned provider sandbox(es).`);
      }
    },
  };
}

export interface FixtureReplaySummary {
  selected: number;
  reconciled: number;
  untouchedNonFixture: number;
}

/**
 * Replays only Cell A-D fixture entries. Unrelated world entries remain
 * untouched and do not become synthetic failures in this bounded executor.
 */
export async function replayManagedCloudFixtureEntries(
  ledger: CleanupLedger,
  handlers: Partial<Record<CleanupResourceKind, CleanupHandler>>,
  selectedKinds: ReadonlySet<CleanupResourceKind> = FIXTURE_REPLAY_KINDS,
): Promise<FixtureReplaySummary> {
  const selected = ledger.unreconciled().filter((entry) => selectedKinds.has(entry.kind));
  const untouchedNonFixture = ledger.unreconciled().length - selected.length;
  const failures: string[] = [];
  let reconciled = 0;
  for (const entry of selected) {
    const handler = handlers[entry.kind];
    if (!handler) {
      failures.push(`${entry.kind}: no replay handler`);
      continue;
    }
    try {
      await handler(entry);
      await ledger.markReconciled(entry.entryId);
      reconciled += 1;
    } catch (error) {
      failures.push(`${entry.kind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`fixture cleanup replay failed (${failures.join("; ")})`);
  }
  return { selected: selected.length, reconciled, untouchedNonFixture };
}
