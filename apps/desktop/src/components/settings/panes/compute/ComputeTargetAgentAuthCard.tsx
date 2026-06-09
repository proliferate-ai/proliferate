import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialProviderId,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import {
  useAgentAuthCredentials,
  useAgentAuthMutations,
  useCloudCapabilities,
  useSandboxAgentAuthSelections,
  useSandboxAgentAuthTargetStates,
} from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Select } from "@proliferate/ui/primitives/Select";
import {
  agentAuthAgentLabel,
} from "@/lib/domain/agent-auth/agent-auth-agent-presentation";
import {
  agentAuthSlotDefinitions,
  agentAuthSlotLabel,
  credentialsForAgentAuthSlot,
  selectionByAgentAuthSlot,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";
import {
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSelectableReason,
  isAgentAuthCredentialVisibleForCapabilities,
  targetStateSummary,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";

interface ComputeTargetAgentAuthCardProps {
  target: ComputeTargetDetail | ComputeTargetSummary;
}

export function ComputeTargetAgentAuthCard({ target }: ComputeTargetAgentAuthCardProps) {
  const [profile, setProfile] = useState<SandboxProfile | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const sharedTarget = target.ownerScope === "organization";
  const admin = useIsAdmin(sharedTarget ? target.organizationId ?? null : null);
  const canManageAgentAuth = !sharedTarget || admin.isAdmin;
  const mutations = useAgentAuthMutations();
  const { data: credentials = [] } = useAgentAuthCredentials({
    organizationId: profile?.organizationId ?? null,
    enabled: profile !== null,
  });
  const { data: selections = [] } = useSandboxAgentAuthSelections(profile?.id ?? null);
  const { data: targetStates = [] } = useSandboxAgentAuthTargetStates(profile?.id ?? null);
  const { data: capabilities } = useCloudCapabilities();
  const agentGatewayCapabilities = capabilities?.agentGateway ?? null;
  const slots = useMemo(
    () => agentAuthSlotDefinitions(agentGatewayCapabilities),
    [agentGatewayCapabilities],
  );
  const visibleCredentials = useMemo(
    () =>
      credentials.filter((credential) =>
        isAgentAuthCredentialVisibleForCapabilities(credential, agentGatewayCapabilities)),
    [agentGatewayCapabilities, credentials],
  );
  const selectionsBySlot = useMemo(() => selectionByAgentAuthSlot(selections), [selections]);
  const targetState = profile ? targetStateSummary(targetStates, target.id) : null;

  useEffect(() => {
    setProfile(null);
    setFeedback(null);
  }, [target.id]);

  async function handleEnsureProfile() {
    if (!canManageAgentAuth) {
      return;
    }
    setFeedback(null);
    try {
      const nextProfile = target.ownerScope === "organization"
        ? await mutations.ensureOrganizationProfile({
            organizationId: target.organizationId!,
          })
        : await mutations.ensurePersonalProfile();
      setProfile(nextProfile);
      setFeedback("Agent auth profile loaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load agent auth profile.");
    }
  }

  async function handleSelect(
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) {
    if (!profile || !credentialId || !canManageAgentAuth) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        authSlotId,
        selection: {
          credentialId,
          credentialShareId: credentials.find(
            (credential) => credential.id === credentialId,
          )?.activeCredentialShareId ?? null,
        },
      });
      const nextProfile = profile.ownerScope === "organization"
        ? await mutations.ensureOrganizationProfile({
            organizationId: profile.organizationId!,
          })
        : await mutations.ensurePersonalProfile();
      setProfile(nextProfile);
      setFeedback(`${agentAuthAgentLabel(agentKind)} auth selection saved.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save auth selection.");
    }
  }

  return (
    <div className="space-y-3 border-t border-border/40 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-medium text-foreground">Agent auth</h4>
          <p className="text-xs text-muted-foreground">
            Select launch credentials for agent harnesses on this target.
          </p>
        </div>
        {targetState && (
          <Badge tone={agentAuthCredentialStatusTone(targetState.status)}>
            {agentAuthCredentialStatusLabel(targetState.status)}
          </Badge>
        )}
      </div>

      {!profile ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-3">
          <p className="text-xs text-muted-foreground">
            {feedback ?? (sharedTarget && !canManageAgentAuth
              ? "Shared target auth can only be configured by an organization admin."
              : "Initialize this target's sandbox profile before selecting auth.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={mutations.isEnsuringProfile}
            disabled={
              !canManageAgentAuth
              || (sharedTarget && admin.isLoading)
              || (target.ownerScope === "organization" && !target.organizationId)
            }
            onClick={() => { void handleEnsureProfile(); }}
          >
            {sharedTarget && admin.isLoading
              ? "Checking"
              : sharedTarget && !canManageAgentAuth ? "Admin only" : "Configure"}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/40 rounded-md border border-border/50">
          {slots.map((slot) => {
            const selection = selectionsBySlot.get(`${slot.agentKind}:${slot.authSlotId}`);
            const slotCredentials = credentialsForAgentAuthSlot(visibleCredentials, slot);
            const selectedCredential = selection
              ? credentials.find((credential) => credential.id === selection.credentialId)
              : undefined;
            const selectedCredentialVisible = selectedCredential
              ? slotCredentials.some((credential) => credential.id === selectedCredential.id)
              : selection === undefined;
            let unavailableSelectedCredentialLabel: string | null = null;
            if (selection && !selectedCredential) {
              unavailableSelectedCredentialLabel = "Selected credential unavailable";
            } else if (selectedCredential && !selectedCredentialVisible) {
              unavailableSelectedCredentialLabel = `${selectedCredential.displayName} · unavailable in hosted cloud`;
            }
            return (
              <AgentAuthSelectionRow
                key={`${slot.agentKind}-${slot.authSlotId}`}
                slot={slot}
                profile={profile}
                credentials={slotCredentials}
                selectedCredentialId={selection?.credentialId ?? ""}
                unavailableSelectedCredentialLabel={unavailableSelectedCredentialLabel}
                selecting={mutations.isSelectingCredential}
                disabled={!canManageAgentAuth}
                onSelect={handleSelect}
              />
            );
          })}
          {feedback && <p className="px-3 py-2 text-xs text-muted-foreground">{feedback}</p>}
        </div>
      )}
    </div>
  );
}

function AgentAuthSelectionRow({
  slot,
  profile,
  credentials,
  selectedCredentialId,
  unavailableSelectedCredentialLabel,
  selecting,
  disabled,
  onSelect,
}: {
  slot: AgentAuthSlotDefinition;
  profile: SandboxProfile;
  credentials: AgentAuthCredential[];
  selectedCredentialId: string;
  unavailableSelectedCredentialLabel: string | null;
  selecting: boolean;
  disabled: boolean;
  onSelect: (
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) => void;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
      <div className="text-sm font-medium text-foreground">{agentAuthSlotLabel(slot)}</div>
      <Select
        value={selectedCredentialId}
        disabled={disabled || selecting || credentials.length === 0}
        onChange={(event) => onSelect(slot.agentKind, slot.authSlotId, event.target.value)}
      >
        <option value="">
          {credentials.length === 0 ? "No compatible credentials" : "Select credential"}
        </option>
        {unavailableSelectedCredentialLabel && (
          <option value={selectedCredentialId} disabled>
            {unavailableSelectedCredentialLabel}
          </option>
        )}
        {credentials.map((credential) => {
          const disabledReason = credentialSelectableReason(credential, profile.ownerScope);
          return (
            <option
              key={credential.id}
              value={credential.id}
              disabled={disabledReason !== null}
            >
              {credential.displayName} · {agentAuthCredentialKindLabel(credential)}
              {disabledReason ? ` · ${disabledReason}` : ""}
            </option>
          );
        })}
      </Select>
    </div>
  );
}
