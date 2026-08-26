import { useMemo, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  useAgentLaunchOptionsQuery,
  useRefreshHarnessLaunchOptionsMutation,
} from "@anyharness/sdk-react";
import { ChevronRight } from "#product/primitives/icons/core";
import { RefreshCw } from "#product/primitives/icons/platform";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { HarnessAllModelsFilterRow } from "#product/components/settings/panes/agents/harness/HarnessAllModelsFilterRow";
import { ModelTable, type ModelTableRow } from "#product/components/settings/panes/agents/harness/ModelTable";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import { normalizeRuntimeLaunchModels } from "#product/lib/domain/settings/harness-catalog";
import {
  resolveAllModelsPresentation,
  type AllModelsPayloadFacts,
  type AllModelsRetryAffordance,
  type HarnessModelsFetchStatus,
  type HarnessModelsQueryFacts,
} from "#product/lib/domain/settings/harness-models-presentation";
import { useLocalRuntimeRestart } from "#product/hooks/access/anyharness/runtime/use-local-runtime-restart";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";

interface HarnessAllModelsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}

/**
 * Reads one query result down to the facts the presentation resolver needs.
 * `fetchStatus` is the discriminator the whole pane turns on: in v5 a DISABLED
 * query with no data is `status: "pending"`, indistinguishable from one in
 * flight by `isPending` alone.
 */
function queryFacts(result: {
  isError?: boolean;
  isPending?: boolean;
  fetchStatus?: string;
  error?: unknown;
}): HarnessModelsQueryFacts {
  const fetchStatus: HarnessModelsFetchStatus = result.fetchStatus === "fetching"
    ? "fetching"
    : result.fetchStatus === "paused" ? "paused" : "idle";
  return {
    isError: Boolean(result.isError),
    // A structured server code (e.g. the cloud read's not-observed 404) is a
    // different fact from a transport failure, and only the error carries it.
    errorCode: result.error instanceof ProliferateClientError ? result.error.code : null,
    // The error middleware mints a `ProliferateClientError` from a non-2xx
    // RESPONSE, so its presence is proof the server answered. A rejected fetch
    // throws something else entirely, and that is the only failure where
    // "didn't respond" is established rather than assumed (E-R30).
    serverAnswered: result.error instanceof ProliferateClientError,
    isPending: Boolean(result.isPending),
    fetchStatus,
  };
}

/**
 * The one handler each retry affordance names. A `switch` with no `default:`
 * so a new affordance is a typecheck failure here rather than silently
 * inheriting whichever branch a ternary chain happened to end on.
 */
function retryHandler(
  retry: AllModelsRetryAffordance,
  handlers: {
    refetchRead: () => void;
    reprobeHarness: () => void;
    restartRuntime: (() => void) | null;
  },
): (() => void) | null {
  switch (retry) {
    case null:
      return null;
    case "refetch_read":
      return handlers.refetchRead;
    case "reprobe_harness":
      return handlers.reprobeHarness;
    case "restart_runtime":
      return handlers.restartRuntime;
  }
}

// Inert facts for the resolver's cloud inputs: the local surface never runs
// those queries, so they are permanently idle.
const IDLE_QUERY_FACTS: HarnessModelsQueryFacts = {
  isError: false,
  errorCode: null,
  serverAnswered: false,
  isPending: false,
  fetchStatus: "idle",
};

/**
 * Settings reads the selected target's launch-option response directly and
 * can request a new override-free observation. The models list exists only
 * where a runtime can observe it — the local surface; the cloud copy of
 * target-scoped launch options is deleted, so other surfaces render nothing.
 *
 * Every status decision lives in `resolveAllModelsPresentation`; this
 * component only renders what it returns.
 */
export function HarnessAllModelsSection({
  harnessKind,
  displayName,
  surface,
}: HarnessAllModelsSectionProps) {
  if (surface !== "local") {
    return null;
  }
  return <LocalAllModelsSection harnessKind={harnessKind} displayName={displayName} />;
}

