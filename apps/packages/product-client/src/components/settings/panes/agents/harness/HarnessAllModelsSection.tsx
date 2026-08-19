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
import { IconButton } from "#product/primitives/IconButton";
import { HarnessAllModelsFilterRow } from "#product/components/settings/panes/agents/harness/HarnessAllModelsFilterRow";
import { ModelTable, type ModelTableRow } from "#product/components/settings/panes/agents/harness/ModelTable";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "#product/stores/toast/toast-store";
import { normalizeRuntimeLaunchModels } from "#product/lib/domain/settings/harness-catalog";

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

  const isLoading = isLocal
    ? runtimeLaunchOptionsQuery.isLoading
    : cloudSandbox.isLoading || cloudLaunchOptionsQuery.isLoading;
  const isRefreshing = isLocal
    && (refreshLaunchOptions.isPending || runtimeLaunchOptionsQuery.data?.state === "refreshing" || runtimeLaunchOptionsQuery.data?.state === "detecting");
  // Empty list with a probe in flight shows the probing state instead of the
  // static empty copy.
  const isProbingEmpty = models.length === 0 && isRefreshing;

  const freshnessLine = launchOptions?.observedAt
    ? `Last refreshed ${new Date(launchOptions.observedAt).toLocaleString()}`
    : launchOptions?.state ?? "";

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

  // The quiet v2 header (design-handoff "Models section"): title + refresh
  // icon + rotating chevron on the right; ONE content line — the model count
  // in foreground with the provenance/freshness suffix muted. No badge pile,
  // no long fallback description.
  const contentSuffix = isLoading
    ? HARNESS_PANE_COPY.allModelsLoading
    : isRefreshing
      ? HARNESS_PANE_COPY.allModelsProbing
      : launchOptions?.state === "last_good_after_failure"
        ? HARNESS_PANE_COPY.allModelsRefreshFailedBadge
        : freshnessLine;

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.tabAllModels}
      titleWeight="emphasized"
      surface="plain"
      action={(
        <>
          {canManuallyRefresh ? (
            <IconButton
              aria-label={isRefreshing
                ? HARNESS_PANE_COPY.allModelsRefreshing
                : HARNESS_PANE_COPY.allModelsRefresh}
              title={HARNESS_PANE_COPY.allModelsRefresh}
              disabled={isRefreshing}
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
      <p className="text-body">
        <span className="text-foreground">
          {HARNESS_PANE_COPY.probeModelCount(models.length)}
        </span>
        {contentSuffix ? (
          <span className="text-ui text-muted-foreground/65">
            {" · "}
            {contentSuffix}
          </span>
        ) : null}
      </p>

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
        ) : isProbingEmpty ? (
          <p className="flex items-center gap-2 text-ui-sm text-muted-foreground">
            <RefreshCw className="icon-paired animate-spin" />
            {HARNESS_PANE_COPY.allModelsProbing}
          </p>
        ) : models.length === 0 ? (
          <p className="text-ui-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsEmpty}
          </p>
        ) : (
          <ModelTable models={filteredRows} />
        )}
      </div>
      </AnimatedCollapsibleContent>
    </SettingsSection>
  );
}
