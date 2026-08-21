import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

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

/** What one query knows about itself, with no react-query types leaking in. */
export interface HarnessModelsQueryFacts {
  isLoading: boolean;
  isError: boolean;
  /** `ProliferateClientError.code` when the failure was structured, else null. */
  errorCode: string | null;
  isPending: boolean;
  fetchStatus: HarnessModelsFetchStatus;
}

export interface AllModelsPresentationInput {
  surface: "local" | "cloud";
  displayName: string;
  /** Local only; cloud reads a copied snapshot and has no local runtime. */
  connectionState: HarnessRuntimeConnection;
  runtimeQuery: HarnessModelsQueryFacts;
  sandboxQuery: HarnessModelsQueryFacts;
  /** The FACT behind "no cloud workspace", not the disabled-query proxy. */
  hasCloudSandboxId: boolean;
  cloudLaunchOptionsQuery: HarnessModelsQueryFacts;
  launchOptions: HarnessLaunchOptionsResponse | undefined;
  isRefreshMutationPending: boolean;
  modelCount: number;
  /** `formatRelativeTime(observedAt)`, or null when nothing was ever observed. */
  freshnessAgo: string | null;
}

export type AllModelsPresentationKind =
  | "runtime_connecting"
  | "runtime_failed"
  | "offline_paused"
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
/** `refetch_read` re-issues the GET; `reprobe_harness` asks for a new probe. */
export type AllModelsRetryAffordance = "refetch_read" | "reprobe_harness" | null;

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
  // The mutation is paused by the same offline gate that paused the read.
  offline_paused: "disabled",
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

/** A structured 404 from the cloud read: the target exists, nothing ingested. */
const NOT_OBSERVED_CODE = "harness_launch_options_not_observed";

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

/** One query's non-error, non-settled fetch status. Exhaustive, no default. */
function pendingReadPresentation(
  fetchStatus: HarnessModelsFetchStatus,
): Omit<AllModelsPresentation, "refresh"> {
  switch (fetchStatus) {
    case "fetching":
      return { kind: "loading", title: null, detail: HARNESS_PANE_COPY.allModelsLoading, retry: null, emptyBody: null };
    case "paused":
      // E-R23: query-core's default `networkMode: "online"` parks the request
      // while the browser reports offline. Nothing is in flight and nothing
      // failed; it resumes by itself when the network returns.
      return {
        kind: "offline_paused",
        title: HARNESS_PANE_COPY.allModelsOfflineTitle,
        detail: HARNESS_PANE_COPY.allModelsOfflineSuffix,
        retry: null,
        emptyBody: null,
      };
    case "idle":
      // Enabled, never run, not fetching: query-core marks a newly enabled
      // query `fetching` on the same render, so this is unreachable today.
      // Enumerated anyway with a cure that actually works rather than
      // defaulted into someone else's copy.
      return {
        kind: "awaiting_first_read",
        title: HARNESS_PANE_COPY.allModelsNotReadYetTitle,
        detail: HARNESS_PANE_COPY.allModelsNotReadYetSuffix,
        retry: "refetch_read",
        emptyBody: null,
      };
  }
}

function localAbsentPresentation(
  input: AllModelsPresentationInput,
): Omit<AllModelsPresentation, "refresh"> {
  // The FACT, read from the connection store rather than inferred from the
  // query being disabled — `ProductProviderRoot` blanks the runtime URL for
  // BOTH non-healthy states, so the query cannot tell them apart (E-R22).
  switch (input.connectionState) {
    case "connecting":
      return {
        kind: "runtime_connecting",
        title: HARNESS_PANE_COPY.allModelsRuntimeConnectingTitle,
        detail: HARNESS_PANE_COPY.allModelsRuntimeConnectingSuffix,
        retry: null,
        emptyBody: null,
      };
    case "failed":
      // `pollUntilHealthy` gave up (120 x 500ms). This never self-corrects,
      // so it must carry a cure instead of a promise the code cannot keep.
      return {
        kind: "runtime_failed",
        title: HARNESS_PANE_COPY.allModelsRuntimeFailedTitle,
        detail: HARNESS_PANE_COPY.allModelsRuntimeFailedSuffix,
        retry: null,
        emptyBody: null,
      };
    case "healthy":
      if (input.runtimeQuery.isError) {
        return {
          kind: "transport_error",
          title: HARNESS_PANE_COPY.allModelsTransportErrorTitle,
          detail: HARNESS_PANE_COPY.allModelsTransportErrorReason,
          retry: "refetch_read",
          emptyBody: null,
        };
      }
      return pendingReadPresentation(input.runtimeQuery.fetchStatus);
  }
}

