import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { IntegrationConnectDialog, type IntegrationConnectSubmit } from "@/components/settings/panes/integrations/IntegrationConnectDialog";
import { IntegrationRow } from "@/components/settings/panes/integrations/IntegrationRow";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import {
  useCloudIntegrationActions,
  useCloudIntegrationOauthFlow,
  useCloudIntegrations,
  type CloudIntegrationView,
} from "@/hooks/cloud/facade/use-cloud-integrations";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  isTerminalIntegrationOauthFlowStatus,
} from "@/lib/domain/cloud/integrations";
import { buildSettingsHref, type SettingsFocus } from "@/lib/domain/settings/navigation";
import {
  filterIntegrationsByQuery,
  INTEGRATIONS_SEARCH_THRESHOLD,
  integrationOauthReturnToast,
} from "@/lib/domain/settings/integrations-presentation";
import { useToastStore } from "@/stores/toast/toast-store";

interface UserIntegrationsPaneProps {
  /** OAuth browser-return params (flowId/status/failureCode) from the deep link. */
  focus?: SettingsFocus;
}

export function UserIntegrationsPane({ focus = {} }: UserIntegrationsPaneProps) {
  const navigate = useNavigate();
  const { activeOrganizationId } = useActiveOrganization();
  const {
    integrations,
    isLoading,
    isError,
    catalogQuery,
    healthQuery,
  } = useCloudIntegrations(activeOrganizationId);
  const {
    authenticate,
    authenticating,
    disconnect,
    disconnecting,
    cancelOauthFlow,
    cancellingOauthFlow,
    invalidateCloudIntegrations,
  } = useCloudIntegrationActions();
  const { openExternal } = useTauriShellActions();
  const showToast = useToastStore((state) => state.show);

  const [connectingDefinitionId, setConnectingDefinitionId] = useState<string | null>(null);
  const [apiKeyTarget, setApiKeyTarget] = useState<CloudIntegrationView | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<CloudIntegrationView | null>(null);
  const [pendingOauth, setPendingOauth] = useState<{
    definitionId: string;
    flowId: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredIntegrations = useMemo(
    () => filterIntegrationsByQuery(integrations, searchQuery),
    [integrations, searchQuery],
  );

  // Poll the in-flight OAuth flow while the browser handoff is pending.
  const oauthFlowQuery = useCloudIntegrationOauthFlow(pendingOauth?.flowId ?? null);
  const oauthFlowStatus = oauthFlowQuery.data?.status ?? null;
  const oauthFlowFailureCode = oauthFlowQuery.data?.failureCode ?? null;
  useEffect(() => {
    if (!pendingOauth || !oauthFlowStatus || !isTerminalIntegrationOauthFlowStatus(oauthFlowStatus)) {
      return;
    }
    const toast = integrationOauthReturnToast(oauthFlowStatus, oauthFlowFailureCode);
    if (toast) {
      showToast(toast.message, toast.type);
    }
    setPendingOauth(null);
    void invalidateCloudIntegrations();
  }, [invalidateCloudIntegrations, oauthFlowFailureCode, oauthFlowStatus, pendingOauth, showToast]);

  // Deep-link return: toast the flow outcome once, then drop the params from
  // the URL so re-renders and revisits stay quiet.
  const announcedReturnRef = useRef(false);
  const returnStatus = focus.status ?? null;
  const returnFailureCode = focus.failureCode ?? null;
  useEffect(() => {
    if (announcedReturnRef.current) {
      return;
    }
    const toast = integrationOauthReturnToast(returnStatus, returnFailureCode);
    if (!toast) {
      return;
    }
    announcedReturnRef.current = true;
    showToast(toast.message, toast.type);
    void invalidateCloudIntegrations();
    navigate(buildSettingsHref({ section: "integrations" }), { replace: true });
  }, [invalidateCloudIntegrations, navigate, returnFailureCode, returnStatus, showToast]);

  async function startAuthenticate(
    view: CloudIntegrationView,
    input: { apiKey?: string; settings?: Record<string, unknown> | null },
  ) {
    setConnectingDefinitionId(view.definitionId);
    try {
      const response = await authenticate({
        definitionId: view.definitionId,
        authKind: view.authKind,
        apiKey: input.apiKey ?? null,
        settings: input.settings ?? null,
        ...(view.authKind === "oauth2"
          ? { callbackSurface: "desktop" as const, finalSurface: "desktop" as const }
          : {}),
      });
      if (view.authKind === "oauth2") {
        if (!response.oauthFlowId || !response.authorizationUrl) {
          showToast(`${view.displayName} authorization could not be started.`);
          return;
        }
        setPendingOauth({
          definitionId: view.definitionId,
          flowId: response.oauthFlowId,
        });
        await openExternal(response.authorizationUrl);
        return;
      }
      showToast(`${view.displayName} connected.`, "info");
    } catch {
      showToast(`${view.displayName} could not be connected.`);
    } finally {
      setConnectingDefinitionId(null);
    }
  }

  function handleConnect(view: CloudIntegrationView) {
    if (view.authKind === "api_key") {
      setApiKeyTarget(view);
      return;
    }
    void startAuthenticate(view, {});
  }

  async function handleApiKeySubmit(input: IntegrationConnectSubmit) {
    const target = apiKeyTarget;
    if (!target) {
      return;
    }
    await startAuthenticate(target, { apiKey: input.apiKey, settings: input.settings });
    setApiKeyTarget(null);
  }

  async function handleCancelOauth() {
    const pending = pendingOauth;
    if (!pending) {
      return;
    }
    try {
      await cancelOauthFlow(pending.flowId);
    } catch {
      // The flow may already be terminal; polling cleanup below still applies.
    }
    setPendingOauth(null);
  }

  async function handleDisconnect() {
    const target = disconnectTarget;
    if (!target?.accountId) {
      setDisconnectTarget(null);
      return;
    }
    try {
      await disconnect(target.accountId);
      showToast(`${target.displayName} disconnected.`, "info");
    } catch {
      showToast(`${target.displayName} could not be disconnected.`);
    } finally {
      setDisconnectTarget(null);
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Integrations"
        description="Connect third-party tools your cloud agents can use, and manage their connection health."
      />

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading integrations...</div>
      ) : isError ? (
        <SettingsEmptyState
          size="compact"
          title="Integrations could not be loaded."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void catalogQuery.refetch();
                void healthQuery.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : integrations.length === 0 ? (
        <SettingsEmptyState size="compact" title="No integrations are available yet." />
      ) : (
        <SettingsSection title="Available integrations">
          {integrations.length > INTEGRATIONS_SEARCH_THRESHOLD ? (
            <Input
              aria-label="Search integrations"
              className="mb-2 h-8 px-2"
              placeholder="Search integrations"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          ) : null}
          {filteredIntegrations.length === 0 ? (
            <p className="px-1 py-3 text-ui-sm text-muted-foreground">No integrations found</p>
          ) : (
            filteredIntegrations.map((integration) => (
              <IntegrationRow
                key={integration.definitionId}
                integration={integration}
                oauthPending={pendingOauth?.definitionId === integration.definitionId}
                connecting={
                  connectingDefinitionId === integration.definitionId && authenticating
                }
                cancellingOauth={cancellingOauthFlow}
                onConnect={handleConnect}
                onCancelOauth={() => {
                  void handleCancelOauth();
                }}
                onRequestDisconnect={setDisconnectTarget}
              />
            ))
          )}
        </SettingsSection>
      )}

      <IntegrationConnectDialog
        integration={apiKeyTarget}
        connecting={authenticating}
        onClose={() => setApiKeyTarget(null)}
        onSubmit={(input) => {
          void handleApiKeySubmit(input);
        }}
      />

      <ConfirmationDialog
        open={disconnectTarget !== null}
        title={`Disconnect ${disconnectTarget?.displayName ?? "integration"}?`}
        description="Agents lose access to this integration's tools until you connect it again."
        confirmLabel="Disconnect"
        confirmVariant="destructive"
        loading={disconnecting}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={() => {
          void handleDisconnect();
        }}
      />
    </section>
  );
}
