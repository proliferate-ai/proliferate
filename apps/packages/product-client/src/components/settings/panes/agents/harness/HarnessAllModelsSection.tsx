import { useMemo, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useCloudHarnessLaunchOptions,
  useCloudSandbox,
} from "@proliferate/cloud-sdk-react";
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
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "#product/stores/toast/toast-store";
import { normalizeRuntimeLaunchModels } from "#product/lib/domain/settings/harness-catalog";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";

interface HarnessAllModelsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}

/**
 * Settings reads the selected target's launch-option response directly.
 * Local can request a new override-free observation; cloud reads the copied
 * target-scoped state and never seeds or overrides executable membership.
 */
export function HarnessAllModelsSection({
  harnessKind,
  displayName,
  surface,
}: HarnessAllModelsSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);
  const isLocal = surface === "local";

  const refreshLaunchOptions = useRefreshHarnessLaunchOptionsMutation();
  const cloudSandbox = useCloudSandbox(!isLocal && cloudActive);
  const cloudLaunchOptionsQuery = useCloudHarnessLaunchOptions({
    cloudSandboxId: cloudSandbox.data?.id,
    harnessKind,
    enabled: !isLocal && cloudActive,
  });
  const runtimeLaunchOptionsQuery = useAgentLaunchOptionsQuery({
    harnessKind,
    enabled: isLocal,
  });
  const launchOptions = isLocal
    ? runtimeLaunchOptionsQuery.data
    : cloudLaunchOptionsQuery.data;
  const models = useMemo(
    () => normalizeRuntimeLaunchModels(harnessKind, launchOptions),
    [harnessKind, launchOptions],
  );

  const rows: ModelTableRow[] = models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description,
  }));

  if (!isLocal && !cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.tabAllModels} titleWeight="emphasized" surface="plain">
        <p className="text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  // Manual refresh exists only where a caller can actually trigger a probe:
  // the runtime's param-less refresh route. The cloud-snapshot ingest route
  // is Worker-authenticated only, so the cloud branch has no refresh
  // affordance.
  const canManuallyRefresh = isLocal;

  function handleRefresh() {
    if (!isLocal) {
      return;
    }
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
    if (isLocal) {
      void runtimeLaunchOptionsQuery.refetch?.();
    } else {
      void cloudSandbox.refetch?.();
      void cloudLaunchOptionsQuery.refetch?.();
    }
  }

  const isLoading = isLocal
    ? runtimeLaunchOptionsQuery.isLoading
    : cloudSandbox.isLoading || cloudLaunchOptionsQuery.isLoading;
  const isQueryError = isLocal
    ? Boolean(runtimeLaunchOptionsQuery.isError)
    : Boolean(cloudSandbox.isError) || Boolean(cloudLaunchOptionsQuery.isError);

  // Absent when the runtime that served this response cannot know the phase
  // (e.g. the cloud-copied snapshot), which is exactly the same as "not
  // live" for every check below. `queued` counts as live alongside `running`:
  // it is the same bucket the polling policy in
  // `resolveAgentLaunchOptionsRefetchInterval` treats as active (agents.ts
  // :105-107) — a probe that is about to run is not a settled-unobserved
  // harness, so it must not read as the calm, permanent idle-unobserved copy.
  const probePhase = isLocal ? runtimeLaunchOptionsQuery.data?.probePhase : undefined;
  const isProbeLive = probePhase === "running" || probePhase === "queued";

  // `state=refreshing` is live only on the surface that can ever resolve it:
  // cloud has no refetch interval and no Refresh control, so a copied
  // `refreshing` snapshot there is not "checking" — it is last-good data
  // that only a remount can refresh (E-R12). `state=detecting` is ambiguous
  // on its own, so it needs the phase check to tell an active first
  // observation apart from a settled-unobserved harness.
  const isChecking = (isLocal && launchOptions?.state === "refreshing")
    || (launchOptions?.state === "detecting" && isProbeLive);
  const isIdleUnobserved = launchOptions?.state === "detecting" && !isProbeLive;

  // The 32-minute bug's exact shape through a different door (E-R9): deriving
  // "busy" from the raw `probePhase` disables Refresh in EVERY state,
  // including terminal ones (e.g. `observed` + a stray live `probePhase`)
  // that `resolveAgentLaunchOptionsRefetchInterval` never polls — frozen
  // data behind a disabled button, with nothing ever scheduled to update it.
  // Tying busy to `isChecking` instead means Refresh is disabled ONLY in a
  // state that is actually polling (or mid-mutation), so it always has a
  // way out. Also resolves E-R10: `failed_without_observation` can no
  // longer show a disabled-and-spinning header next to an enabled Retry.
  const isRefreshing = isLocal && (refreshLaunchOptions.isPending || isChecking);

  const modelCount = models.length;
  // `formatRelativeTime` is the repo's one relative-age formatter (six other
  // call sites); reused rather than re-invented so "refreshed 2m ago" stays
  // byte-identical to every other surface's phrasing.
  const ago = launchOptions?.observedAt ? formatRelativeTime(launchOptions.observedAt) : null;
  const freshnessLine = ago ? HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(ago) : null;

  // The one content line per state (Settings - Harness Models States
  // handoff): a raw wire state string is never rendered as copy, and the
  // model count never renders before a settled observation exists.
  const content: { foreground: string | null; muted: string | null; retry: (() => void) | null } = (() => {
    if (isLoading) {
      return { foreground: null, muted: HARNESS_PANE_COPY.allModelsLoading, retry: null };
    }
    if (!launchOptions) {
      // E-R13: `isLoading` is already false here (guarded above), so a local
      // query with no data and no error is a DISABLED query — the runtime
      // has no URL yet (`useAgentLaunchOptionsQuery` requires
      // `runtimeUrl.length > 0`) — not one still in flight. Left alone this
      // sits on "Loading models…" forever, a ninth state outside the
      // spec's eight; state 8's copy is the closest honest match.
      return isQueryError || isLocal
        ? {
          foreground: HARNESS_PANE_COPY.allModelsTransportErrorTitle,
          muted: HARNESS_PANE_COPY.allModelsTransportErrorReason,
          retry: handleRetryLoad,
        }
        : { foreground: null, muted: HARNESS_PANE_COPY.allModelsLoading, retry: null };
    }
    if (isChecking) {
      return { foreground: null, muted: HARNESS_PANE_COPY.allModelsChecking, retry: null };
    }
    if (isIdleUnobserved) {
      return {
        foreground: HARNESS_PANE_COPY.allModelsIdleUnobservedTitle,
        muted: HARNESS_PANE_COPY.allModelsIdleUnobservedSuffix(displayName, canManuallyRefresh),
        retry: null,
      };
    }
    switch (launchOptions.state) {
      case "observed":
      // E-R12: only reachable here on cloud (isChecking already consumed
      // `refreshing` unconditionally for local) — cloud has no refetch
      // interval and no Refresh control, so a copied `refreshing` snapshot
      // is rendered as its last-good count + freshness, not as "checking".
      case "refreshing":
        return { foreground: HARNESS_PANE_COPY.probeModelCount(modelCount), muted: freshnessLine, retry: null };
      case "observed_empty":
        return {
          foreground: HARNESS_PANE_COPY.probeModelCount(modelCount),
          muted: ago ? HARNESS_PANE_COPY.allModelsObservedEmptySuffix(displayName, ago) : null,
          retry: null,
        };
      case "last_good_after_failure":
        return {
          foreground: HARNESS_PANE_COPY.probeModelCount(modelCount),
          muted: ago
            ? HARNESS_PANE_COPY.allModelsLastGoodAfterFailureSuffix(ago)
            : HARNESS_PANE_COPY.allModelsRefreshFailedBadge,
          retry: null,
        };
      case "failed_without_observation":
        return {
          foreground: HARNESS_PANE_COPY.allModelsFailedWithoutObservationTitle,
          muted: HARNESS_PANE_COPY.allModelsProbeFailureReason(displayName),
          retry: canManuallyRefresh ? handleRefresh : null,
        };
      default:
        return { foreground: null, muted: freshnessLine, retry: null };
    }
  })();

  // Evidence is diagnostic only; executable membership remains the response.
  const diagnosticsLines: string[] = [];
  if (launchOptions) {
    diagnosticsLines.push(`Basis ${launchOptions.basisRevision} · revision ${launchOptions.revision}`);
  }

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

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.tabAllModels}
      titleWeight="emphasized"
      surface="plain"
      action={(
        <>
          {canManuallyRefresh ? (
            // Busy keeps full ink: `disabled:opacity-100` in `className`
            // beats IconButton's own `disabled:opacity-50` (Tailwind orders
            // opacity utilities by scale value, not by class-list position,
            // so the higher value always wins the cascade once both are
            // present) — the sanctioned busy-not-unavailable idiom used by
            // SidebarUpdateFooterButton/WorkspaceCreationReceipt/
            // GitReviewTargetSelector. IconButton itself stays unchanged.
            <IconButton
              aria-label={isRefreshing
                ? HARNESS_PANE_COPY.allModelsRefreshing
                : HARNESS_PANE_COPY.allModelsRefresh}
              title={HARNESS_PANE_COPY.allModelsRefresh}
              disabled={isRefreshing}
              className={isRefreshing ? "disabled:opacity-100" : undefined}
              onClick={handleRefresh}
            >
              <RefreshCw className={`icon-paired ${isRefreshing ? "animate-spin" : ""}`} />
            </IconButton>
          ) : null}
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
          {content.foreground ? (
            <span className="text-foreground">{content.foreground}</span>
          ) : null}
          {content.muted ? (
            <span className="text-ui text-muted-foreground/65">
              {content.foreground ? " · " : null}
              {content.muted}
            </span>
          ) : null}
        </p>
        {content.retry ? (
          <Button variant="secondary" size="sm" onClick={content.retry}>
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

        {isLoading ? (
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsLoading}
          </p>
        ) : isChecking && models.length === 0 ? (
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
          // E-R14: the header already carries the reason for an empty list
          // in these two states (transport error / no observation ever
          // succeeded) — echoing "No models detected yet." underneath would
          // contradict it, e.g. "...The runtime didn't respond." followed by
          // "No models detected yet." for a request that never answered.
          isQueryError || launchOptions?.state === "failed_without_observation" ? null : (
            <p className="text-ui-sm text-muted-foreground">
              {HARNESS_PANE_COPY.allModelsEmpty}
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
