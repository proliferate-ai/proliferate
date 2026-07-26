import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentModels,
  useAuthSelections,
  useUpsertAgentModelOverride,
} from "@proliferate/cloud-sdk-react";
import {
  useAgentGatewayModelsQuery,
  useAgentLaunchOptionsQuery,
  useRefreshAgentGatewayModelsMutation,
} from "@anyharness/sdk-react";
import { RefreshCw, Search, X } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModelTable, type ModelTableRow } from "@proliferate/product-ui/settings/ModelTable";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "#product/stores/toast/toast-store";
import {
  apiKeyProviderHintForSurface,
  authContextIdForRoute,
  buildEnabledOverridePatchJson,
  catalogRouteForSurface,
  normalizeCatalogModels,
  normalizeGatewayModels,
  normalizeRuntimeLaunchModels,
} from "#product/lib/domain/settings/harness-catalog";

interface HarnessAllModelsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}

export function HarnessAllModelsSection({
  harnessKind,
  displayName,
  surface,
}: HarnessAllModelsSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  const selectionsQuery = useAuthSelections(null, cloudActive);
  const selections = cloudActive ? selectionsQuery.data ?? [] : [];
  const route = catalogRouteForSurface(harnessKind, surface, selections);
  // Local surface + gateway route: the RUNTIME has already resolved what its
  // harness + auth can actually reach (contract §5) — read that directly
  // instead of the cloud catalog snapshot, which never sees the runtime's own
  // gateway probes.
  const isRuntimeGateway = surface === "local" && route === "gateway";
  const isSignedOutLocal = surface === "local" && !cloudActive;

  // The B4 cloud-snapshot re-key (model-catalog.md §Cloud routes) scopes the
  // layered read by auth-context id rather than (surface, route); resolve the
  // best-known context id for the active route (see authContextIdForRoute's
  // docstring for the exact mapping and its limits).
  const authContextId = authContextIdForRoute(
    harnessKind,
    route,
    apiKeyProviderHintForSurface(harnessKind, surface, selections),
  );
  const agentModelsQuery = useAgentModels(
    { harnessKind, authContextId },
    cloudActive && !isRuntimeGateway,
  );
  const upsertOverride = useUpsertAgentModelOverride();

  const gatewayModelsQuery = useAgentGatewayModelsQuery(harnessKind, {
    enabled: cloudActive && isRuntimeGateway,
  });
  const refreshGatewayModels = useRefreshAgentGatewayModelsMutation();
  const runtimeLaunchOptionsQuery = useAgentLaunchOptionsQuery({
    enabled: isSignedOutLocal,
  });

  // Manual refresh only exists where a caller can actually trigger a probe:
  // the signed-out-local runtime refetch, and the runtime-gateway mutation.
  // The cloud-snapshot ingest route is Worker-authenticated only
  // (`authenticate_worker`) — no product client can call it — so there is no
  // refresh affordance for the native/api_key/cloud-surface branch below
  // until a real caller exists (F-040; tracked to return in C3).
  const canManuallyRefresh = isSignedOutLocal || isRuntimeGateway;

  const models = useMemo(() => {
    if (isSignedOutLocal) {
      return normalizeRuntimeLaunchModels(harnessKind, runtimeLaunchOptionsQuery.data);
    }
    if (isRuntimeGateway) {
      return normalizeGatewayModels(gatewayModelsQuery.data?.models ?? []);
    }
    return normalizeCatalogModels(agentModelsQuery.data?.models ?? []);
  }, [
    isSignedOutLocal,
    harnessKind,
    runtimeLaunchOptionsQuery.data,
    isRuntimeGateway,
    gatewayModelsQuery.data?.models,
    agentModelsQuery.data?.models,
  ]);
  // Each row carries its own enriched metadata (contract §1); probe-only models
  // stay sparse (Provider "—" when unmatched — no harness-name fallback).
  // Runtime-resolved gateway models have no override endpoint yet, so their
  // toggle is read-only.
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
    toggleDisabled: isSignedOutLocal || isRuntimeGateway || upsertOverride.isPending,
  }));

  if (surface === "cloud" && !cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.tabAllModels}>
        <p className="py-3 text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  function handleRefresh() {
    if (isSignedOutLocal) {
      void runtimeLaunchOptionsQuery.refetch();
      return;
    }
    if (isRuntimeGateway) {
      refreshGatewayModels.mutate(harnessKind, {
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
        },
      });
      return;
    }
    // No callable refresh for the cloud-snapshot branch — see
    // `canManuallyRefresh` above. The button is not rendered in this case, so
    // this branch is unreachable from the UI; it stays only as a safe no-op.
  }

  function handleToggle(modelId: string, enabled: boolean) {
    if (isSignedOutLocal || isRuntimeGateway) {
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

  const isLoading = isSignedOutLocal
    ? runtimeLaunchOptionsQuery.isLoading
    : isRuntimeGateway
      ? gatewayModelsQuery.isLoading
      : agentModelsQuery.isLoading;
  const isRefreshing = isSignedOutLocal
    ? runtimeLaunchOptionsQuery.isFetching
    : isRuntimeGateway
      ? refreshGatewayModels.isPending
      : false;

  // Auto-probe an empty catalog: landing on a resolved-but-empty catalog kicks
  // off the same refresh the button uses, exactly once per (harnessKind, surface,
  // route) scope. Guards against loops — we only fire when nothing is
  // loading/refreshing, we haven't already probed this scope, and a manual
  // refresh actually exists for this branch (see `canManuallyRefresh`).
  const autoProbedScopeRef = useRef<string | null>(null);
  const autoProbeScope = `${harnessKind}:${surface}:${route}`;
  useEffect(() => {
    if (!canManuallyRefresh || !cloudActive || isLoading || isRefreshing || models.length > 0) {
      return;
    }
    if (autoProbedScopeRef.current === autoProbeScope) {
      return;
    }
    autoProbedScopeRef.current = autoProbeScope;
    handleRefresh();
  }, [
    canManuallyRefresh,
    cloudActive,
    isLoading,
    isRefreshing,
    models.length,
    autoProbeScope,
  ]);
  // Empty catalog with a probe in flight (auto or manual) shows the probing state
  // instead of the static empty copy.
  const isProbingEmpty = models.length === 0 && isRefreshing;
  const freshnessLine = isSignedOutLocal
    ? ""
    : isRuntimeGateway
    ? gatewayModelsQuery.data
      ? gatewayModelsQuery.data.source === "probe" && gatewayModelsQuery.data.probedAt
        ? HARNESS_PANE_COPY.allModelsFreshnessProbed(
          new Date(gatewayModelsQuery.data.probedAt).toLocaleString(),
        )
        : HARNESS_PANE_COPY.allModelsFreshnessSeed
      : ""
    : agentModelsQuery.data?.probedAt
      ? `Last refreshed ${new Date(agentModelsQuery.data.probedAt).toLocaleString()}`
      : agentModelsQuery.data?.origin
        ? `Source: ${agentModelsQuery.data.origin}`
        : "";

  const [filterText, setFilterText] = useState("");
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

  return (
    <SettingsSection title={HARNESS_PANE_COPY.tabAllModels}>
      <div className="space-y-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui-sm text-muted-foreground">{freshnessLine}</p>
          {canManuallyRefresh ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-2"
              disabled={isRefreshing}
              onClick={handleRefresh}
            >
              <RefreshCw
                className={`icon-paired ${isRefreshing ? "animate-spin" : ""}`}
              />
              {isRefreshing
                ? HARNESS_PANE_COPY.allModelsRefreshing
                : HARNESS_PANE_COPY.allModelsRefresh}
            </Button>
          ) : null}
        </div>

        {rows.length > 0 ? (
          // Canonical picker-search treatment (PopoverSearchField recipe): muted
          // magnifier + borderless transparent input — no boxed field — with a
          // hairline divider between the row and the table below.
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
    </SettingsSection>
  );
}
