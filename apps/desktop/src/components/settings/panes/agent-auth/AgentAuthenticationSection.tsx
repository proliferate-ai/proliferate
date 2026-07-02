import { useEffect, useState } from "react";
import type {
  AgentAuthRoute,
  AgentAuthRouteSelection,
  AgentAuthSurface,
  AgentGatewayCapabilities,
  AgentGatewayEnrollment,
} from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useAgentGatewayCapabilities,
  useAgentGatewayEnrollment,
  useClearRouteSelection,
  useRouteSelections,
  useUpsertRouteSelection,
} from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Select } from "@proliferate/ui/primitives/Select";
import { SelectionRow } from "@proliferate/ui/primitives/SelectionRow";
import { Tabs } from "@proliferate/ui/primitives/Tabs";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";
import { agentApiKeyProviderLabel } from "./agent-api-key-providers";

const SURFACE_TABS = [
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
] as const;

interface AgentAuthenticationSectionProps {
  agentKind: string;
  displayName: string;
}

function defaultRouteForSurface(surface: AgentAuthSurface): AgentAuthRoute {
  return surface === "cloud" ? "gateway" : "native";
}

function gatewaySubtitle(
  capabilities: AgentGatewayCapabilities | undefined,
  enrollment: AgentGatewayEnrollment | undefined,
): string {
  if (capabilities && !capabilities.gatewayEnabled) {
    return "Unavailable for your account";
  }
  if (enrollment?.syncStatus === "failed") {
    return enrollment.lastErrorCode
      ? `Enrollment failed (${enrollment.lastErrorCode})`
      : "Enrollment failed";
  }
  if (enrollment?.syncStatus === "pending") {
    return "Enrollment pending";
  }
  return "Proliferate-managed model access. Free credits included, no setup required.";
}

