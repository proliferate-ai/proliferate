import { useState } from "react";
import type { AgentAuthCredential, AgentGatewayCapabilities } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Plus } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { CloudAgentAuthCredentialForm } from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import {
  CredentialMethodRow,
  LocalMethodRow,
  ManagedFreeCreditsMethodRow,
} from "@/components/settings/panes/agent-authentication/AuthenticationMethodRows";
import type { AgentAuthProvider, LocalAgentAuthSource } from "@/hooks/access/tauri/use-credentials-actions";
import {
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";
import { agentAuthSlotDefinitions } from "@/lib/domain/agent-auth/auth-slots";

export function AuthenticationMethodsSection({
  capabilities,
  currentUserId,
  localSourcesByProvider,
  personalCredentials,
  rescanning,
  revokingCredentialId,
  ensuringFreeCredits,
  syncingLocalProvider,
  onRescan,
  onRevokeCredential,
  onEnsureFreeCredits,
  onSyncLocalCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  localSourcesByProvider: Map<AgentAuthProvider, LocalAgentAuthSource>;
  personalCredentials: AgentAuthCredential[];
  rescanning: boolean;
  revokingCredentialId: string | null;
  ensuringFreeCredits: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  onRescan: () => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
  onEnsureFreeCredits: () => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const [credentialToRevoke, setCredentialToRevoke] = useState<AgentAuthCredential | null>(null);
  const [addingCredential, setAddingCredential] = useState(false);
  const managedCreditCredentials = personalCredentials.filter(isProliferateManagedCreditsCredential);
  const userManagedCredentials = personalCredentials.filter(
    (credential) => !isProliferateManagedCreditsCredential(credential),
  );
  const localAuthSlots = agentAuthSlotDefinitions(capabilities).filter((slot) =>
    slot.localProvider !== null
  );
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Authentication methods</h2>
        <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
          Detected local credentials, synced credentials, cloud API keys, BYOK,
          and managed credits available to your personal sandboxes.
        </p>
      </div>
      <SettingsCard>
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] gap-3 border-b border-border-light bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Method</span>
          <span>Provider</span>
          <span>Source</span>
          <span>Status</span>
        </div>
        {localAuthSlots.map((slot) => {
          return (
            <LocalMethodRow
              key={`local-${slot.agentKind}-${slot.authSlotId}`}
              slot={slot}
              localSource={slot.localProvider
                ? localSourcesByProvider.get(slot.localProvider) ?? null
                : null}
              provider={slot.localProvider}
              rescanning={rescanning}
              syncingLocalProvider={syncingLocalProvider}
              onRescan={onRescan}
              onSyncLocalCredential={onSyncLocalCredential}
            />
          );
        })}
        <ManagedFreeCreditsMethodRow
          capabilities={capabilities}
          credentials={managedCreditCredentials}
          ensuring={ensuringFreeCredits}
          onEnsureFreeCredits={onEnsureFreeCredits}
        />
        {userManagedCredentials.length === 0 ? (
          <div className="border-t border-border-light px-4 py-3 text-xs text-muted-foreground">
            No synced or BYOK credentials have been saved yet.
          </div>
        ) : userManagedCredentials.map((credential) => (
          <CredentialMethodRow
            key={credential.id}
            capabilities={capabilities}
            credential={credential}
            currentUserId={currentUserId}
            revoking={revokingCredentialId === credential.id}
            onRequestRevoke={setCredentialToRevoke}
          />
        ))}
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="flex w-full items-center justify-start gap-3 whitespace-normal px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
          onClick={() => setAddingCredential((value) => !value)}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5">
            <Plus className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">Add credential</span>
            <span className="block text-xs leading-4 text-muted-foreground">
              Add Anthropic, OpenAI, Gemini, or Bedrock credentials for a harness.
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {addingCredential ? "Close" : "Add"}
          </span>
        </Button>
      </SettingsCard>
      {addingCredential && (
        <CloudAgentAuthCredentialForm
          agentGatewayCapabilities={capabilities}
        />
      )}
      <ConfirmationDialog
        open={credentialToRevoke !== null}
        title="Delete credential?"
        description={credentialToRevoke
          ? `${credentialToRevoke.displayName} will be removed from your personal cloud credential library.`
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
