import { useMemo, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentModels,
  useUpsertAgentModelOverride,
} from "@proliferate/cloud-sdk-react";
import {
  useAgentLaunchOptionsQuery,
  useModelSnapshotStatusQuery,
  useRefreshModelSnapshotMutation,
} from "@anyharness/sdk-react";
import { ChevronRight, Search, X } from "#product/primitives/icons/core";
import { RefreshCw } from "#product/primitives/icons/platform";
import { AnimatedCollapsibleContent } from "#product/primitives/AnimatedCollapsibleContent";
import { Button } from "#product/primitives/Button";
import { IconButton } from "#product/primitives/IconButton";
import { Input } from "#product/primitives/Input";
import { ModelTable, type ModelTableRow } from "#product/components/settings/panes/agents/harness/ModelTable";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "#product/stores/toast/toast-store";
import {
  buildEnabledOverridePatchJson,
  normalizeCatalogModels,
  normalizeRuntimeLaunchModels,
} from "#product/lib/domain/settings/harness-catalog";
import {
  formatSnapshotAge,
  resolveComposedObservation,
} from "#product/lib/domain/settings/model-snapshot-observation";

interface HarnessAllModelsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}

/**
 * The All Models surface, re-cut to the composed observation
 * (model-catalog.md "The picker is the observation"): ONE observation per
 * harness — no per-context tabs or rows.
 *
 * - Local surface: the runtime's machine observation is the truth. The
 *   polled status route carries the model/mode lists off the same document
 *   read, the `probedAt` age, the `lastAttempt` failed-refresh indicator,
 *   and the provenance fields (attestation, install identity) rendered as
 *   diagnostics only. Manual Refresh calls the param-less refresh route —
 *   the one manual poke in the closed event set; there is no auto-probe
 *   here, because the five events are the only probe spawn sites.
 * - Cloud surface: the layered read (the cloud sandbox's observation at
 *   rest, else the shipped catalog's models as the read-time seed) with the
 *   user's override patch applied.
 *
 * Where the shipped catalog serves in place of an observation (local before
 * the first probe; cloud `origin === "catalog"`), the list is marked as
 * unverified seed data.
 */
