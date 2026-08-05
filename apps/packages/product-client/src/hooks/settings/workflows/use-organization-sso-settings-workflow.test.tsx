// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSsoConnectionResponse } from "@proliferate/cloud-sdk/types";
import { useOrganizationSsoSettingsWorkflow } from "#product/hooks/settings/workflows/use-organization-sso-settings-workflow";

const access = vi.hoisted(() => ({
  data: { connections: [] } as { connections: OrganizationSsoConnectionResponse[] },
  error: null as unknown,
  isLoading: false,
  refetch: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  testConnection: vi.fn(),
  enableConnection: vi.fn(),
  disableConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));

vi.mock(
  "#product/hooks/access/cloud/organizations/use-organization-sso-connections",
  () => ({
    useOrganizationSsoConnectionsAccess: () => ({
      connectionsQuery: {
        data: access.data,
        error: access.error,
        isLoading: access.isLoading,
        refetch: access.refetch,
      },
      actions: {
        createConnection: access.createConnection,
        creatingConnection: false,
        updateConnection: access.updateConnection,
        updatingConnection: false,
        testConnection: access.testConnection,
        testingConnection: false,
        enableConnection: access.enableConnection,
        enablingConnection: false,
        disableConnection: access.disableConnection,
        disablingConnection: false,
        deleteConnection: access.deleteConnection,
        deletingConnection: false,
      },
    }),
  }),
);

function connection(
  id: string,
  overrides: Partial<OrganizationSsoConnectionResponse> = {},
): OrganizationSsoConnectionResponse {
  return {
    id,
    organizationId: "org-1",
    scope: "organization",
    protocol: "oidc",
    status: "draft",
    displayName: `Connection ${id}`,
    loginPolicy: "optional",
    jitPolicy: "disabled",
    defaultRole: "member",
    allowedDomains: ["example.com"],
    oidcIssuerUrl: "https://id.example.com",
    oidcClientId: "client-1",
    oidcClientSecretConfigured: true,
    oidcScopes: ["openid", "email", "profile"],
    oidcTokenEndpointAuthMethod: "client_secret_basic",
    oidcRedirectUri: `https://app.example.com/sso/${id}`,
    samlIdpMetadataXmlConfigured: false,
    samlX509CertConfigured: false,
    samlAcsUrl: "",
    samlEntityId: "",
    samlMetadataUrl: "",
    testedAt: null,
    lastError: null,
    createdAt: "2026-08-05T00:00:00Z",
    updatedAt: "2026-08-05T00:00:00Z",
    ...overrides,
  };
}

describe("useOrganizationSsoSettingsWorkflow", () => {
  beforeEach(() => {
    access.data = { connections: [] };
    access.error = null;
    access.isLoading = false;
    for (const mock of [
      access.refetch,
      access.createConnection,
      access.updateConnection,
      access.testConnection,
      access.enableConnection,
      access.disableConnection,
      access.deleteConnection,
    ]) {
      mock.mockReset();
    }
  });

  it("selects the first connection and resets the form when its id changes", async () => {
    access.data = { connections: [connection("first"), connection("ignored")] };
    const rendered = renderHook(() => useOrganizationSsoSettingsWorkflow({
      organizationId: "org-1",
      enabled: true,
    }));

    await waitFor(() => {
      expect(rendered.result.current.connection?.id).toBe("first");
      expect(rendered.result.current.form.displayName).toBe("Connection first");
    });

    access.data = { connections: [connection("second")] };
    rendered.rerender();

    await waitFor(() => {
      expect(rendered.result.current.connection?.id).toBe("second");
      expect(rendered.result.current.form.displayName).toBe("Connection second");
    });
  });

  it("creates a normalized connection when none exists", async () => {
    access.createConnection.mockResolvedValue(connection("created"));
    const { result } = renderHook(() => useOrganizationSsoSettingsWorkflow({
      organizationId: "org-1",
      enabled: true,
    }));

    act(() => {
      result.current.onFormChange({
        ...result.current.form,
        allowedDomains: "example.com, example.org",
        oidcScopes: "openid, email profile",
      });
    });
    act(() => {
      result.current.onSave();
    });

    await waitFor(() => {
      expect(access.createConnection).toHaveBeenCalledWith(expect.objectContaining({
        protocol: "oidc",
        allowedDomains: ["example.com", "example.org"],
        oidcScopes: ["openid", "email", "profile"],
      }));
    });
  });

  it("updates the selected connection and surfaces action failures", async () => {
    const selected = connection("selected");
    access.data = { connections: [selected] };
    access.updateConnection.mockRejectedValue(new Error("save offline"));
    const { result } = renderHook(() => useOrganizationSsoSettingsWorkflow({
      organizationId: "org-1",
      enabled: true,
    }));

    await waitFor(() => {
      expect(result.current.form.displayName).toBe("Connection selected");
    });
    act(() => {
      result.current.onSave();
    });

    await waitFor(() => {
      expect(access.updateConnection).toHaveBeenCalledWith({
        connectionId: "selected",
        input: expect.objectContaining({ displayName: "Connection selected" }),
      });
      expect(result.current.error).toBe("save offline");
    });

    act(() => {
      result.current.onRetry();
    });
    expect(access.refetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("blocks connection actions while the form has unsaved changes", async () => {
    access.data = { connections: [connection("selected")] };
    const { result } = renderHook(() => useOrganizationSsoSettingsWorkflow({
      organizationId: "org-1",
      enabled: true,
    }));

    await waitFor(() => {
      expect(result.current.form.displayName).toBe("Connection selected");
    });
    act(() => {
      result.current.onFormChange({
        ...result.current.form,
        displayName: "Changed locally",
      });
    });
    expect(result.current.hasUnsavedChanges).toBe(true);

    act(() => {
      result.current.onDisable();
    });

    expect(access.disableConnection).not.toHaveBeenCalled();
    expect(result.current.error).toBe(
      "Save SSO changes before testing or enabling the connection.",
    );
  });
});
