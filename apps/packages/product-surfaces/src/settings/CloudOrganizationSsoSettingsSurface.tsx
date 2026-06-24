import { useEffect, useMemo, useState } from "react";
import {
  useOrganizationSsoConnections,
  useOrganizationSsoMutations,
} from "@proliferate/cloud-sdk-react";
import {
  type OrganizationSsoConnectionRequest,
  type OrganizationSsoConnectionResponse,
  type OrganizationSsoConnectionUpdateRequest,
} from "@proliferate/cloud-sdk";
import {
  OrganizationSsoSettingsSurface,
  type OrganizationSsoConnectionView,
  type OrganizationSsoFormState,
} from "@proliferate/product-ui/settings/OrganizationSsoSettingsSurface";

interface CloudOrganizationSsoSettingsSurfaceProps {
  organizationId: string | null;
  enabled?: boolean;
}

const EMPTY_FORM: OrganizationSsoFormState = {
  displayName: "Company SSO",
  allowedDomains: "",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid email profile",
  oidcTokenEndpointAuthMethod: "client_secret_basic",
};

export function CloudOrganizationSsoSettingsSurface({
  organizationId,
  enabled = true,
}: CloudOrganizationSsoSettingsSurfaceProps) {
  const query = useOrganizationSsoConnections(organizationId, enabled);
  const actions = useOrganizationSsoMutations(organizationId);
  const [form, setForm] = useState<OrganizationSsoFormState>(EMPTY_FORM);
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const connection = query.data?.connections[0] ?? null;

  useEffect(() => {
    const nextConnectionId = connection?.id ?? null;
    if (nextConnectionId === loadedConnectionId) {
      return;
    }
    setLoadedConnectionId(nextConnectionId);
    setForm(connection ? formFromConnection(connection) : EMPTY_FORM);
  }, [connection, loadedConnectionId]);

  const view = useMemo(
    () => (connection ? connectionView(connection) : null),
    [connection],
  );
  const error = actionError ?? (organizationId ? errorMessage(query.error) : "No active organization is selected.");

  async function save() {
    if (!organizationId) {
      setActionError("No active organization is selected.");
      return;
    }
    setActionError(null);
    try {
      if (connection) {
        await actions.updateConnection({
          connectionId: connection.id,
          input: updateRequestFromForm(form),
        });
      } else {
        await actions.createConnection(createRequestFromForm(form));
      }
    } catch (error_) {
      setActionError(errorMessage(error_));
    }
  }

  async function runConnectionAction(action: (connectionId: string) => Promise<unknown>) {
    if (!connection) {
      return;
    }
    setActionError(null);
    try {
      await action(connection.id);
    } catch (error_) {
      setActionError(errorMessage(error_));
    }
  }

  return (
    <OrganizationSsoSettingsSurface
      connection={view}
      form={form}
      loading={query.isLoading}
      saving={actions.creatingConnection || actions.updatingConnection}
      testing={actions.testingConnection}
      enabling={actions.enablingConnection}
      disabling={actions.disablingConnection}
      deleting={actions.deletingConnection}
      error={error}
      onFormChange={setForm}
      onSave={() => { void save(); }}
      onTest={() => { void runConnectionAction(actions.testConnection); }}
      onEnable={() => { void runConnectionAction(actions.enableConnection); }}
      onDisable={() => { void runConnectionAction(actions.disableConnection); }}
      onDelete={() => { void runConnectionAction(actions.deleteConnection); }}
      onRetry={() => {
        setActionError(null);
        void query.refetch();
      }}
      onCopyRedirectUri={() => {
        if (connection?.oidcRedirectUri) {
          void navigator.clipboard?.writeText(connection.oidcRedirectUri);
        }
      }}
    />
  );
}

function connectionView(
  connection: OrganizationSsoConnectionResponse,
): OrganizationSsoConnectionView {
  return {
    id: connection.id,
    status: connection.status,
    displayName: connection.displayName,
    oidcRedirectUri: connection.oidcRedirectUri,
    oidcClientSecretConfigured: connection.oidcClientSecretConfigured,
    testedAt: connection.testedAt,
    lastError: connection.lastError,
  };
}

function formFromConnection(connection: OrganizationSsoConnectionResponse): OrganizationSsoFormState {
  return {
    displayName: connection.displayName,
    allowedDomains: connection.allowedDomains.join(", "),
    oidcIssuerUrl: connection.oidcIssuerUrl ?? "",
    oidcClientId: connection.oidcClientId ?? "",
    oidcClientSecret: "",
    oidcScopes: connection.oidcScopes.join(" "),
    oidcTokenEndpointAuthMethod: connection.oidcTokenEndpointAuthMethod,
  };
}

function createRequestFromForm(form: OrganizationSsoFormState): OrganizationSsoConnectionRequest {
  return {
    protocol: "oidc",
    displayName: form.displayName,
    loginPolicy: "optional",
    jitPolicy: "disabled",
    defaultRole: "member",
    allowedDomains: splitList(form.allowedDomains),
    oidcIssuerUrl: form.oidcIssuerUrl.trim() || null,
    oidcClientId: form.oidcClientId.trim() || null,
    oidcClientSecret: form.oidcClientSecret.trim() || null,
    oidcScopes: splitScopes(form.oidcScopes),
    oidcTokenEndpointAuthMethod: form.oidcTokenEndpointAuthMethod,
  };
}

function updateRequestFromForm(
  form: OrganizationSsoFormState,
): OrganizationSsoConnectionUpdateRequest {
  const request: OrganizationSsoConnectionUpdateRequest = {
    displayName: form.displayName,
    allowedDomains: splitList(form.allowedDomains),
    oidcIssuerUrl: form.oidcIssuerUrl.trim() || null,
    oidcClientId: form.oidcClientId.trim() || null,
    oidcScopes: splitScopes(form.oidcScopes),
    oidcTokenEndpointAuthMethod: form.oidcTokenEndpointAuthMethod,
  };
  if (form.oidcClientSecret.trim()) {
    request.oidcClientSecret = form.oidcClientSecret.trim();
  }
  return request;
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function splitScopes(value: string): string[] {
  return value.replaceAll(",", " ").split(/\s+/u).map((item) => item.trim()).filter(Boolean);
}

function errorMessage(error: unknown): string | null {
  if (!error) {
    return null;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "SSO settings could not be loaded.";
}
