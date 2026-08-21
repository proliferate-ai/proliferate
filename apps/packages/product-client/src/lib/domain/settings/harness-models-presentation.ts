import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  cloudAbsentPresentation,
  localAbsentPresentation,
} from "#product/lib/domain/settings/harness-models-absent-payload";

/**
 * The Models section's single presentation decision, as a pure function.
 *
 * Three review rounds each fixed one arm of "there is no launch-options
 * payload" and each invented the mirror of the bug it fixed, because the arms
 * were written against PROXIES ("this query is disabled") rather than FACTS
 * ("the runtime failed"). A proxy is shared by causes that need opposite
 * renderings: a disabled query means "still connecting" on a cold start and
 * "gave up 60s ago" after `pollUntilHealthy` exhausts, and no amount of
 * `isPending` inspection can separate them — only `connectionState` can.
 *
 * So every cause is enumerated here once, each switch is exhaustive with no
 * `default:` arm, and the refresh affordance is a `Record` keyed by kind.
 * Adding a wire state, a connection state, a fetch status, or a kind without
 * deciding what it renders is a typecheck failure, not a runtime lie.
 *
 * The governing rule for every arm: never render a failure claim or a spinner
 * for a condition where nothing is happening and nothing failed, and never
 * leave a dead end — each arm carries either a cure the user can take or an
 * honest statement that it resolves itself.
 */

/**
 * The runtime-connection fact this resolver needs, owned at the domain layer
 * rather than imported up from the store (FE-PC-6). The component passes the
 * store's `HarnessConnectionState` in, so if that union ever gains a member
 * the call site stops typechecking until this resolver decides what it means.
 */
export type HarnessRuntimeConnection = "connecting" | "healthy" | "failed";

/** The v5 fetch-status axis, narrowed to the three values query-core reports. */
export type HarnessModelsFetchStatus = "fetching" | "paused" | "idle";

/**
 * What one query knows about itself, with no react-query types leaking in.
 *
 * There is deliberately no `isLoading` here (E-R32). v5 defines it as
 * `isPending && isFetching`, so it is a DERIVED convenience over two facts
 * this type already carries, and consulting it first is what let a spinner
 * outrank the connection state. The two primitives decide; the proxy is gone.
 */
export interface HarnessModelsQueryFacts {
  isError: boolean;
  /** `ProliferateClientError.code` when the failure was structured, else null. */
  errorCode: string | null;
  /**
   * E-R30: whether the failure carries an HTTP status from the API, i.e. the
   * server answered even when the body had no structured code. False when the
   * fetch itself rejected and nothing came back. Without this, an unstructured
   * 502 and a dead network are indistinguishable, and one honest line for both
   * has to claim silence that was never established.
   */
  serverAnswered: boolean;
  isPending: boolean;
  fetchStatus: HarnessModelsFetchStatus;
}

export interface AllModelsPresentationInput {
  surface: "local" | "cloud";
  displayName: string;
  /** Local only; cloud reads a copied snapshot and has no local runtime. */
  connectionState: HarnessRuntimeConnection;
  /**
   * E-R34: whether this host has a local runtime bridge at all. Web has none,
   * so nothing ever writes `connectionState` there and it sits at its initial
   * `"connecting"` forever. The capability is the fact; `connectionState`
   * cannot report the difference between "coming up" and "will never come up".
   */
  hasLocalRuntimeHost: boolean;
  runtimeQuery: HarnessModelsQueryFacts;
  sandboxQuery: HarnessModelsQueryFacts;
  /** The FACT behind "no cloud workspace", not the disabled-query proxy. */
  hasCloudSandboxId: boolean;
  cloudLaunchOptionsQuery: HarnessModelsQueryFacts;
  launchOptions: HarnessLaunchOptionsResponse | undefined;
  isRefreshMutationPending: boolean;
  /**
   * E-R28: query-core parks an `online`-mode mutation as `pending` with
   * `isPaused: true` and no timeout. Pending alone cannot tell "in flight"
   * from "parked", and only one of those may spin a control.
   */
  isRefreshMutationPaused: boolean;
  modelCount: number;
  /** `formatRelativeTime(observedAt)`, or null when nothing was ever observed. */
  freshnessAgo: string | null;
}

export type AllModelsPresentationKind =
  | "runtime_connecting"
  | "runtime_failed"
  | "local_runtime_unavailable"
  | "offline_paused"
  | "refresh_offline_paused"
  | "loading"
  | "awaiting_first_read"
  | "cloud_no_workspace"
  | "cloud_read_error"
  | "not_observed_yet"
  | "transport_error"
  | "checking"
  | "idle_unobserved"
  | "settled_count"
  | "failed_without_observation";

