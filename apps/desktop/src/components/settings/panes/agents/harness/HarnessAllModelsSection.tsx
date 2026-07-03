import { useMemo } from "react";
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
import { RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
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
    provider: model.provider,
    status: model.status,
    effort: model.effort,
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

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsLoading}
          </p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsEmpty}
          </p>
        ) : (
          <ModelTable models={rows} onToggle={handleToggle} />
        )}
      </div>
    </SettingsSection>
  );
}
