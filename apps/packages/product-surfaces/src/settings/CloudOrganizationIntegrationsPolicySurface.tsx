import { useMemo, useState } from "react";
import {
  useCloudMcpCatalog,
  useCloudOrganizationIntegrationPolicy,
  useCloudOrganizationIntegrationPolicyActions,
} from "@proliferate/cloud-sdk-react";
import {
  buildOrganizationIntegrationPolicyItems,
  type OrganizationIntegrationPolicyStatusFilter,
} from "@proliferate/product-domain/plugins/organization-integration-policy";
import { OrganizationIntegrationsPolicySurface } from "@proliferate/product-ui/plugins/OrganizationIntegrationsPolicySurface";

interface CloudOrganizationIntegrationsPolicySurfaceProps {
  organizationId: string | null;
  enabled?: boolean;
}

export function CloudOrganizationIntegrationsPolicySurface({
  organizationId,
  enabled = true,
}: CloudOrganizationIntegrationsPolicySurfaceProps) {
  const queriesEnabled = enabled && organizationId !== null;
  const catalog = useCloudMcpCatalog(queriesEnabled);
  const policy = useCloudOrganizationIntegrationPolicy(
    organizationId,
    queriesEnabled,
  );
  const actions = useCloudOrganizationIntegrationPolicyActions(organizationId);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<OrganizationIntegrationPolicyStatusFilter>("all");
  const [pendingCatalogEntryIds, setPendingCatalogEntryIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!catalog.data || !policy.data) {
      return [];
    }
    return buildOrganizationIntegrationPolicyItems({
      catalog: catalog.data,
      policy: policy.data,
      query,
      statusFilter,
    });
  }, [catalog.data, policy.data, query, statusFilter]);

  const loadError = organizationId
    ? firstErrorMessage(catalog.error, policy.error)
    : "No active organization is selected.";
  const error = actionError ?? loadError;
  const loading = queriesEnabled && (catalog.isLoading || policy.isLoading);

  async function toggleIntegration(catalogEntryId: string, value: boolean) {
    if (!organizationId) {
      setActionError("No active organization is selected.");
      return;
    }
    setActionError(null);
    setPendingCatalogEntryIds((current) => [...new Set([...current, catalogEntryId])]);
    try {
      await actions.patchPolicy({ catalogEntryId, enabled: value });
    } catch (error_) {
      setActionError(errorMessage(error_));
    } finally {
      setPendingCatalogEntryIds((current) =>
        current.filter((entryId) => entryId !== catalogEntryId)
      );
    }
  }

  return (
    <OrganizationIntegrationsPolicySurface
      items={items}
      query={query}
      statusFilter={statusFilter}
      loading={loading}
      error={error}
      pendingCatalogEntryIds={pendingCatalogEntryIds}
      onQueryChange={setQuery}
      onStatusFilterChange={setStatusFilter}
      onToggleIntegration={(catalogEntryId, value) => {
        void toggleIntegration(catalogEntryId, value);
      }}
      onRetry={() => {
        setActionError(null);
        void catalog.refetch();
        void policy.refetch();
      }}
    />
  );
}

function firstErrorMessage(...errors: unknown[]): string | null {
  for (const error of errors) {
    if (error) {
      return errorMessage(error);
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Integration policy could not be updated.";
}
