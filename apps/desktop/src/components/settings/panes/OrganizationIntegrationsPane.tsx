import { useState } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import type { AdminIntegrationDefinition } from "@proliferate/cloud-sdk/client/integrations";
import { AddCustomIntegrationDialog } from "@/components/settings/panes/integrations/AddCustomIntegrationDialog";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import {
  useAdminIntegrationDefinitionActions,
  useAdminIntegrationDefinitions,
} from "@/hooks/access/cloud/integrations/use-admin-integration-definitions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  adminIntegrationAuthKindLabel,
  adminIntegrationEnabledView,
  adminIntegrationSourceLabel,
  customIntegrationCreatedMessage,
  type CustomIntegrationFormInput,
} from "@/lib/domain/settings/org-integrations-presentation";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * Org-admin integrations pane: every visible definition (seed + org-custom)
 * with its effective-enabled policy switch, plus creation of org-custom MCP
 * definitions.
 */
export function OrganizationIntegrationsPane() {
  const {
    activeOrganization,
    activeOrganizationId,
    organizationsQuery,
  } = useActiveOrganization();
  const definitionsQuery = useAdminIntegrationDefinitions(activeOrganizationId);
  const {
    createDefinition,
    creatingDefinition,
    setEnabled,
  } = useAdminIntegrationDefinitionActions(activeOrganizationId);
  const showToast = useToastStore((state) => state.show);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [togglingDefinitionId, setTogglingDefinitionId] = useState<string | null>(null);

  async function handleToggle(definition: AdminIntegrationDefinition, enabled: boolean) {
    setTogglingDefinitionId(definition.definitionId);
    try {
      await setEnabled({ definitionId: definition.definitionId, enabled });
    } catch {
      showToast(`${definition.displayName} could not be ${enabled ? "enabled" : "disabled"}.`);
    } finally {
      setTogglingDefinitionId(null);
    }
  }

  async function handleCreate(input: CustomIntegrationFormInput) {
    // Errors propagate to the dialog, which surfaces them inline.
    const created = await createDefinition(input);
    setAddDialogOpen(false);
    showToast(customIntegrationCreatedMessage(created), "info");
  }

  const definitions = definitionsQuery.data ?? [];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Integrations"
        description="Control which integrations members of your organization can connect and use."
        action={
          <Button type="button" variant="secondary" onClick={() => setAddDialogOpen(true)}>
            Add custom MCP
          </Button>
        }
      />

      {organizationsQuery.isLoading ? (
        <SettingsSection>
          <SettingsRow label="Integrations" description="Loading organization..." />
        </SettingsSection>
      ) : !activeOrganization ? (
        <SettingsSection>
          <SettingsRow
            label="No organization"
            description="Create or join an organization before configuring organization-wide integrations."
          />
        </SettingsSection>
      ) : definitionsQuery.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading integrations...</div>
      ) : definitionsQuery.isError ? (
        <SettingsEmptyState
          size="compact"
          title="Integrations could not be loaded."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void definitionsQuery.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : definitions.length === 0 ? (
        <SettingsEmptyState size="compact" title="No integrations are available yet." />
      ) : (
        <SettingsSection title="Available integrations">
          {definitions.map((definition) => {
            const enabledView = adminIntegrationEnabledView(definition);
            return (
              <div
                key={definition.definitionId}
                className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,10rem)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <IntegrationIcon namespace={definition.namespace} className="size-8" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {definition.displayName}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted-foreground">
                      {definition.namespace}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  <Badge tone="neutral">
                    {adminIntegrationSourceLabel(definition.source)}
                  </Badge>
                </div>
                <div className="min-w-0 truncate text-sm text-muted-foreground">
                  {adminIntegrationAuthKindLabel(definition.authKind)}
                </div>
                <div className="min-w-0 truncate text-right text-xs text-muted-foreground">
                  {enabledView.provenance}
                </div>
                <div className="flex justify-end">
                  <Switch
                    aria-label={`${definition.displayName} enabled`}
                    checked={enabledView.enabled}
                    disabled={togglingDefinitionId === definition.definitionId}
                    onChange={(value) => {
                      void handleToggle(definition, value);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </SettingsSection>
      )}

      <AddCustomIntegrationDialog
        open={addDialogOpen}
        creating={creatingDefinition}
        onClose={() => setAddDialogOpen(false)}
        onSubmit={handleCreate}
      />
    </section>
  );
}
