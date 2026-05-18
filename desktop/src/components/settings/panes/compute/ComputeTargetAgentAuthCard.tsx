import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  useAgentAuthCredentials,
  useAgentAuthMutations,
  useSandboxAgentAuthSelections,
  useSandboxAgentAuthTargetStates,
} from "@/hooks/access/cloud/agent-auth/use-agent-auth";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSelectableReason,
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
            managedTargetId: target.id,
          })
        : await mutations.ensurePersonalProfile({ managedTargetId: target.id });
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
            const agentCredentials = credentials.filter(
              (credential) => credential.agentKind === agentKind,
            );
            return (
              <AgentAuthSelectionRow
                key={agentKind}
                agentKind={agentKind}
                profile={profile}
                credentials={agentCredentials}
                selectedCredentialId={selection?.credentialId ?? ""}
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
  selecting,
  onSelect,
}: {
  agentKind: AgentAuthAgentKind;
  profile: SandboxProfile;
  credentials: AgentAuthCredential[];
  selectedCredentialId: string;
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
