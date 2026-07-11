import { useState } from "react";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import type { AdminIntegrationDefinition } from "@proliferate/cloud-sdk/client/integrations";
import { IntegrationIcon } from "@/components/settings/panes/integrations/IntegrationIcon";
import { useAdminIntegrationDefinitionActions, useAdminIntegrationDefinitions } from "@/hooks/access/cloud/integrations/use-admin-integration-definitions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * Org-admin gateway defaults pane (track 1b phase 3, below Integrations):
 * the per-integration half of the §2 "default access modes" knob. Each
 * integration's switch controls whether it's in a chat session's default
 * tool set — the phase-1 ``CloudIntegrationPolicy.scope_json`` enforcement
 * point. The per-invocation half of the same knob lives on the personal
 * "Functions" page, since invocations are person-owned.
 */
export function OrganizationGatewayDefaultsPane() {
  const { activeOrganization, activeOrganizationId, organizationsQuery } = useActiveOrganization();
  const definitionsQuery = useAdminIntegrationDefinitions(activeOrganizationId);
  const { setDefaultChatScope } = useAdminIntegrationDefinitionActions(activeOrganizationId);
  const showToast = useToastStore((state) => state.show);

  const [togglingDefinitionId, setTogglingDefinitionId] = useState<string | null>(null);

  async function handleToggle(definition: AdminIntegrationDefinition, included: boolean) {
    setTogglingDefinitionId(definition.definitionId);
    try {
      await setDefaultChatScope({ definitionId: definition.definitionId, included });
    } catch {
      showToast(
        `${definition.displayName}'s chat default could not be ${included ? "restored" : "changed"}.`,
      );
    } finally {
      setTogglingDefinitionId(null);
    }
  }

  const definitions = definitionsQuery.data ?? [];

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Gateway defaults"
        description="Choose which integrations a new chat session can use by default. Workflows are unaffected — they always grant access explicitly."
      />

      {organizationsQuery.isLoading ? (
        <SettingsSection>
          <SettingsRow label="Gateway defaults" description="Loading organization..." />
        </SettingsSection>
      ) : !activeOrganization ? (
        <SettingsSection>
          <SettingsRow
            label="No organization"
            description="Create or join an organization before configuring gateway defaults."
          />
        </SettingsSection>
      ) : definitionsQuery.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading integrations...</div>
      ) : definitionsQuery.isError ? (
        <SettingsEmptyState
          size="compact"
          title="Gateway defaults could not be loaded."
          action={
            <Button type="button" variant="secondary" onClick={() => { void definitionsQuery.refetch(); }}>
              Retry
            </Button>
          }
        />
      ) : definitions.length === 0 ? (
        <SettingsEmptyState size="compact" title="No integrations are available yet." />
      ) : (
        <SettingsSection title="Chat default access">
          {definitions.map((definition) => (
            <div
              key={definition.definitionId}
              className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,10rem)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0"
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
              <div className="min-w-0 truncate text-right text-xs text-muted-foreground">
                {definition.defaultChatIncluded ? "Included by default" : "Excluded by default"}
              </div>
              <div className="flex justify-end">
                <Switch
                  aria-label={`${definition.displayName} in chat default`}
                  checked={definition.defaultChatIncluded}
                  disabled={togglingDefinitionId === definition.definitionId}
                  onChange={(value) => {
                    void handleToggle(definition, value);
                  }}
                />
              </div>
            </div>
          ))}
        </SettingsSection>
      )}
    </section>
  );
}
