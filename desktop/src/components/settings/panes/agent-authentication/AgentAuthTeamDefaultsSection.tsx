import { useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { AgentAuthAdminTag } from "@/components/settings/panes/agent-authentication/AgentAuthAdminTag";
import { AgentAuthManagedCreditsCard } from "@/components/settings/panes/agent-authentication/AgentAuthManagedCreditsCard";
import { AgentAuthTeamSyncOverview } from "@/components/settings/panes/agent-authentication/AgentAuthTeamSyncOverview";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSelectableReason,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
  selectionByAgentKind,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

interface AgentAuthTeamDefaultsSectionProps {
  selectedOrganizationName: string;
  credentials: AgentAuthCredential[];
  currentUserId: string | null;
  capabilities: AgentGatewayCapabilities | null;
  organizationProfile: SandboxProfile | null;
  selections: SandboxAgentAuthSelection[];
  ensuringProfile: boolean;
  ensuringManagedCredits: boolean;
  selectingTeamDefault: boolean;
  revokingCredentialId: string | null;
  onEnsureOrganizationProfile: () => void;
  onEnsureManagedCredits: () => void;
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
}

export function AgentAuthTeamDefaultsSection({
  selectedOrganizationName,
  credentials,
  currentUserId,
  capabilities,
  organizationProfile,
  selections,
  ensuringProfile,
  ensuringManagedCredits,
  selectingTeamDefault,
  revokingCredentialId,
  onEnsureOrganizationProfile,
  onEnsureManagedCredits,
  onSelectTeamDefault,
  onRevokeCredential,
}: AgentAuthTeamDefaultsSectionProps) {
  const [credentialToRevoke, setCredentialToRevoke] = useState<AgentAuthCredential | null>(null);
  const selectionsByAgent = selectionByAgentKind(selections);
  const managedCreditsCredentials = credentials.filter(isProliferateManagedCreditsCredential);
  const syncedCredentials = credentials.filter(
    (credential) => credential.credentialKind === "synced_path",
  );
  const organizationByokCredentials = credentials.filter(
    (credential) => credential.ownerScope === "organization"
      && !isProliferateManagedCreditsCredential(credential),
  );
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">
          {agentAuthenticationCopy.teamDefaultsTitle} <AgentAuthAdminTag />
        </h2>
        <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
          {agentAuthenticationCopy.teamDefaultsDescription}
        </p>
      </div>

      <AgentAuthManagedCreditsCard
        capabilities={capabilities}
        selectedOrganizationName={selectedOrganizationName}
        isAdminForLibraryOrganization
        managedCredentials={managedCreditsCredentials}
        ensuring={ensuringManagedCredits}
        onEnsureManagedCredits={onEnsureManagedCredits}
      />

      <SettingsCard>
        {!organizationProfile ? (
          <SettingsCardRow
            label="Shared sandbox profile"
            description="Load the shared sandbox auth profile before choosing org-wide defaults."
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={ensuringProfile}
              onClick={() => onEnsureOrganizationProfile()}
            >
              Load team defaults
            </Button>
          </SettingsCardRow>
        ) : (
          AGENT_AUTH_AGENT_ORDER.map((agentKind) => (
            <TeamDefaultHarnessRow
              key={agentKind}
              agentKind={agentKind}
              credentials={credentials.filter((credential) => credential.agentKind === agentKind)}
              capabilities={capabilities}
              organizationProfile={organizationProfile}
              selection={selectionsByAgent.get(agentKind)}
              selecting={selectingTeamDefault}
              onSelectTeamDefault={onSelectTeamDefault}
            />
          ))
        )}
      </SettingsCard>

      {organizationByokCredentials.length > 0 && (
        <OrganizationByokCredentialsCard
          credentials={organizationByokCredentials}
          capabilities={capabilities}
          revokingCredentialId={revokingCredentialId}
          onRequestRevoke={setCredentialToRevoke}
        />
      )}

      <AgentAuthTeamSyncOverview
        credentials={syncedCredentials}
        currentUserId={currentUserId}
      />

      <ConfirmationDialog
        open={credentialToRevoke !== null}
        title="Delete organization credential?"
        description={credentialToRevoke
          ? `${credentialToRevoke.displayName} will be removed from team defaults and cannot be used by new shared cloud runs.`
          : ""}
        confirmLabel="Delete credential"
        confirmVariant="destructive"
        onClose={() => setCredentialToRevoke(null)}
        onConfirm={() => {
          const credential = credentialToRevoke;
          setCredentialToRevoke(null);
          if (credential) {
            onRevokeCredential(credential);
          }
        }}
      />
    </section>
  );
}

