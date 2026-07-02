import { useState, type FormEvent } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useCreateAgentApiKey,
  useRevokeAgentApiKey,
} from "@proliferate/cloud-sdk-react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  AGENT_API_KEY_PROVIDERS,
  agentApiKeyProviderLabel,
  type AgentApiKeyProviderId,
} from "@/config/agent-api-key-providers";

export function AgentApiKeysSection() {
  const keysQuery = useAgentApiKeys();
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  const [provider, setProvider] = useState<AgentApiKeyProviderId>("anthropic");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<AgentApiKey | null>(null);

  const keys = keysQuery.data?.keys ?? [];
  const canSubmit = displayName.trim().length > 0
    && secret.trim().length > 0
    && !createKey.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createKey.mutate(
      {
        provider,
        displayName: displayName.trim(),
        secret: secret.trim(),
      },
      {
        onSuccess: (created) => {
          setDisplayName("");
          setSecret("");
          showToast(`Added API key ${created.displayName}.`, "info");
        },
        onError: (error) => {
          showToast(error.message || "Could not add the API key.");
        },
      },
    );
  }

  function handleConfirmRevoke() {
    if (!pendingRevoke) {
      return;
    }
    revokeKey.mutate(pendingRevoke.id, {
      onSuccess: () => {
        setPendingRevoke(null);
        showToast("API key revoked.", "info");
      },
      onError: (error) => {
        setPendingRevoke(null);
        showToast(error.message || "Could not revoke the API key.");
      },
    });
  }

  return (
    <div className="space-y-6">
      <SettingsCard>
        {keysQuery.isLoading ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            Loading API keys...
          </div>
        ) : keysQuery.isError ? (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            Could not load API keys. Check your connection and try again.
          </div>
        ) : keys.length === 0 ? (
          <div className="space-y-1 px-4 py-3">
            <p className="text-sm font-medium text-foreground">No API keys yet</p>
            <p className="text-sm text-muted-foreground">
              Add a provider key below to let agents authenticate with your own key.
            </p>
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Badge tone="neutral">{agentApiKeyProviderLabel(key.provider)}</Badge>
                <span className="truncate text-sm font-medium text-foreground">
                  {key.displayName}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {key.redactedHint}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPendingRevoke(key)}
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </SettingsCard>

      <SettingsCard>
        <form className="space-y-3 p-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Add API key</p>
            <p className="text-sm text-muted-foreground">
              The secret is stored encrypted and never displayed again after saving.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="sm:w-44">
              <Label htmlFor="agent-api-key-add-provider" className="sr-only">
                Provider
              </Label>
              <Select
                id="agent-api-key-add-provider"
                aria-label="Provider"
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as AgentApiKeyProviderId)}
              >
                {AGENT_API_KEY_PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              aria-label="Key name"
              placeholder="Key name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="sm:flex-1"
            />
            <Input
              aria-label="Secret"
              placeholder="Secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="sm:flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              size="md"
              disabled={!canSubmit}
              loading={createKey.isPending}
            >
              Add key
            </Button>
          </div>
        </form>
      </SettingsCard>

      <ConfirmationDialog
        open={pendingRevoke !== null}
        title="Revoke API key"
        description={pendingRevoke
          ? `Revoke ${pendingRevoke.displayName}? Agents routed through this key will stop working until you pick another route.`
          : ""}
        confirmLabel="Revoke key"
        confirmVariant="destructive"
        loading={revokeKey.isPending}
        onClose={() => setPendingRevoke(null)}
        onConfirm={handleConfirmRevoke}
      />
    </div>
  );
}
