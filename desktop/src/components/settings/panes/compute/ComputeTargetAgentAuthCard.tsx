import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
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
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSelectableReason,
  isAgentAuthCredentialVisibleForCapabilities,
  selectionByAgentKind,
  targetStateSummary,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import type {
  ComputeTargetDetail,
  ComputeTargetSummary,
} from "@/lib/domain/compute/target-types";

interface ComputeTargetAgentAuthCardProps {
  target: ComputeTargetDetail | ComputeTargetSummary;
}

export function ComputeTargetAgentAuthCard({ target }: ComputeTargetAgentAuthCardProps) {
  const [profile, setProfile] = useState<SandboxProfile | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mutations = useAgentAuthMutations();
  const { data: credentials = [] } = useAgentAuthCredentials({
    organizationId: profile?.organizationId ?? null,
    enabled: profile !== null,
  });
  const { data: selections = [] } = useSandboxAgentAuthSelections(profile?.id ?? null);
  const { data: targetStates = [] } = useSandboxAgentAuthTargetStates(profile?.id ?? null);
  const { data: capabilities } = useCloudCapabilities();
  const agentGatewayCapabilities = capabilities?.agentGateway ?? null;
  const visibleCredentials = useMemo(
    () =>
      credentials.filter((credential) =>
        isAgentAuthCredentialVisibleForCapabilities(credential, agentGatewayCapabilities)),
    [agentGatewayCapabilities, credentials],
  );
  const selectionsByAgent = useMemo(() => selectionByAgentKind(selections), [selections]);
  const targetState = profile ? targetStateSummary(targetStates, target.id) : null;

  useEffect(() => {
    setProfile(null);
    setFeedback(null);
  }, [target.id]);

  async function handleEnsureProfile() {
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

  async function handleSelect(agentKind: AgentAuthAgentKind, credentialId: string) {
    if (!profile || !credentialId) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        selection: {
          credentialId,
          credentialShareId: credentials.find(
            (credential) => credential.id === credentialId && credential.agentKind === agentKind,
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
            {feedback ?? "Initialize this target's sandbox profile before selecting auth."}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={mutations.isEnsuringProfile}
            disabled={target.ownerScope === "organization" && !target.organizationId}
            onClick={() => { void handleEnsureProfile(); }}
          >
            Configure
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/40 rounded-md border border-border/50">
          {AGENT_AUTH_AGENT_ORDER.map((agentKind) => {
            const selection = selectionsByAgent.get(agentKind);
            const agentCredentials = visibleCredentials.filter(
              (credential) => credential.agentKind === agentKind,
            );
            const selectedCredential = selection
              ? credentials.find((credential) => credential.id === selection.credentialId)
              : undefined;
            const selectedCredentialVisible = selectedCredential
              ? agentCredentials.some((credential) => credential.id === selectedCredential.id)
              : selection === undefined;
            let unavailableSelectedCredentialLabel: string | null = null;
            if (selection && !selectedCredential) {
              unavailableSelectedCredentialLabel = "Selected credential unavailable";
            } else if (selectedCredential && !selectedCredentialVisible) {
              unavailableSelectedCredentialLabel = `${selectedCredential.displayName} · unavailable in hosted cloud`;
            }
            return (
              <AgentAuthSelectionRow
                key={agentKind}
                agentKind={agentKind}
                profile={profile}
                credentials={agentCredentials}
                selectedCredentialId={selection?.credentialId ?? ""}
                unavailableSelectedCredentialLabel={unavailableSelectedCredentialLabel}
                selecting={mutations.isSelectingCredential}
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
  agentKind,
  profile,
  credentials,
  selectedCredentialId,
  unavailableSelectedCredentialLabel,
  selecting,
  onSelect,
}: {
  agentKind: AgentAuthAgentKind;
  profile: SandboxProfile;
  credentials: AgentAuthCredential[];
  selectedCredentialId: string;
  unavailableSelectedCredentialLabel: string | null;
  selecting: boolean;
  onSelect: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
      <div className="text-sm font-medium text-foreground">{agentAuthAgentLabel(agentKind)}</div>
      <Select
        value={selectedCredentialId}
        disabled={selecting || credentials.length === 0}
        onChange={(event) => onSelect(agentKind, event.target.value)}
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