function TeamDefaultHarnessRow({
  agentKind,
  credentials,
  capabilities,
  organizationProfile,
  selection,
  selecting,
  onSelectTeamDefault,
}: {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  organizationProfile: SandboxProfile;
  selection: SandboxAgentAuthSelection | undefined;
  selecting: boolean;
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  const selectedCredential = selection
    ? credentials.find((credential) => credential.id === selection.credentialId) ?? null
    : null;
  const selectedCredentialMissing = Boolean(selection && !selectedCredential);
  const selectedAvailability = selectedCredential
    ? agentAuthCredentialAvailability(selectedCredential, capabilities)
    : null;
  const selectedDisabledReason = selectedCredential
    ? selectedAvailability?.reason
      ?? credentialSelectableReason(selectedCredential, organizationProfile.ownerScope)
    : null;
  const selectedNeedsAttention = selectedCredentialMissing || Boolean(selectedDisabledReason);
  return (
    <div className="border-b border-border-light px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {agentAuthAgentLabel(agentKind)}
          </div>
          <div className="mt-1 text-xs leading-4 text-muted-foreground">
            {selectedCredential
              ? selectedDisabledReason
                ? `Team cloud selected ${selectedCredential.displayName}, but ${selectedDisabledReason}`
                : `Team cloud uses ${selectedCredential.displayName}.`
              : selectedCredentialMissing
                ? "The selected credential is no longer visible to this team."
                : "No team default selected."}
          </div>
        </div>
        <Badge tone={selectedCredential && !selectedNeedsAttention
          ? "success"
          : selectedNeedsAttention ? "warning" : "neutral"}
        >
          {selectedCredential && !selectedNeedsAttention
            ? "Configured"
            : selectedNeedsAttention ? "Needs attention" : "Not set"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2">
        {credentials.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-light px-3 py-2 text-xs leading-4 text-muted-foreground">
            No usable {agentAuthAgentLabel(agentKind)} credential is visible to this team yet.
          </div>
        ) : credentials.map((credential) => {
          const availability = agentAuthCredentialAvailability(credential, capabilities);
          const disabledReason = availability.reason
            ?? credentialSelectableReason(credential, organizationProfile.ownerScope);
          const selected = selectedCredential?.id === credential.id;
          return (
            <Button
              key={credential.id}
              type="button"
              variant="unstyled"
              size="unstyled"
              disabled={selecting || disabledReason !== null}
              aria-pressed={selected}
              aria-label={`${selected ? "Selected" : "Use"} ${credential.displayName} for ${agentAuthAgentLabel(agentKind)}`}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-ring bg-accent text-foreground"
                  : "border-border-light bg-surface-elevated text-foreground hover:bg-list-hover"
              }`}
              onClick={() => onSelectTeamDefault(agentKind, credential.id)}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{credential.displayName}</span>
                  <Badge>{agentAuthCredentialKindLabel(credential)}</Badge>
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {(disabledReason ?? credentialSummaryDetails(credential)) || "Ready for shared cloud"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={availability.status === "available"
                  ? agentAuthCredentialStatusTone(credential.status)
                  : "neutral"}
                >
                  {availability.status === "available"
                    ? agentAuthCredentialStatusLabel(credential.status)
                    : availability.label}
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  {selected ? "Active" : "Use"}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function OrganizationByokCredentialsCard({
  credentials,
  capabilities,
  revokingCredentialId,
  onRequestRevoke,
}: {
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  revokingCredentialId: string | null;
  onRequestRevoke: (credential: AgentAuthCredential) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardRow
        label="Organization BYOK credentials"
        description="Provider credentials owned by the team. These can be selected as shared cloud defaults and deleted by admins."
      >
        <Badge>{credentials.length}</Badge>
      </SettingsCardRow>
      <div className="divide-y divide-border-light border-t border-border-light">
        {credentials.map((credential) => {
          const availability = agentAuthCredentialAvailability(credential, capabilities);
          return (
            <div
              key={credential.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate">{credential.displayName}</span>
                  <Badge>{agentAuthCredentialKindLabel(credential)}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {(availability.reason ?? credentialSummaryDetails(credential)) || "Ready for shared cloud"}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <Badge tone={availability.status === "available"
                  ? agentAuthCredentialStatusTone(credential.status)
                  : "neutral"}
                >
                  {availability.status === "available"
                    ? agentAuthCredentialStatusLabel(credential.status)
                    : availability.label}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={revokingCredentialId === credential.id}
                  onClick={() => onRequestRevoke(credential)}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}
