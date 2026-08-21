import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type {
  AllModelsPresentation,
  AllModelsPresentationInput,
  HarnessModelsFetchStatus,
  HarnessModelsQueryFacts,
} from "#product/lib/domain/settings/harness-models-presentation";

/**
 * The no-payload half of the Models section's decision.
 *
 * "There is no launch-options payload" is not one condition, and this module
 * exists because treating it as one is what three review rounds each fixed and
 * each re-broke. A request in flight, a query nobody enabled, a host with no
 * runtime to enable it against, a runtime that gave up, a parked request, and
 * several distinct ways a read can fail are different truths that must render
 * as different things. Every one is enumerated here exactly once.
 *
 * It carries no `default:` arm anywhere on purpose: a new connection state,
 * fetch status, or error code must be decided here, and until it is the
 * compiler refuses the build rather than letting the surface guess.
 *
 * The payload half and the refresh affordance stay in
 * `harness-models-presentation.ts`, which is the only caller.
 */

/** A structured 404 from the cloud read: the target exists, nothing ingested. */
const NOT_OBSERVED_CODE = "harness_launch_options_not_observed";
/**
 * The other structured 404 the same GET emits (`harness_launch_options/
 * access.py`): the cached sandbox id is gone or is not this user's. Durable,
 * because `cloudSandboxKey()` has no refetch interval and does not refetch on
 * focus, so a culled sandbox leaves a stale id for as long as the pane is open.
 */
const SANDBOX_NOT_FOUND_CODE = "cloud_sandbox_not_found";

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

export function localAbsentPresentation(
  input: AllModelsPresentationInput,
): Omit<AllModelsPresentation, "refresh"> {
  // E-R34: asked before `connectionState`, because on a host with no runtime
  // bridge nobody ever writes that store and it reports its initial
  // "connecting" forever. Web would otherwise promise a connection that
  // cannot happen, with a spinner-shaped line and a dead Refresh.
  if (!input.hasLocalRuntimeHost) {
    return {
      kind: "local_runtime_unavailable",
      title: HARNESS_PANE_COPY.allModelsLocalUnavailableTitle,
      detail: HARNESS_PANE_COPY.allModelsLocalUnavailableSuffix,
      retry: null,
      emptyBody: null,
    };
  }
  // The FACT, read from the connection store rather than inferred from the
  // query being disabled — `ProductProviderRoot` blanks the runtime URL for
  // BOTH non-healthy states, so the query cannot tell them apart (E-R22).
  // E-R32: this switch is reached before any fetch-status arm, so a stale
  // in-flight read can no longer outrank the connection fact.
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
      // E-R33: `pollUntilHealthy` gave up (120 x 500ms). The bootstrap does
      // re-run on session create/select, so this is not the never-self-
      // correcting dead end an earlier round claimed, but nothing HERE
      // retries it. `restartHarnessRuntime` is exported, tested, and reachable
      // through the host's runtime bridge, so the cheap cure replaces the
      // expensive one: restart the runtime instead of relaunching the app.
      return {
        kind: "runtime_failed",
        title: HARNESS_PANE_COPY.allModelsRuntimeFailedTitle,
        detail: HARNESS_PANE_COPY.allModelsRuntimeFailedSuffix,
        // The bridge exists: the guard above returned for every host without
        // one, and only a host with one can reach "failed" at all.
        retry: "restart_runtime",
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

/**
 * E-R30: the failed cloud read, told only as far as the facts reach. A
 * `ProliferateClientError` is minted from a non-2xx RESPONSE, so claiming
 * "didn't respond" for one asserts a cause that was never established; a
 * rejected fetch or an unreadable body carries no status at all, and that is
 * the only case where silence is the established fact.
 */
function cloudReadErrorPresentation(
  query: HarnessModelsQueryFacts,
): Omit<AllModelsPresentation, "refresh"> {
  return {
    kind: "cloud_read_error",
    title: HARNESS_PANE_COPY.allModelsTransportErrorTitle,
    detail: query.serverAnswered
      ? HARNESS_PANE_COPY.allModelsCloudErrorReason
      : HARNESS_PANE_COPY.allModelsCloudUnreachableReason,
    retry: "refetch_read",
    emptyBody: null,
  };
}

/**
 * The launch-options read failed with a target already in hand. Only the two
 * structured codes the route actually emits get their own arm; everything else
 * falls to the honest generic failure rather than borrowing one of their
 * causes (E-R30 — the round-4 code branched exactly one of the ten).
 */
function cloudLaunchOptionsErrorPresentation(
  query: HarnessModelsQueryFacts,
  displayName: string,
): Omit<AllModelsPresentation, "refresh"> {
  // E-R24: a structured 404 is not a transport failure. The server answered,
  // and what it said is "this target has never had launch options ingested"
  // — the ordinary state of a cloud workspace that has not run an agent yet.
  // Retrying re-issues the same request and 404s forever, so no Retry.
  if (query.errorCode === NOT_OBSERVED_CODE) {
    return {
      kind: "not_observed_yet",
      title: HARNESS_PANE_COPY.allModelsIdleUnobservedTitle,
      detail: HARNESS_PANE_COPY.allModelsCloudNotObservedSuffix(displayName),
      retry: null,
      emptyBody: null,
    };
  }
  // E-R30: the cached sandbox id no longer resolves to a workspace this user
  // owns, which is the same thing the user is told when they never had one.
  // Unlike that arm this one DOES have a cure: Retry re-reads the sandbox
  // itself, so it can come back with a different id rather than the same 404.
  if (query.errorCode === SANDBOX_NOT_FOUND_CODE) {
    return {
      kind: "cloud_no_workspace",
      title: HARNESS_PANE_COPY.allModelsCloudNoWorkspaceTitle,
      detail: HARNESS_PANE_COPY.allModelsCloudNoWorkspaceSuffix(displayName),
      retry: "refetch_read",
      emptyBody: null,
    };
  }
  return cloudReadErrorPresentation(query);
}

export function cloudAbsentPresentation(
  input: AllModelsPresentationInput,
): Omit<AllModelsPresentation, "refresh"> {
  const { sandboxQuery, cloudLaunchOptionsQuery, displayName } = input;
  if (sandboxQuery.isError) {
    return cloudReadErrorPresentation(sandboxQuery);
  }
  // E-R35: the launch-options FACT outranks the sandbox query's fetch PROXY.
  // A settled 404 stays settled while a background sandbox refetch runs, so
  // asking the proxy first turns a durable answer into "Loading models…".
  if (input.hasCloudSandboxId && cloudLaunchOptionsQuery.isError) {
    return cloudLaunchOptionsErrorPresentation(cloudLaunchOptionsQuery, displayName);
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
  return pendingReadPresentation(cloudLaunchOptionsQuery.fetchStatus);
}
