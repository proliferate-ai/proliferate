import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { agentAuthManagedCreditsCapabilityLabel } from "@/lib/domain/agent-auth/agent-auth-gateway-capabilities";

interface AgentAuthManagedCreditsCardProps {
  capabilities: AgentGatewayCapabilities | null;
  selectedOrganizationName: string | null;
  isAdminForLibraryOrganization: boolean;
  managedCredentials: AgentAuthCredential[];
  ensuring: boolean;
  onEnsureManagedCredits: () => void;
}

export function AgentAuthManagedCreditsCard({
  capabilities,
  selectedOrganizationName,
  isAdminForLibraryOrganization,
  managedCredentials,
  ensuring,
  onEnsureManagedCredits,
}: AgentAuthManagedCreditsCardProps) {
  const sharedCreditsEnabled = capabilities?.enabled === true
    && capabilities.managedCreditsOrganizationEnabled;
  return (
    <SettingsCard>
      <SettingsCardRow
        label="Proliferate managed credits"
        description={agentAuthManagedCreditsCapabilityLabel(capabilities, "organization")}
      >
        <div className="flex items-center gap-2">
          <Badge tone={sharedCreditsEnabled ? "success" : "neutral"}>
            {sharedCreditsEnabled ? "Available" : "Unavailable"}
          </Badge>
          {selectedOrganizationName && isAdminForLibraryOrganization && sharedCreditsEnabled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={ensuring}
              onClick={() => onEnsureManagedCredits()}
            >
              Sync credits
            </Button>
          )}
        </div>
      </SettingsCardRow>
      <div className="grid gap-0 border-t border-border-light sm:grid-cols-2">
        <div className="border-b border-border-light px-4 py-3 sm:border-b-0 sm:border-r">
          <div className="text-xs font-medium text-foreground">Organization scope</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {selectedOrganizationName
              ?? "Select an organization above to manage shared cloud defaults."}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-foreground">Managed credentials</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {managedCredentials.length > 0
              ? `${managedCredentials.length} harness credential${managedCredentials.length === 1 ? "" : "s"} ready or pending.`
              : "No managed-credit credentials returned for this scope yet."}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