export type AllModelsRefreshAffordance = "enabled" | "disabled" | "spinning" | "absent";
/**
 * `refetch_read` re-issues the GET; `reprobe_harness` asks for a new probe;
 * `restart_runtime` restarts the local runtime through the host bridge
 * (E-R33), which is the only one of the three that can move a runtime the
 * health poll already gave up on.
 */
export type AllModelsRetryAffordance =
  | "refetch_read"
  | "reprobe_harness"
  | "restart_runtime"
  | null;

export interface AllModelsPresentation {
  kind: AllModelsPresentationKind;
  title: string | null;
  detail: string | null;
  refresh: AllModelsRefreshAffordance;
  retry: AllModelsRetryAffordance;
  /**
   * The expanded body's empty-list line, or null when the header already
   * explains the emptiness and a second line would contradict it (E-R19).
   */
  emptyBody: string | null;
}

/**
 * Refresh when the local surface is idle. Cloud has no refresh route at all,
 * and a live probe overrides this with `spinning`, so this table only decides
 * the local-and-settled case. A `Record` rather than a `switch (kind)` so a
 * new kind cannot silently inherit "enabled".
 */
const IDLE_REFRESH_BY_KIND: Record<AllModelsPresentationKind, "enabled" | "disabled"> = {
  // Nothing to refresh against: `refresh_now` cannot reach a runtime that is
  // not up, and an enabled button would be a lie pointed the other way.
  runtime_connecting: "disabled",
  runtime_failed: "disabled",
  // No local runtime exists on this host, so there is nothing to refresh
  // against and nothing that will ever appear (E-R34).
  local_runtime_unavailable: "disabled",
  // The mutation is paused by the same offline gate that paused the read.
  offline_paused: "disabled",
  // The mutation itself is parked. Nothing is in flight, so it must not spin,
  // and a second click cannot start anything, so it must not be enabled.
  refresh_offline_paused: "disabled",
  loading: "enabled",
  awaiting_first_read: "enabled",
  cloud_no_workspace: "enabled",
  cloud_read_error: "enabled",
  not_observed_yet: "enabled",
  transport_error: "enabled",
  checking: "enabled",
  idle_unobserved: "enabled",
  settled_count: "enabled",
  failed_without_observation: "enabled",
};

function payloadPresentation(
  input: AllModelsPresentationInput,
  isLocal: boolean,
  launchOptions: HarnessLaunchOptionsResponse,
  freshnessLine: string | null,
): Omit<AllModelsPresentation, "refresh"> {
  const { displayName, modelCount, freshnessAgo: ago } = input;
  const canManuallyRefresh = isLocal;

  // `state=refreshing` is live only on the surface that can ever resolve it:
  // cloud has no refetch interval and no Refresh control, so a copied
  // `refreshing` snapshot there is last-good data, not "checking" (E-R12).
  // `detecting` needs the phase to tell a running first observation apart
  // from a harness that legitimately sits unobserved forever.
  const probePhase = isLocal ? launchOptions.probePhase : undefined;
  const isProbeLive = probePhase === "running" || probePhase === "queued";
  if ((isLocal && launchOptions.state === "refreshing")
    || (launchOptions.state === "detecting" && isProbeLive)) {
    return { kind: "checking", title: null, detail: HARNESS_PANE_COPY.allModelsChecking, retry: null, emptyBody: null };
  }
  if (launchOptions.state === "detecting") {
    return {
      kind: "idle_unobserved",
      title: HARNESS_PANE_COPY.allModelsIdleUnobservedTitle,
      detail: HARNESS_PANE_COPY.allModelsIdleUnobservedSuffix(displayName, canManuallyRefresh),
      retry: null,
      emptyBody: HARNESS_PANE_COPY.allModelsEmpty,
    };
  }

  // No `default:`: a seventh wire state must be decided here, not defaulted.
  switch (launchOptions.state) {
    case "observed":
    case "refreshing":
      return {
        kind: "settled_count",
        title: HARNESS_PANE_COPY.probeModelCount(modelCount),
        detail: freshnessLine,
        retry: null,
        emptyBody: HARNESS_PANE_COPY.allModelsEmpty,
      };
    case "observed_empty":
      return {
        kind: "settled_count",
        title: HARNESS_PANE_COPY.probeModelCount(modelCount),
        detail: ago ? HARNESS_PANE_COPY.allModelsObservedEmptySuffix(displayName, ago) : null,
        retry: null,
        emptyBody: HARNESS_PANE_COPY.allModelsEmpty,
      };
    case "last_good_after_failure":
      return {
        kind: "settled_count",
        title: HARNESS_PANE_COPY.probeModelCount(modelCount),
        detail: ago
          ? HARNESS_PANE_COPY.allModelsLastGoodAfterFailureSuffix(ago)
          : HARNESS_PANE_COPY.allModelsRefreshFailedBadge,
        retry: null,
        emptyBody: HARNESS_PANE_COPY.allModelsEmpty,
      };
    case "failed_without_observation":
      return {
        kind: "failed_without_observation",
        title: HARNESS_PANE_COPY.allModelsFailedWithoutObservationTitle,
        detail: HARNESS_PANE_COPY.allModelsProbeFailureReason(displayName),
        // Cloud has no probe route, so there is nothing to offer there.
        retry: canManuallyRefresh ? "reprobe_harness" : null,
        emptyBody: null,
      };
  }
}

