import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentCatalog,
  useRefreshAgentCatalog,
  useAuthSelections,
  useUpsertCatalogOverride,
} from "@proliferate/cloud-sdk-react";
import {
  useAgentGatewayModelsQuery,
  useAgentLaunchOptionsQuery,
  useRefreshAgentGatewayModelsMutation,
} from "@anyharness/sdk-react";
import { RefreshCw, X } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModelTable, type ModelTableRow } from "@proliferate/product-ui/settings/ModelTable";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  buildEnabledOverridePatchJson,
  buildRuntimeCatalogModelsJson,
  catalogRouteForSurface,
  normalizeCatalogModels,
  normalizeGatewayModels,
} from "@/lib/domain/settings/harness-catalog";

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
  const route = catalogRouteForSurface(
    harnessKind,
    surface,
    selectionsQuery.data ?? [],
  );
  // Local surface + gateway route: the RUNTIME has already resolved what its
  // harness + auth can actually reach (contract §5) — read that directly
  // instead of the cloud catalog snapshot, which never sees the runtime's own
  // gateway probes.
  const isRuntimeGateway = surface === "local" && route === "gateway";
  // native/api_key routes probe on the client (catalog.py's refresh_catalog
  // contract) — the server rejects a refresh with no uploaded payload for
  // these routes, so Refresh sources one from the local AnyHarness runtime's
  // already-resolved launch catalog instead (see buildRuntimeCatalogModelsJson).
  const isRuntimeProbedRoute = route !== "gateway";

  const catalogQuery = useAgentCatalog(
    { harnessKind, surface, route },
    cloudActive && !isRuntimeGateway,
  );
  const refreshCatalog = useRefreshAgentCatalog();
  const upsertOverride = useUpsertCatalogOverride();

  const gatewayModelsQuery = useAgentGatewayModelsQuery(harnessKind, {
    enabled: isRuntimeGateway,
  });
  const refreshGatewayModels = useRefreshAgentGatewayModelsMutation();
  const runtimeLaunchOptionsQuery = useAgentLaunchOptionsQuery({
    enabled: isRuntimeProbedRoute,
  });

  const models = useMemo(
    () =>
      isRuntimeGateway
        ? normalizeGatewayModels(gatewayModelsQuery.data?.models ?? [])
        : normalizeCatalogModels(catalogQuery.data?.models ?? []),
    [isRuntimeGateway, gatewayModelsQuery.data?.models, catalogQuery.data?.models],
  );
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
    toggleDisabled: isRuntimeGateway || upsertOverride.isPending,
  }));

  if (!cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.tabAllModels}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  function handleRefresh() {
    if (isRuntimeGateway) {
      refreshGatewayModels.mutate(harnessKind, {
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
        },
      });
      return;
    }
    if (isRuntimeProbedRoute) {
      const modelsJson = buildRuntimeCatalogModelsJson(
        harnessKind,
        runtimeLaunchOptionsQuery.data,
      );
      if (modelsJson === null) {
        showToast(HARNESS_PANE_COPY.catalogRefreshRuntimeUnavailable(displayName));
        return;
      }
      refreshCatalog.mutate(
        { harnessKind, body: { surface, route, modelsJson } },
        {
          onError: (error) => {
            showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
          },
        },
      );
      return;
    }
    refreshCatalog.mutate(
      { harnessKind, body: { surface, route } },
      {
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.catalogRefreshError(displayName));
        },
      },
    );
  }

  function handleToggle(modelId: string, enabled: boolean) {
    if (isRuntimeGateway) {
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

  const isLoading = isRuntimeGateway ? gatewayModelsQuery.isLoading : catalogQuery.isLoading;
  const isRefreshing = isRuntimeGateway ? refreshGatewayModels.isPending : refreshCatalog.isPending;

  // Auto-probe an empty catalog: landing on a resolved-but-empty catalog kicks
  // off the same refresh the button uses, exactly once per (harnessKind, surface,
  // route) scope. Guards against loops — we only fire when nothing is
  // loading/refreshing and we haven't already probed this scope. For
  // runtime-probed routes we skip when the runtime launch options aren't
  // available yet (buildRuntimeCatalogModelsJson would be null); the empty
  // message stays until the runtime is reachable.
  const autoProbedScopeRef = useRef<string | null>(null);
  const autoProbeScope = `${harnessKind}:${surface}:${route}`;
  const runtimeModelsUnavailable =
    isRuntimeProbedRoute
    && buildRuntimeCatalogModelsJson(harnessKind, runtimeLaunchOptionsQuery.data) === null;
  useEffect(() => {
    if (!cloudActive || isLoading || isRefreshing || models.length > 0) {
      return;
    }
    if (autoProbedScopeRef.current === autoProbeScope) {
      return;
    }
    if (runtimeModelsUnavailable) {
      return;
    }
    autoProbedScopeRef.current = autoProbeScope;
    handleRefresh();
  }, [
    cloudActive,
    isLoading,
    isRefreshing,
    models.length,
    autoProbeScope,
    runtimeModelsUnavailable,
  ]);
  // Empty catalog with a probe in flight (auto or manual) shows the probing state
  // instead of the static empty copy.
  const isProbingEmpty = models.length === 0 && isRefreshing;
  const freshnessLine = isRuntimeGateway
    ? gatewayModelsQuery.data
      ? gatewayModelsQuery.data.source === "probe" && gatewayModelsQuery.data.probedAt
        ? HARNESS_PANE_COPY.allModelsFreshnessProbed(
          new Date(gatewayModelsQuery.data.probedAt).toLocaleString(),
        )
        : HARNESS_PANE_COPY.allModelsFreshnessSeed
      : ""
    : catalogQuery.data?.probedAt
      ? `Last refreshed ${new Date(catalogQuery.data.probedAt).toLocaleString()}`
      : catalogQuery.data?.source
        ? `Source: ${catalogQuery.data.source}`
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
          <p className="text-xs text-muted-foreground">{freshnessLine}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw
              className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing
              ? HARNESS_PANE_COPY.allModelsRefreshing
              : HARNESS_PANE_COPY.allModelsRefresh}
          </Button>
        </div>

        {rows.length > 0 ? (
          <div className="relative">
            <Input
              aria-label="Filter models"
              placeholder="Filter models..."
              value={filterText}
              className="h-8 pr-14 text-xs"
              onChange={(event) => setFilterText(event.target.value)}
            />
            {filterText ? (
              <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[10px] text-muted-foreground">
                {filteredRows.length} of {rows.length}
                <button
                  type="button"
                  aria-label="Clear filter"
                  className="rounded p-0.5 hover:bg-accent"
                  onClick={() => setFilterText("")}
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsLoading}
          </p>
        ) : isProbingEmpty ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />
            {HARNESS_PANE_COPY.allModelsProbing}
          </p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsEmpty}
          </p>
        ) : (
          <ModelTable models={filteredRows} onToggle={handleToggle} />
        )}
      </div>
    </SettingsSection>
  );
}
