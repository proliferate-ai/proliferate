import { useMemo } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentCatalog,
  useAgentGatewayCapabilities,
  useRefreshAgentCatalog,
  useRouteSelections,
  useUpsertCatalogOverride,
} from "@proliferate/cloud-sdk-react";
import { RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { ModelConfigGrid, type ModelConfigGridItem } from "@proliferate/product-ui/settings/ModelConfigGrid";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { agentApiKeyProviderLabel } from "@/config/agent-api-key-providers";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  buildEnabledOverridePatchJson,
  catalogRouteForSurface,
  normalizeCatalogModels,
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

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const route = catalogRouteForSurface(
    harnessKind,
    surface,
    selectionsQuery.data?.selections ?? [],
  );
  const catalogQuery = useAgentCatalog({ harnessKind, surface, route }, cloudActive);
  const refreshCatalog = useRefreshAgentCatalog();
  const upsertOverride = useUpsertCatalogOverride();

  const models = useMemo(
    () => normalizeCatalogModels(catalogQuery.data?.models ?? []),
    [catalogQuery.data?.models],
  );
  // Which provider's keys serve this harness directly (registry-driven); used
  // as the grid's provider badge when a model entry does not name its own.
  const directProvider = (capabilitiesQuery.data?.providers ?? []).find(
    (provider) => provider.harnesses.includes(harnessKind),
  );
  const fallbackProviderLabel = directProvider
    ? agentApiKeyProviderLabel(directProvider.id)
    : displayName;
  const gridItems: ModelConfigGridItem[] = models.map((model) => ({
    id: model.id,
    name: model.displayName,
    provider: model.provider
      ? agentApiKeyProviderLabel(model.provider)
      : fallbackProviderLabel,
    version: model.description ?? undefined,
    enabled: model.enabled,
    disabled: upsertOverride.isPending,
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

  const probedAt = catalogQuery.data?.probedAt ?? null;

  return (
    <SettingsSection title={HARNESS_PANE_COPY.tabAllModels}>
      <div className="space-y-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {probedAt
              ? `Last refreshed ${new Date(probedAt).toLocaleString()}`
              : catalogQuery.data?.source
                ? `Source: ${catalogQuery.data.source}`
                : ""}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            disabled={refreshCatalog.isPending}
            onClick={handleRefresh}
          >
            <RefreshCw
              className={`size-3.5 ${refreshCatalog.isPending ? "animate-spin" : ""}`}
            />
            {refreshCatalog.isPending
              ? HARNESS_PANE_COPY.allModelsRefreshing
              : HARNESS_PANE_COPY.allModelsRefresh}
          </Button>
        </div>

        {catalogQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsLoading}
          </p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {HARNESS_PANE_COPY.allModelsEmpty}
          </p>
        ) : (
          <ModelConfigGrid models={gridItems} onToggle={handleToggle} />
        )}
      </div>
    </SettingsSection>
  );
}