export function AgentAuthenticationSection({
  agentKind,
  displayName,
}: AgentAuthenticationSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  const [surface, setSurface] = useState<AgentAuthSurface>("local");
  // True while the user picked "API key" but has not chosen a key yet.
  const [draftApiKeyRoute, setDraftApiKeyRoute] = useState(false);
  // Optimistic copy of a just-persisted selection, retained until the
  // invalidated selections query refetches and reports the same route. Without
  // this the UI would snap back to the stale route (unmounting the key picker)
  // in the gap between mutation success and refetch resolution.
  const [optimisticSelection, setOptimisticSelection] = useState<{
    surface: AgentAuthSurface;
    route: AgentAuthRoute;
    apiKeyId: string | null;
  } | null>(null);

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const upsertSelection = useUpsertRouteSelection();
  const clearSelection = useClearRouteSelection();

  if (!cloudActive) {
    return (
      <SettingsCard>
        <div className="space-y-1 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Authentication</p>
          <p className="text-sm text-muted-foreground">
            Sign in to Proliferate Cloud to manage how {displayName} authenticates
            to models.
          </p>
        </div>
      </SettingsCard>
    );
  }

  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  // Undefined capabilities means "not yet known" (still loading or errored), not
  // "gateway enabled" — treat it as disabled so a user can never persist a
  // gateway route on a gateway-disabled account before capabilities resolve.
  const gatewayDisabled = !capabilities?.gatewayEnabled;
  // Only surface the explanatory copy once we actually know the gateway is off.
  const gatewayKnownUnavailable =
    capabilities !== undefined && !capabilities.gatewayEnabled;
  const apiKeys = apiKeysQuery.data?.keys ?? [];
  const serverSelection: AgentAuthRouteSelection | null =
    selectionsQuery.data?.selections.find(
      (entry) => entry.harnessKind === agentKind && entry.surface === surface,
    ) ?? null;
  const optimisticForSurface =
    optimisticSelection?.surface === surface ? optimisticSelection : null;
  const effectiveRoute: AgentAuthRoute | null =
    optimisticForSurface?.route ?? serverSelection?.route ?? null;
  const effectiveApiKeyId =
    optimisticForSurface?.apiKeyId ?? serverSelection?.apiKeyId ?? null;
  // A persisted selection exists (server or in-flight optimistic) → show Reset.
  const selection = optimisticForSurface ?? serverSelection;
  const selectedRoute: AgentAuthRoute = draftApiKeyRoute
    ? "api_key"
    : effectiveRoute ?? defaultRouteForSurface(surface);
  const selectedApiKeyId = !draftApiKeyRoute && effectiveRoute === "api_key"
    ? effectiveApiKeyId ?? ""
    : "";

  // Drop the optimistic selection once the refetched server state matches it.
  useEffect(() => {
    if (!optimisticSelection) {
      return;
    }
    const match = selectionsQuery.data?.selections.find(
      (entry) =>
        entry.harnessKind === agentKind &&
        entry.surface === optimisticSelection.surface,
    );
    if (
      match &&
      match.route === optimisticSelection.route &&
      (match.apiKeyId ?? null) === optimisticSelection.apiKeyId
    ) {
      setOptimisticSelection(null);
    }
  }, [selectionsQuery.data, optimisticSelection, agentKind]);

  function applyRoute(route: AgentAuthRoute, apiKeyId?: string) {
    upsertSelection.mutate(
      {
        harnessKind: agentKind,
        surface,
        body: route === "api_key"
          ? { route, apiKeyId: apiKeyId ?? null }
          : { route },
      },
      {
        onSuccess: () => {
          setDraftApiKeyRoute(false);
          // Hold the chosen route optimistically until the selections query
          // refetches, so the row/key-picker don't flicker back to stale state.
          setOptimisticSelection({
            surface,
            route,
            apiKeyId: route === "api_key" ? apiKeyId ?? null : null,
          });
        },
        onError: (error) => {
          showToast(error.message || `Could not update the ${displayName} route.`);
        },
      },
    );
  }

  function handleSelectRoute(route: AgentAuthRoute) {
    if (route === selectedRoute && !draftApiKeyRoute) {
      return;
    }
    if (route === "api_key") {
      // Wait for an explicit key choice before persisting.
      setDraftApiKeyRoute(true);
      return;
    }
    applyRoute(route);
  }

  function handleSurfaceChange(next: string) {
    setSurface(next === "cloud" ? "cloud" : "local");
    setDraftApiKeyRoute(false);
  }

  function handleReset() {
    clearSelection.mutate(
      { harnessKind: agentKind, surface },
      {
        onSuccess: () => {
          setDraftApiKeyRoute(false);
          setOptimisticSelection((current) =>
            current?.surface === surface ? null : current,
          );
        },
        onError: (error) => {
          showToast(error.message || `Could not reset the ${displayName} route.`);
        },
      },
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">Authentication</p>
            <p className="text-sm text-muted-foreground">
              How {displayName} authenticates to models on each surface.
            </p>
          </div>
          <Tabs
            items={SURFACE_TABS}
            activeId={surface}
            onChange={handleSurfaceChange}
          />
        </div>

        {selectionsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading route selection...</p>
        ) : (
          <div role="radiogroup" aria-label={`${displayName} authentication route`} className="space-y-1.5">
            <SelectionRow
              selected={selectedRoute === "gateway"}
              disabled={gatewayDisabled || upsertSelection.isPending}
              title={gatewayDisabled
                ? "The managed gateway is not available for your account."
                : undefined}
              label="Proliferate gateway"
              subtitle={gatewaySubtitle(capabilities, enrollment)}
              onClick={() => handleSelectRoute("gateway")}
            />
            <SelectionRow
              selected={selectedRoute === "api_key"}
              disabled={upsertSelection.isPending}
              label="API key"
              subtitle="Use one of your own provider keys from the key pool."
              onClick={() => handleSelectRoute("api_key")}
            />
            {surface === "local" ? (
              <SelectionRow
                selected={selectedRoute === "native"}
                disabled={upsertSelection.isPending}
                label="Native"
                subtitle={`Use ${displayName}'s own sign-in on this machine.`}
                onClick={() => handleSelectRoute("native")}
              />
            ) : null}
          </div>
        )}

        {gatewayKnownUnavailable ? (
          <p className="text-sm text-muted-foreground">
            The managed gateway is currently unavailable for your account, so the
            gateway route cannot be selected.
          </p>
        ) : null}

        {selectedRoute === "api_key" ? (
          apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys available. Add one under Agents → API Keys first.
            </p>
          ) : (
            <label className="block sm:w-72">
              <span className="sr-only">API key</span>
              <Select
                aria-label="API key"
                value={selectedApiKeyId}
                disabled={upsertSelection.isPending}
                onChange={(event) => {
                  if (event.target.value) {
                    applyRoute("api_key", event.target.value);
                  }
                }}
              >
                <option value="" disabled>
                  Select an API key
                </option>
                {apiKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {agentApiKeyProviderLabel(key.provider)} — {key.displayName} ({key.redactedHint})
                  </option>
                ))}
              </Select>
            </label>
          )
        ) : null}

        {selection ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={clearSelection.isPending}
              onClick={handleReset}
            >
              Reset to default
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
