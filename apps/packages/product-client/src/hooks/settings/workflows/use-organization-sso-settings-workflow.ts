import { useCallback, useEffect, useMemo, useState } from "react";
import { useOrganizationSsoConnectionsAccess } from "#product/hooks/access/cloud/organizations/use-organization-sso-connections";
import {
  EMPTY_ORGANIZATION_SSO_FORM,
  isOrganizationSsoFormDirty,
  organizationSsoConnectionPresentation,
  organizationSsoCreateRequestFromForm,
  organizationSsoErrorMessage,
  organizationSsoFormFromConnection,
  organizationSsoUpdateRequestFromForm,
  type OrganizationSsoSettingsForm,
} from "#product/lib/domain/settings/organization-sso-settings";

interface OrganizationSsoSettingsWorkflowOptions {
  organizationId: string | null;
  enabled: boolean;
}

export function useOrganizationSsoSettingsWorkflow({
  organizationId,
  enabled,
}: OrganizationSsoSettingsWorkflowOptions) {
  const { connectionsQuery, actions } = useOrganizationSsoConnectionsAccess(
    organizationId,
    enabled,
  );
  const [form, setForm] = useState<OrganizationSsoSettingsForm>(
    EMPTY_ORGANIZATION_SSO_FORM,
  );
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const connection = connectionsQuery.data?.connections[0] ?? null;
  const hasUnsavedChanges = connection
    ? isOrganizationSsoFormDirty(form, connection)
    : false;

  useEffect(() => {
    const nextConnectionId = connection?.id ?? null;
    if (nextConnectionId === loadedConnectionId) {
      return;
    }
    setLoadedConnectionId(nextConnectionId);
    setForm(connection
      ? organizationSsoFormFromConnection(connection)
      : EMPTY_ORGANIZATION_SSO_FORM);
  }, [connection, loadedConnectionId]);

  const connectionPresentation = useMemo(
    () => (connection ? organizationSsoConnectionPresentation(connection) : null),
    [connection],
  );
  const error = actionError
    ?? (organizationId
      ? organizationSsoErrorMessage(connectionsQuery.error)
      : "No active organization is selected.");

  const save = useCallback(async () => {
    if (!organizationId) {
      setActionError("No active organization is selected.");
      return;
    }
    setActionError(null);
    try {
      if (connection) {
        const updated = await actions.updateConnection({
          connectionId: connection.id,
          input: organizationSsoUpdateRequestFromForm(form),
        });
        setLoadedConnectionId(updated.id);
        setForm(organizationSsoFormFromConnection(updated));
      } else {
        const created = await actions.createConnection(
          organizationSsoCreateRequestFromForm(form),
        );
        setLoadedConnectionId(created.id);
        setForm(organizationSsoFormFromConnection(created));
      }
    } catch (error_) {
      setActionError(organizationSsoErrorMessage(error_));
    }
  }, [actions.createConnection, actions.updateConnection, connection, form, organizationId]);

  const runConnectionAction = useCallback(async (
    action: (connectionId: string) => Promise<unknown>,
  ) => {
    if (!connection) {
      return;
    }
    if (hasUnsavedChanges) {
      setActionError("Save SSO changes before testing or enabling the connection.");
      return;
    }
    setActionError(null);
    try {
      await action(connection.id);
    } catch (error_) {
      setActionError(organizationSsoErrorMessage(error_));
    }
  }, [connection, hasUnsavedChanges]);

  const onSave = useCallback(() => {
    void save();
  }, [save]);
  const onTest = useCallback(() => {
    void runConnectionAction(actions.testConnection);
  }, [actions.testConnection, runConnectionAction]);
  const onEnable = useCallback(() => {
    void runConnectionAction(actions.enableConnection);
  }, [actions.enableConnection, runConnectionAction]);
  const onDisable = useCallback(() => {
    void runConnectionAction(actions.disableConnection);
  }, [actions.disableConnection, runConnectionAction]);
  const onDelete = useCallback(() => {
    void runConnectionAction(actions.deleteConnection);
  }, [actions.deleteConnection, runConnectionAction]);
  const onRetry = useCallback(() => {
    setActionError(null);
    void connectionsQuery.refetch();
  }, [connectionsQuery.refetch]);
  const onCopyRedirectUri = useCallback(() => {
    if (connection?.oidcRedirectUri) {
      void navigator.clipboard?.writeText(connection.oidcRedirectUri);
    }
  }, [connection]);

  return {
    connection: connectionPresentation,
    form,
    loading: connectionsQuery.isLoading,
    saving: actions.creatingConnection || actions.updatingConnection,
    testing: actions.testingConnection,
    enabling: actions.enablingConnection,
    disabling: actions.disablingConnection,
    deleting: actions.deletingConnection,
    hasUnsavedChanges,
    error,
    onFormChange: setForm,
    onSave,
    onTest,
    onEnable,
    onDisable,
    onDelete,
    onRetry,
    onCopyRedirectUri,
  };
}