export function HarnessAllModelsSection({
  harnessKind,
  displayName,
  surface,
}: HarnessAllModelsSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);
  const isLocal = surface === "local";

  // Cloud (machineless) branch: the layered read off the context-free route —
  // one composed observation per (owner, harness), the cloud sandbox's
  // document at rest else the shipped catalog's read-time seed, with the
  // user's override patch applied. The former per-auth-context routing
  // (authContextId resolution off the enabled selections) is deleted with the
  // (owner, harness) re-key (model-catalog.md §Cloud routes).
  const agentModelsQuery = useAgentModels(harnessKind, cloudActive && !isLocal);
  const upsertOverride = useUpsertAgentModelOverride();

  // Local branch: the composed observation off the runtime's polled status
  // route, plus the manual-refresh poke. Works signed in or out — the
  // runtime, not the cloud session, owns this document.
  const modelSnapshotStatusQuery = useModelSnapshotStatusQuery(harnessKind, {
    enabled: isLocal,
  });
  const refreshModelSnapshot = useRefreshModelSnapshotMutation();
  const observation = useMemo(
    () => resolveComposedObservation(modelSnapshotStatusQuery.data),
    [modelSnapshotStatusQuery.data],
  );
  const hasObservation = Boolean(observation?.probedAt);
  // Pre-first-observation window: the runtime-resolved launch options are the
  // shipped catalog's seed on this machine, rendered marked as unverified.
  const runtimeLaunchOptionsQuery = useAgentLaunchOptionsQuery({
    enabled: isLocal && !hasObservation,
  });

  const models = useMemo(() => {
    if (isLocal) {
      if (observation && hasObservation) {
        return observation.models;
      }
      return normalizeRuntimeLaunchModels(harnessKind, runtimeLaunchOptionsQuery.data);
    }
    return normalizeCatalogModels(agentModelsQuery.data?.models ?? []);
  }, [
    isLocal,
    observation,
    hasObservation,
    harnessKind,
    runtimeLaunchOptionsQuery.data,
    agentModelsQuery.data?.models,
  ]);

  // Seed marking: the shipped catalog serving in true absence of an
  // observation, never overriding one.
  const isSeed = isLocal
    ? !hasObservation
    : agentModelsQuery.data?.origin === "catalog";

  // Each row carries its own enriched metadata; probe-only models stay sparse
  // (Provider "—" when unmatched — no harness-name fallback). Observation
  // rows have no override endpoint on this surface, so their toggle is
  // read-only; the cloud layered read keeps its override toggles.
  const rows: ModelTableRow[] = models.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description,
    provider: model.provider,
    status: model.status,
    effort: model.effort,
    modes: model.modes,
    fastMode: model.fastMode,
    enabled: model.enabled,
    toggleDisabled: isLocal || upsertOverride.isPending,
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
    refreshModelSnapshot.mutate(harnessKind, {
      onError: (error) => {
        showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
      },
    });
  }

  function handleToggle(modelId: string, enabled: boolean) {
    if (isLocal) {
      return;
    }
    upsertOverride.mutate(
      {
        harnessKind,
        body: { patchJson: buildEnabledOverridePatchJson(models, modelId, enabled) },
      },
      {
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.catalogOverrideError(displayName));
        },
      },
    );
  }

  const isLoading = isLocal
    ? modelSnapshotStatusQuery.isLoading
      || (!hasObservation && runtimeLaunchOptionsQuery.isLoading)
    : agentModelsQuery.isLoading;
  const isRefreshing = isLocal
    && (
      refreshModelSnapshot.isPending
      || observation?.engineState === "queued"
      || observation?.engineState === "running"
    );
  // Empty list with a probe in flight shows the probing state instead of the
  // static empty copy.
  const isProbingEmpty = models.length === 0 && isRefreshing;

  // The only freshness display: the observation's age (event-driven; age
  // never disqualifies) — or the unverified-seed line while the shipped
  // catalog fills absence.
  const freshnessLine = isLocal
    ? observation && hasObservation
      ? observation.ageSeconds != null
        ? HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(formatSnapshotAge(observation.ageSeconds))
        : `Last refreshed ${new Date(observation.probedAt ?? "").toLocaleString()}`
      : HARNESS_PANE_COPY.allModelsSeedDescription
    : agentModelsQuery.data?.probedAt
      ? `Last refreshed ${new Date(agentModelsQuery.data.probedAt).toLocaleString()}`
      : isSeed
        ? HARNESS_PANE_COPY.allModelsSeedDescription
        : "";

  // Diagnostics only (model-catalog.md: "the provenance fields are not
  // gates") — what binary and install answered, and which modes it advertised.
  const diagnosticsLines: string[] = [];
  if (isLocal && observation?.provenance) {
    diagnosticsLines.push(HARNESS_PANE_COPY.allModelsProvenance(observation.provenance));
  }
  if (isLocal && hasObservation && observation && observation.modes.length > 0) {
    diagnosticsLines.push(HARNESS_PANE_COPY.allModelsModes(observation.modes));
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
        || (row.description ?? "").toLowerCase().includes(needle)
        || (row.provider ?? "").toLowerCase().includes(needle),
    );
  }, [rows, filterText]);

  // The quiet v2 header (design-handoff "Models section"): title + refresh
  // icon + rotating chevron on the right; ONE content line — the model count
  // in foreground with the provenance/freshness suffix muted. No badge pile,
  // no long seed description.
  const contentSuffix = isLoading
    ? HARNESS_PANE_COPY.allModelsLoading
    : isRefreshing
      ? HARNESS_PANE_COPY.allModelsProbing
      : isLocal && observation?.lastAttemptFailed
        ? HARNESS_PANE_COPY.allModelsRefreshFailedBadge
        : isSeed
          ? HARNESS_PANE_COPY.allModelsSeedSuffix
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
          // Canonical picker-search treatment (PopoverSearchField recipe): muted
          // magnifier + borderless transparent input — no boxed field — with a
          // hairline divider between the row and the table below. py-[7px]
          // matches PopoverSearchField's own filter-row height exactly, so the
          // two recipes stay pixel-identical rather than drifting to the
          // nearest space-scale step.
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-[7px]">
            <Search className="icon-paired shrink-0 text-muted-foreground/75" />
            <Input
              aria-label="Filter models"
              placeholder="Filter models..."
              value={filterText}
              className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-ui shadow-none focus:ring-0"
              onChange={(event) => setFilterText(event.target.value)}
            />
            {filterText ? (
              <span className="flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
                {filteredRows.length} of {rows.length}
                <Button
                  variant="unstyled"
                  size="unstyled"
                  type="button"
                  aria-label="Clear filter"
                  className="rounded p-0.5 hover:bg-hover active:bg-active"
                  onClick={() => setFilterText("")}
                >
                  <X className="icon-compact" />
                </Button>
              </span>
            ) : null}
          </div>
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
          <ModelTable models={filteredRows} onToggle={handleToggle} />
        )}
      </div>
      </AnimatedCollapsibleContent>
    </SettingsSection>
  );
}
