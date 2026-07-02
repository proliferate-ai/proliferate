import { useEffect, useState } from "react";
import type {
  AgentAuthRoute,
  AgentAuthRouteSelection,
  AgentAuthSurface,
} from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useAgentGatewayCapabilities,
  useAgentGatewayEnrollment,
  useClearRouteSelection,
  useRouteSelections,
  useUpsertRouteSelection,
} from "@proliferate/cloud-sdk-react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { RadioCardGroup, type RadioCardOption } from "@proliferate/ui/primitives/RadioCardGroup";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { gatewaySubtitle } from "@/components/settings/panes/agent-auth/agent-auth-copy";
import { KeyPicker } from "@/components/settings/panes/agent-auth/KeyPicker";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentLoginTerminalWorkflow } from "@/hooks/agents/workflows/use-agent-login-terminal-workflow";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { isReadyAgent } from "@/lib/domain/agents/status";
import { useToastStore } from "@/stores/toast/toast-store";
import { resolveTargetScopedSelection } from "@/lib/domain/settings/agents-runtime-scope";
import { defaultRouteForSurface } from "@/lib/domain/settings/harness-catalog";

interface HarnessAuthenticationSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  /** Non-null scopes this page to one enrolled direct runtime (overrides). */
  targetId: string | null;
}