function cloudAbsentPresentation(
  input: AllModelsPresentationInput,
): Omit<AllModelsPresentation, "refresh"> {
  const { sandboxQuery, cloudLaunchOptionsQuery, displayName } = input;
  if (sandboxQuery.isError) {
    return {
      kind: "cloud_read_error",
      title: HARNESS_PANE_COPY.allModelsTransportErrorTitle,
      detail: HARNESS_PANE_COPY.allModelsCloudUnreachableReason,
      retry: "refetch_read",
      emptyBody: null,
    };
  }
  if (sandboxQuery.fetchStatus !== "idle" || sandboxQuery.isPending) {
    return pendingReadPresentation(sandboxQuery.fetchStatus);
  }
  // E-R25: assert the fact. The sandbox read has settled and answered with no
  // workspace (`getCloudSandbox` returns 200/null), which is why the
  // target-scoped read below is disabled — not the other way round.
  if (!input.hasCloudSandboxId) {
    return {
      kind: "cloud_no_workspace",
      title: HARNESS_PANE_COPY.allModelsCloudNoWorkspaceTitle,
      detail: HARNESS_PANE_COPY.allModelsCloudNoWorkspaceSuffix(displayName),
      retry: null,
      emptyBody: null,
    };
  }
  if (cloudLaunchOptionsQuery.isError) {
    // E-R24: a structured 404 is not a transport failure. The server answered,
    // and what it said is "this target has never had launch options ingested"
    // — the ordinary state of a cloud workspace that has not run an agent yet.
    // Retrying re-issues the same request and 404s forever, so no Retry.
    if (cloudLaunchOptionsQuery.errorCode === NOT_OBSERVED_CODE) {
      return {
        kind: "not_observed_yet",
        title: HARNESS_PANE_COPY.allModelsIdleUnobservedTitle,
        detail: HARNESS_PANE_COPY.allModelsCloudNotObservedSuffix(displayName),
        retry: null,
        emptyBody: null,
      };
    }
    return {
      kind: "cloud_read_error",
      title: HARNESS_PANE_COPY.allModelsTransportErrorTitle,
      detail: HARNESS_PANE_COPY.allModelsCloudUnreachableReason,
      retry: "refetch_read",
      emptyBody: null,
    };
  }
  return pendingReadPresentation(cloudLaunchOptionsQuery.fetchStatus);
}

export function resolveAllModelsPresentation(
  input: AllModelsPresentationInput,
): AllModelsPresentation {
  const isLocal = input.surface === "local";
  const { launchOptions, freshnessAgo: ago } = input;
  const freshnessLine = ago ? HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(ago) : null;

  const readQuery = isLocal ? input.runtimeQuery : input.cloudLaunchOptionsQuery;
  const isLoading = isLocal
    ? input.runtimeQuery.isLoading
    : input.sandboxQuery.isLoading || input.cloudLaunchOptionsQuery.isLoading;

  const decided: Omit<AllModelsPresentation, "refresh"> = isLoading
    ? { kind: "loading", title: null, detail: HARNESS_PANE_COPY.allModelsLoading, retry: null, emptyBody: null }
    : launchOptions
      ? payloadPresentation(input, isLocal, launchOptions, freshnessLine)
      : isLocal
        ? localAbsentPresentation(input)
        : cloudAbsentPresentation(input);

  // Busy is tied to a live probe, never to the raw `probePhase`: a terminal
  // state carrying a stray live phase is not polled by
  // `resolveAgentLaunchOptionsRefetchInterval`, so disabling Refresh there
  // would freeze data behind a disabled button with nothing scheduled to
  // update it (E-R9/E-R10).
  const isRefreshing = isLocal
    && (input.isRefreshMutationPending || decided.kind === "checking");
  const refresh: AllModelsRefreshAffordance = !isLocal
    ? "absent"
    : isRefreshing
      ? "spinning"
      : IDLE_REFRESH_BY_KIND[decided.kind];

  // E-R14/E-R19: keyed on what drove the header. Whenever there is no payload
  // the header already carries the reason the list is empty, and a transport
  // failure says it too — a second "No models detected yet." would contradict
  // both.
  const emptyBody = !launchOptions || readQuery.isError ? null : decided.emptyBody;

  return { ...decided, refresh, emptyBody };
}
