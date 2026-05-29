import type { AgentAuthCredential } from "@proliferate/cloud-sdk";
import { Badge } from "@/components/ui/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import { AgentAuthAdminTag } from "@/components/settings/panes/agent-authentication/AgentAuthAdminTag";
import {
  agentAuthAgentLabel,
  agentAuthCredentialKindLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

interface AgentAuthTeamSyncOverviewProps {
  credentials: AgentAuthCredential[];
  currentUserId: string | null;
}

export function AgentAuthTeamSyncOverview({
  credentials,
  currentUserId,
}: AgentAuthTeamSyncOverviewProps) {
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">
          {agentAuthenticationCopy.teamSyncOverviewTitle} <AgentAuthAdminTag />
        </h2>
        <p className="text-xs text-muted-foreground">
          {agentAuthenticationCopy.teamSyncOverviewDescription}
        </p>
      </div>
      <SettingsCard>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] gap-3 border-b border-border-light bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Member and harness</span>
          <span>Credential</span>
          <span>Status</span>
        </div>
        {credentials.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            No synced credentials are visible for this organization yet.
          </div>
        ) : credentials.map((credential) => (
          <div
            key={credential.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0 text-xs font-medium text-foreground">
              {credential.ownerUserId === currentUserId ? "You" : "Org member"}
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {agentAuthAgentLabel(credential.agentKind)}
              </span>
            </div>
            <div className="min-w-0 text-xs text-muted-foreground">
              <span className="block truncate text-foreground">{credential.displayName}</span>
              <span className="block truncate">{agentAuthCredentialKindLabel(credential)}</span>
            </div>
            <Badge tone={agentAuthCredentialStatusTone(credential.status)}>
              {agentAuthCredentialStatusLabel(credential.status)}
            </Badge>
          </div>
        ))}
      </SettingsCard>
    </section>
  );
}
