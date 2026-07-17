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
const MAX_E2B_CLEANUP_PROVIDER_IDS = 32;
const SAFE_E2B_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/;

export interface E2bSandboxCleanupIdentity {
  cloudSandboxId: string;
  providerSandboxId: string | null;
  /** Present only when one logical sandbox resolved to multiple exact provider rows. */
  providerSandboxIds?: string[];
}

/** Keeps the product logical id durable even after provider-id replacement. */
export function encodeE2bSandboxCleanupIdentity(identity: E2bSandboxCleanupIdentity): string {
  const params = new URLSearchParams({ cloud: identity.cloudSandboxId });
  const providerIds = identity.providerSandboxIds ?? (identity.providerSandboxId ? [identity.providerSandboxId] : []);
  const distinct = [...new Set(providerIds)].sort();
  if (
    distinct.length !== providerIds.length ||
    distinct.length > MAX_E2B_CLEANUP_PROVIDER_IDS ||
    distinct.some((providerId) => !SAFE_E2B_PROVIDER_ID.test(providerId)) ||
    (identity.providerSandboxId !== null && !distinct.includes(identity.providerSandboxId))
  ) {
    throw new Error("E2B sandbox cleanup provider identity is malformed or exceeds its bound.");
  }
  for (const providerId of distinct) {
    params.append("provider", providerId);
  }
  return `${E2B_SANDBOX_CLEANUP_PREFIX}${params.toString()}`;
}

export function decodeE2bSandboxCleanupIdentity(value: string): E2bSandboxCleanupIdentity | null {
  if (!value.startsWith(E2B_SANDBOX_CLEANUP_PREFIX)) {
    return null;
  }
  const params = new URLSearchParams(value.slice(E2B_SANDBOX_CLEANUP_PREFIX.length));
  const cloudSandboxId = params.get("cloud");
  if (!cloudSandboxId) {
    return null;
  }
  const providerIds = params.getAll("provider");
  if (
    providerIds.length > MAX_E2B_CLEANUP_PROVIDER_IDS ||
    new Set(providerIds).size !== providerIds.length ||
    providerIds.some((providerId) => !SAFE_E2B_PROVIDER_ID.test(providerId))
  ) {
    return null;
  }
  const providerSandboxId = providerIds[0] ?? null;
  return providerIds.length > 1
    ? { cloudSandboxId, providerSandboxId, providerSandboxIds: [...providerIds].sort() }
    : { cloudSandboxId, providerSandboxId };
}

function providerIdsFromIdentity(identity: E2bSandboxCleanupIdentity): string[] {
  return identity.providerSandboxIds ?? (identity.providerSandboxId ? [identity.providerSandboxId] : []);
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
  ledger: CleanupLedger;
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
      if (entry.providerId === null) {
        // registerSandboxIntent has not returned, so the provider-creating
        // product action cannot have started. This is the authoritative
        // pre-return/no-provider crash window.
        return;
      }
      const identity = decodeE2bSandboxCleanupIdentity(entry.providerId ?? "");
      if (!identity) {
        throw new Error("E2B sandbox cleanup identity is malformed.");
      }
      let discovered = await providers.findSandbox(identity.cloudSandboxId, env);
      let matches = exactE2bMatches(discovered);
      // An encoded intent-only identity means provider creation may already be
      // in flight in the candidate materializer. Even repeated empty provider
      // inventory is not authoritative absence while that producer can still
      // accept the request, so preserve custody until an exact provider id can
      // be promoted. Only the raw providerId=null pre-return entry above proves
      // that the product action could not have started.
      if (!identity.providerSandboxId && matches.length === 0) {
        for (let attempt = 1; attempt < E2B_INTENT_OBSERVATIONS; attempt += 1) {
          await (providers.sleep ?? DEFAULT_PROVIDER_DEPS.sleep!)(E2B_INTENT_OBSERVATION_INTERVAL_MS);
          discovered = await providers.findSandbox(identity.cloudSandboxId, env);
          matches = exactE2bMatches(discovered);
          if (matches.length > 0) break;
        }
        if (matches.length === 0) {
          throw new Error(
            "E2B sandbox intent has no authoritative provider binding; preserving cleanup custody for retry.",
          );
        }
      }
      const providerIds = new Set([
        ...providerIdsFromIdentity(identity),
        ...matches.map((match) => match.providerSandboxId),
      ]);
      if (providerIds.size > MAX_E2B_CLEANUP_PROVIDER_IDS) {
        throw new Error("E2B sandbox cleanup inventory exceeds its bounded provider-id custody.");
      }
      const promoted = encodeE2bSandboxCleanupIdentity({
        cloudSandboxId: identity.cloudSandboxId,
        providerSandboxId: [...providerIds].sort()[0] ?? null,
        providerSandboxIds: providerIds.size > 1 ? [...providerIds].sort() : undefined,
      });
      if (promoted !== entry.providerId) {
        // Persist the complete exact provider set BEFORE the first destructive
        // call. A crash after provider deletion but before reconciliation can
        // then retry idempotently from durable identities rather than falling
        // back to an ambiguous logical-only intent.
        await inputs.ledger.markAcquired(entry.entryId, promoted);
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