function LocalAllModelsSection({
  harnessKind,
  displayName,
}: {
  harnessKind: string;
  displayName: string;
}) {
  const showToast = useToastStore((state) => state.show);
  // The fact behind a disabled local query: `ProductProviderRoot` blanks the
  // runtime URL for every non-healthy state, so the query alone cannot tell
  // "still connecting" from "gave up" (E-R22).
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  // Null on any host without the desktop runtime bridge, which is both "there
  // is no restart to offer" and "there is no local runtime to wait for"
  // (E-R33/E-R34). Capability, not `host.surface`, per the ProductHost
  // contract's own guidance.
  const restartLocalRuntime = useLocalRuntimeRestart();

  const refreshLaunchOptions = useRefreshHarnessLaunchOptionsMutation();
  const runtimeLaunchOptionsQuery = useAgentLaunchOptionsQuery({
    harnessKind,
    enabled: true,
  });
  const launchOptions = runtimeLaunchOptionsQuery.data;
  // Engine ownership is a fact about the runtime SERVING the response, kept
  // on the wire (rather than inferred) so a local runtime that stops sending
  // it is a build break instead of a silently dimmed Refresh.
  const payloadFacts: AllModelsPayloadFacts | undefined = runtimeLaunchOptionsQuery.data;
  const models = useMemo(
    () => normalizeRuntimeLaunchModels(harnessKind, launchOptions),
    [harnessKind, launchOptions],
  );

  const rows: ModelTableRow[] = models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description,
  }));

  const [filterText, setFilterText] = useState("");
  const [listExpanded, setListExpanded] = useState(false);
  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return rows;
    const needle = filterText.trim().toLowerCase();
    return rows.filter(
      (row) =>
        row.id.toLowerCase().includes(needle)
        || row.displayName.toLowerCase().includes(needle)
        || (row.description ?? "").toLowerCase().includes(needle),
    );
  }, [rows, filterText]);

  function handleRefresh() {
    refreshLaunchOptions.mutate(harnessKind, {
      onError: (error) => {
        showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
      },
    });
  }

  // Retry-on-load-failure refetches the query itself (no payload exists to
  // probe against yet); distinct from `handleRefresh`, which requests a new
  // probe over an already-answered harness.
  function handleRetryLoad() {
    void runtimeLaunchOptionsQuery.refetch?.();
  }

  // `formatRelativeTime` is the repo's one relative-age formatter (six other
  // call sites); reused rather than re-invented so "refreshed 2m ago" stays
  // byte-identical to every other surface's phrasing.
  const presentation = resolveAllModelsPresentation({
    surface: "local",
    displayName,
    connectionState,
    hasLocalRuntimeHost: restartLocalRuntime !== null,
    runtimeQuery: queryFacts(runtimeLaunchOptionsQuery),
    sandboxQuery: IDLE_QUERY_FACTS,
    hasCloudSandboxId: false,
    cloudLaunchOptionsQuery: IDLE_QUERY_FACTS,
    launchOptions: payloadFacts,
    isRefreshMutationPending: Boolean(refreshLaunchOptions.isPending),
    isRefreshMutationPaused: Boolean(refreshLaunchOptions.isPaused),
    modelCount: models.length,
    freshnessAgo: launchOptions?.observedAt ? formatRelativeTime(launchOptions.observedAt) : null,
  });
  const isRefreshing = presentation.refresh === "spinning";
  const onRetry = retryHandler(presentation.retry, {
    refetchRead: handleRetryLoad,
    reprobeHarness: handleRefresh,
    restartRuntime: restartLocalRuntime,
  });

  // Evidence is diagnostic only; executable membership remains the response.
  const diagnosticsLines: string[] = [];
  if (launchOptions) {
    diagnosticsLines.push(`Basis ${launchOptions.basisRevision} · revision ${launchOptions.revision}`);
  }

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.tabAllModels}
      titleWeight="emphasized"
      surface="plain"
      action={(
        <>
          {presentation.refresh === "absent" ? null : (
            // Busy keeps full ink: `disabled:opacity-100` in `className`
            // beats IconButton's own `disabled:opacity-50` (Tailwind orders
            // opacity utilities by scale value, not by class-list position,
            // so the higher value always wins the cascade once both are
            // present) — the sanctioned busy-not-unavailable idiom used by
            // SidebarUpdateFooterButton/WorkspaceCreationReceipt/
            // GitReviewTargetSelector. An UNAVAILABLE refresh keeps the
            // ordinary dimmed disabled look instead, because it is not busy.
            <IconButton
              aria-label={isRefreshing
                ? HARNESS_PANE_COPY.allModelsRefreshing
                : HARNESS_PANE_COPY.allModelsRefresh}
              title={HARNESS_PANE_COPY.allModelsRefresh}
              disabled={presentation.refresh !== "enabled"}
              className={isRefreshing ? "disabled:opacity-100" : undefined}
              onClick={handleRefresh}
            >
              <RefreshCw className={`icon-paired ${isRefreshing ? "animate-spin" : ""}`} />
            </IconButton>
          )}
          <IconButton
            aria-label={HARNESS_PANE_COPY.tabAllModels}
            aria-expanded={listExpanded}
            onClick={() => setListExpanded((open) => !open)}
          >
            <ChevronRight
              className={`icon-paired transition-transform ${listExpanded ? "rotate-90" : ""}`}
            />
          </IconButton>
        </>
      )}
      data-harness-status="models"
    >
      {/* The content line is the section's status text: re-announced only on
          state transitions (aria-live="polite"). */}
      <div className="flex items-center gap-3" aria-live="polite">
        <p className="text-body">
          {presentation.title ? (
            <span className="text-foreground">{presentation.title}</span>
          ) : null}
          {presentation.detail ? (
            <span className="text-ui text-muted-foreground/65">
              {presentation.title ? " · " : null}
              {presentation.detail}
            </span>
          ) : null}
        </p>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {HARNESS_PANE_COPY.allModelsRetry}
          </Button>
        ) : null}
      </div>

      {/*
        Disclosure is deferred here, recorded rather than re-derived: the model
        count above stays visible while this list collapses, and `Disclosure`
        puts every child inside its collapsible region — there is no
        always-visible body slot. The toggle also lives in the section's own
        `action` slot beside a refresh button, which `Disclosure`'s single
        header button cannot host. See the limitations block on
        primitives/patterns/Disclosure.tsx.
      */}
      <AnimatedCollapsibleContent expanded={listExpanded}>
      <div className="space-y-3 py-3">
        {diagnosticsLines.length > 0 ? (
          <div className="space-y-0.5">
            {diagnosticsLines.map((line) => (
              <p key={line} className="text-ui-sm text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <HarnessAllModelsFilterRow
            filterText={filterText}
            filteredCount={filteredRows.length}
            totalCount={rows.length}
            onChange={setFilterText}
            onClear={() => setFilterText("")}
          />
        ) : null}

        {presentation.kind === "loading" ? (
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsLoading}
          </p>
        ) : presentation.kind === "checking" && models.length === 0 ? (
          // E-R6: agree with the header only when there is no prior list to
          // show yet (a first observation in progress). A re-probe over
          // last-good data (`state === "refreshing"` with existing models)
          // must keep the list visible undimmed — same "data stays readable
          // while we wait" contract as state 6 — never blank it out for a
          // "Checking…" placeholder.
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsChecking}
          </p>
        ) : models.length === 0 ? (
          // E-R14/E-R19: `emptyBody` is null whenever the header already
          // carries the reason the list is empty, so no arm can print a body
          // that contradicts its own header.
          presentation.emptyBody === null ? null : (
            <p className="text-ui-sm text-muted-foreground">
              {presentation.emptyBody}
            </p>
          )
        ) : (
          <ModelTable models={filteredRows} />
        )}
      </div>
      </AnimatedCollapsibleContent>
    </SettingsSection>
  );
}