export function resolveAllModelsPresentation(
  input: AllModelsPresentationInput,
): AllModelsPresentation {
  const isLocal = input.surface === "local";
  const { launchOptions, freshnessAgo: ago } = input;
  const freshnessLine = ago ? HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(ago) : null;

  // E-R32: no `isLoading` gate ahead of these. "Something is fetching" is a
  // proxy shared by causes that need opposite renderings, and consulting it
  // first let a spinner outrank `connectionState`. Each branch now reaches its
  // own fetch-status arm AFTER the facts that outrank it, and the branch that
  // used to sit here is subsumed: v5's `isLoading` is `isPending && isFetching`
  // and `isFetching` is `fetchStatus === "fetching"`, which every arm below
  // already renders as `loading`.
  const base: Omit<AllModelsPresentation, "refresh"> = launchOptions
    ? payloadPresentation(input, isLocal, launchOptions, freshnessLine)
    : isLocal
      ? localAbsentPresentation(input)
      : cloudAbsentPresentation(input);

  // E-R28: a parked refresh mutation is not a running one. query-core reports
  // it as `pending` with no timeout, so `isPending` alone spins the control
  // forever with nothing in flight and no way to cancel. Say what is actually
  // parked — but only where the line would otherwise imply a working Refresh:
  // an arm that already disables Refresh (still connecting, gave up, no local
  // runtime, the READ parked by the same gate) is the more specific truth and
  // stands. Retry goes with it, because every retry this pane offers on those
  // arms is itself a request the same gate would park.
  const decided: Omit<AllModelsPresentation, "refresh"> =
    isLocal && input.isRefreshMutationPaused && IDLE_REFRESH_BY_KIND[base.kind] === "enabled"
      ? {
        kind: "refresh_offline_paused",
        title: HARNESS_PANE_COPY.allModelsOfflineTitle,
        detail: HARNESS_PANE_COPY.allModelsRefreshOfflineSuffix,
        retry: null,
        emptyBody: base.emptyBody,
      }
      : base;

  // Busy is tied to a live probe, never to the raw `probePhase`: a terminal
  // state carrying a stray live phase is not polled by
  // `resolveAgentLaunchOptionsRefetchInterval`, so disabling Refresh there
  // would freeze data behind a disabled button with nothing scheduled to
  // update it (E-R9/E-R10).
  const isRefreshing = isLocal
    && (input.isRefreshMutationPending || decided.kind === "checking");
  // E-R29: the table is consulted FIRST. A kind set to "disabled" is set there
  // because `refresh_now` cannot reach anything from that state, and a
  // mutation still pending against a runtime that has since died must not
  // repaint that dead control as busy.
  const idleRefresh = IDLE_REFRESH_BY_KIND[decided.kind];
  const refresh: AllModelsRefreshAffordance = !isLocal
    ? "absent"
    : idleRefresh === "disabled"
      ? "disabled"
      : isRefreshing
        ? "spinning"
        : "enabled";

  // E-R14/E-R19 belong to the arms, and only to the arms. The override that
  // used to sit here was half dead and half wrong (E-R31): `!launchOptions`
  // could never fire, because every arm reachable without a payload already
  // returns `emptyBody: null` — which is also why the four assertions guarding
  // it could not fail. And `readQuery.isError` fires ONLY when a payload does
  // exist, where it suppresses a body that agrees with its own header: a
  // failed background refetch does not change "0 models", so blanking "No
  // models detected yet." underneath it hides a true line on the strength of a
  // fact the header never mentions. Each arm owns its own empty line.
  return { ...decided, refresh };
}