export function HarnessAuthenticationSection({
  harnessKind,
  displayName,
  surface,
  targetId,
}: HarnessAuthenticationSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  // True while the user picked "API key" but has not chosen a key yet.
  const [draftApiKeyRoute, setDraftApiKeyRoute] = useState(false);
  // Optimistic copy of a just-persisted selection, retained until the
  // invalidated selections query refetches and reports the same route. Without
  // this the UI would snap back to the stale route (unmounting the key picker)
  // in the gap between mutation success and refetch resolution.
  const [optimisticSelection, setOptimisticSelection] = useState<{
    surface: AgentAuthSurface;
    targetId: string | null;
    route: AgentAuthRoute;
    apiKeyId: string | null;
  } | null>(null);

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  // A target scope layers its sparse override rows over the defaults.
  const overridesQuery = useRouteSelections(cloudActive && targetId !== null, {
    targetId,
  });
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const upsertSelection = useUpsertRouteSelection();
  const clearSelection = useClearRouteSelection();
  const { agentsByKind } = useAgentCatalog();
  const loginWorkflow = useAgentLoginTerminalWorkflow();

  useEffect(() => {
    setDraftApiKeyRoute(false);
  }, [surface, targetId]);

  const localAgent = agentsByKind.get(harnessKind) ?? null;
  const loginSession = loginWorkflow.sessionsByKind[harnessKind] ?? null;

  // Close the auth terminal once the login round-trip made the agent ready.
  useEffect(() => {
    if (!loginSession?.terminal || !localAgent || !isReadyAgent(localAgent)) {
      return;
    }
    showToast(HARNESS_PANE_COPY.readyToast(displayName));
    void loginWorkflow.closeAuthTerminal(harnessKind);
  }, [
    displayName,
    harnessKind,
    localAgent,
    loginSession,
    loginWorkflow.closeAuthTerminal,
    showToast,
  ]);

  // Drop the optimistic selection once the refetched server state matches it.
  useEffect(() => {
    if (!optimisticSelection) {
      return;
    }
    const source = optimisticSelection.targetId === null
      ? selectionsQuery.data?.selections
      : overridesQuery.data?.selections;
    const match = source?.find(
      (entry) =>
        entry.harnessKind === harnessKind &&
        entry.surface === optimisticSelection.surface &&
        entry.slot === "primary",
    );
    if (
      match &&
      match.route === optimisticSelection.route &&
      (match.apiKeyId ?? null) === optimisticSelection.apiKeyId
    ) {
      setOptimisticSelection(null);
    }
  }, [selectionsQuery.data, overridesQuery.data, optimisticSelection, harnessKind]);

  if (!cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  // Undefined capabilities means "not yet known" (still loading or errored), not
  // "gateway enabled" — treat it as disabled so a user can never persist a
  // gateway route on a gateway-disabled account before capabilities resolve.
  // A known-unsynced enrollment locks the gateway card the same way.
  const gatewayLocked =
    !capabilities?.gatewayEnabled ||
    (enrollment !== undefined && enrollment.syncStatus !== "synced");
  const apiKeys = apiKeysQuery.data?.keys ?? [];
  // Which provider's keys can serve this harness directly (registry-driven).
  const directProvider = (capabilities?.providers ?? []).find(
    (provider) => provider.harnesses.includes(harnessKind),
  );
  const resolvedSelection = resolveTargetScopedSelection({
    defaults: selectionsQuery.data?.selections ?? [],
    overrides: overridesQuery.data?.selections ?? [],
    targetId,
    harnessKind,
    surface,
    slot: "primary",
  });
  const serverSelection: AgentAuthRouteSelection | null =
    resolvedSelection?.selection ?? null;
  const optimisticForScope =
    optimisticSelection?.surface === surface
    && optimisticSelection.targetId === targetId
      ? optimisticSelection
      : null;
  const effectiveRoute: AgentAuthRoute | null =
    optimisticForScope?.route ?? serverSelection?.route ?? null;
  const effectiveApiKeyId =
    optimisticForScope?.apiKeyId ?? serverSelection?.apiKeyId ?? null;
  const selection = optimisticForScope ?? serverSelection;
  // On a target scope, the value is an override only when a per-target row
  // (or a just-written optimistic one) backs it; anything else is inherited.
  const isTargetOverride =
    targetId !== null
    && (optimisticForScope !== null
      || (serverSelection !== null && resolvedSelection?.inherited === false));
  const selectedRoute: AgentAuthRoute = draftApiKeyRoute
    ? "api_key"
    : effectiveRoute ?? defaultRouteForSurface(surface);
  const selectedApiKeyId = !draftApiKeyRoute && effectiveRoute === "api_key"
    ? effectiveApiKeyId ?? null
    : null;

  const routeOptions: RadioCardOption<AgentAuthRoute>[] = [
    {
      value: "gateway",
      label: HARNESS_PANE_COPY.gatewayLabel,
      description: gatewaySubtitle(capabilities, enrollment),
      disabled: gatewayLocked || upsertSelection.isPending,
    },
    {
      value: "api_key",
      label: HARNESS_PANE_COPY.apiKeyLabel,
      description: HARNESS_PANE_COPY.apiKeyDescription,
      disabled: upsertSelection.isPending,
    },
    ...(surface === "local"
      ? [{
        value: "native" as const,
        label: HARNESS_PANE_COPY.nativeLabel,
        description: HARNESS_PANE_COPY.nativeDescription(displayName),
        disabled: upsertSelection.isPending,
      }]
      : []),
  ];

  // Login round-trips run against this Desktop's own runtime; a remote
  // direct runtime's vendor login happens on that box, not here.
  const canRunLogin =
    surface === "local"
    && targetId === null
    && selectedRoute === "native"
    && localAgent !== null
    && !isReadyAgent(localAgent)
    && localAgent.readiness === "login_required"
    && localAgent.supportsLogin;
  const showLoginTerminal =
    surface === "local"
    && targetId === null
    && selectedRoute === "native"
    && loginSession !== null
    && (loginSession.isStarting
      || loginSession.terminal !== null
      || loginSession.errorMessage !== null);

  function applyRoute(route: AgentAuthRoute, apiKeyId?: string) {
    upsertSelection.mutate(
      {
        harnessKind,
        surface,
        targetId,
        body: route === "api_key"
          ? { route, apiKeyId: apiKeyId ?? null, slot: "primary" }
          : { route, slot: "primary" },
      },
      {
        onSuccess: () => {
          setDraftApiKeyRoute(false);
          setOptimisticSelection({
            surface,
            targetId,
            route,
            apiKeyId: route === "api_key" ? apiKeyId ?? null : null,
          });
        },
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.routeUpdateError(displayName));
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
    setDraftApiKeyRoute(false);
    applyRoute(route);
  }

  function handleReset() {
    // On a target scope this deletes the override row, reverting the runtime
    // to the inherited default; on the default scope it clears the default.
    clearSelection.mutate(
      { harnessKind, surface, targetId },
      {
        onSuccess: () => {
          setDraftApiKeyRoute(false);
          setOptimisticSelection((current) =>
            current?.surface === surface && current.targetId === targetId
              ? null
              : current,
          );
        },
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.routeUpdateError(displayName));
        },
      },
    );
  }

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.authenticationTitle}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName)}
    >
      {selectionsQuery.isLoading || (targetId !== null && overridesQuery.isLoading) ? (
        <p className="py-3 text-sm text-muted-foreground">Loading route selection...</p>
      ) : (
        <div className="space-y-3 py-3">
          {targetId !== null ? (
            <div>
              <Badge tone={isTargetOverride ? "accent" : "neutral"}>
                {isTargetOverride
                  ? HARNESS_PANE_COPY.overrideBadge
                  : HARNESS_PANE_COPY.inheritedBadge}
              </Badge>
            </div>
          ) : null}
          <RadioCardGroup
            value={selectedRoute}
            options={routeOptions}
            orientation="horizontal"
            onChange={handleSelectRoute}
          />

          {selectedRoute === "api_key" ? (
            <div className="sm:w-80">
              <KeyPicker
                keys={apiKeys}
                provider={directProvider?.id}
                selectedKeyId={selectedApiKeyId}
                disabled={upsertSelection.isPending}
                onSelect={(keyId) => applyRoute("api_key", keyId)}
              />
            </div>
          ) : null}

          {canRunLogin ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loginSession?.isStarting ?? false}
                onClick={() => {
                  void loginWorkflow.openAuthTerminal(localAgent, {
                    restart: Boolean(loginSession),
                  });
                }}
              >
                {loginSession?.isStarting
                  ? HARNESS_PANE_COPY.runLoginOpening
                  : HARNESS_PANE_COPY.runLogin}
              </Button>
            </div>
          ) : null}

          {showLoginTerminal && loginSession ? (
            <AgentLoginTerminalPanel
              session={loginSession}
              baseUrl={loginWorkflow.runtimeConnection.baseUrl}
              authToken={loginWorkflow.runtimeConnection.authToken}
              onClose={(kind) => {
                void loginWorkflow.closeAuthTerminal(kind);
              }}
              onExit={(kind, code) => {
                void loginWorkflow.handleTerminalExit(kind, code);
              }}
              onRestart={() => {
                if (localAgent) {
                  void loginWorkflow.openAuthTerminal(localAgent, { restart: true });
                }
              }}
            />
          ) : null}

          {targetId !== null ? (
            isTargetOverride ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clearSelection.isPending}
                  onClick={handleReset}
                >
                  {HARNESS_PANE_COPY.clearOverride}
                </Button>
              </div>
            ) : null
          ) : selection ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={clearSelection.isPending}
                onClick={handleReset}
              >
                {HARNESS_PANE_COPY.resetToDefault}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
