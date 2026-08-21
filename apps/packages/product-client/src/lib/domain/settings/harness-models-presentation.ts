import type {
  AgentAuthProbePhase,
  AgentReadinessState,
  HarnessLaunchOptionsState,
} from "@anyharness/sdk";
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

/**
 * The launch-options payload as this resolver reads it.
 *
 * Deliberately NOT the SDK response type. Two different wire types reach this
 * pane: the local runtime's `HarnessLaunchOptionsResponse`, and Proliferate
 * Cloud's copied snapshot, which has no `canManuallyRefresh` because the
 * browser reading it is not the runtime that would run the probe. Naming the
 * four fields here forces that difference to be settled at the call site, out
 * loud, instead of an absent field quietly meaning "cannot refresh" on a
 * runtime where it is true.
 */
export interface AllModelsPayloadFacts {
  state: HarnessLaunchOptionsState;
  readiness: AgentReadinessState;
  probePhase?: AgentAuthProbePhase;
  /** Engine ownership: may a manual refresh dispatched HERE run at all? */
  canManuallyRefresh: boolean;
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
  launchOptions: AllModelsPayloadFacts | undefined;
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
 * Whether a manual refresh MEANS anything in this state, before asking whether
 * this runtime is allowed to dispatch one.
 *
 * Every no-payload kind is `false`. Two independent reasons, either sufficient:
 * ownership (`canManuallyRefresh`) is a field ON the payload, so with no
 * payload there is no ownership fact to read and an enabled control could only
 * fail closed or 409; and refresh is not the cure for any of those states
 * anyway. `loading` resolves by waiting, `awaiting_first_read` and
 * `transport_error` are cured by re-reading, which those arms already offer as
 * their own retry, and the runtime arms cannot be reached by `refresh_now` at
 * all. A `Record` rather than a `switch (kind)` so a new kind cannot silently
 * inherit a working Refresh.
 */
const REFRESH_MEANINGFUL_BY_KIND: Record<AllModelsPresentationKind, boolean> = {
  // Nothing to refresh against: `refresh_now` cannot reach a runtime that is
  // not up, and an enabled button would be a lie pointed the other way.
  runtime_connecting: false,
  runtime_failed: false,
  // No local runtime exists on this host, so there is nothing to refresh
  // against and nothing that will ever appear (E-R34).
  local_runtime_unavailable: false,
  // The mutation is paused by the same offline gate that paused the read.
  offline_paused: false,
  // The mutation itself is parked. Nothing is in flight, so it must not spin,
  // and a second click cannot start anything, so it must not be enabled.
  refresh_offline_paused: false,
  // The remaining no-payload arms: see the note above. Each already carries the
  // cure that actually fits it, and none of those cures is a re-probe.
  loading: false,
  awaiting_first_read: false,
  cloud_no_workspace: false,
  cloud_read_error: false,
  not_observed_yet: false,
  transport_error: false,
  // The payload kinds. A refresh dispatched from here has a real harness to
  // re-probe; whether THIS runtime may dispatch it is the separate question
  // `canManuallyRefresh` answers.
  checking: true,
  idle_unobserved: true,
  settled_count: true,
  failed_without_observation: true,
};

/**
 * The second precondition on a manual refresh: install state, which the wire
 * reports separately from engine ownership and which a surface gating Refresh
 * must respect too. Folding the two into one boolean upstream would make this
 * pane unable to tell "install this harness" from "this runtime can never
 * refresh anything" — different remedies, so they stay different facts.
 *
 * `install_required` and `unsupported` block it: the probe route answers 404
 * `NOT_INSTALLED`, and no amount of clicking installs anything. The other four
 * allow it. `credentials_required` and `login_required` in particular keep
 * their Refresh, because re-probing is exactly how the pane learns the user
 * has since signed in; taking it away would remove the cure at the moment it
 * starts working. A `Record` over all six so a seventh readiness state is a
 * typecheck failure rather than an inherited default.
 */
const REFRESH_ALLOWED_BY_READINESS: Record<AgentReadinessState, boolean> = {
  ready: true,
  credentials_required: true,
  login_required: true,
  error: true,
  install_required: false,
  unsupported: false,
};

function payloadPresentation(
  input: AllModelsPresentationInput,
  isLocal: boolean,
  canManuallyRefresh: boolean,
  launchOptions: AllModelsPayloadFacts,
  freshnessLine: string | null,
): Omit<AllModelsPresentation, "refresh"> {
  const { displayName, modelCount, freshnessAgo: ago } = input;

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
        detail: canManuallyRefresh
          ? HARNESS_PANE_COPY.allModelsProbeFailureReason(displayName)
          : HARNESS_PANE_COPY.allModelsProbeFailureRecheckSuffix(displayName),
        // E-R37: a surface that cannot dispatch a probe is not therefore stuck.
        // Cloud has no probe route and a read-only runtime is not the engine
        // owner, but in both cases the OWNER re-probes on its own schedule, so
        // the row genuinely does change without this user doing anything. Left
        // with `retry: null` this was the pane's one dead end: a permanent
        // failure claim with no cure and no self-correction. Re-reading is a
        // real cure here and it does not pretend to dispatch a probe, which is
        // why the copy says check again rather than refresh.
        retry: canManuallyRefresh ? "reprobe_harness" : "refetch_read",
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
  // Both preconditions on a manual refresh, read from the wire rather than
  // inferred. Ownership lives on the payload, so "no payload" collapses to
  // "cannot refresh" here as well as in the table below — a surface that
  // guessed ownership from "is this runtime local?" would render a control
  // whose only possible outcome is a 409 toast.
  const canManuallyRefresh = isLocal
    && launchOptions !== undefined
    && launchOptions.canManuallyRefresh
    && REFRESH_ALLOWED_BY_READINESS[launchOptions.readiness];

  const base: Omit<AllModelsPresentation, "refresh"> = launchOptions
    ? payloadPresentation(input, isLocal, canManuallyRefresh, launchOptions, freshnessLine)
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
    isLocal && input.isRefreshMutationPaused && REFRESH_MEANINGFUL_BY_KIND[base.kind]
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
  // Ownership gates only the ENABLED/disabled choice, never the spinner: a
  // read-only runtime watching the owner's probe run is looking at something
  // genuinely in flight, and a dim button there would deny a fact the detail
  // line states. It cannot be spinning on its OWN mutation, because it could
  // never have dispatched one.
  const meaningful = REFRESH_MEANINGFUL_BY_KIND[decided.kind];
  const refresh: AllModelsRefreshAffordance = !isLocal
    ? "absent"
    : meaningful && isRefreshing
      ? "spinning"
      : meaningful && canManuallyRefresh
        ? "enabled"
        : "disabled";

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
