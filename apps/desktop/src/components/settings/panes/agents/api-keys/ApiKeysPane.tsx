import { useState, type FormEvent } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useCreateAgentApiKey,
  useRevokeAgentApiKey,
  useRouteSelections,
} from "@proliferate/cloud-sdk-react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import {
  AGENT_API_KEY_PROVIDERS,
  agentApiKeyProviderLabel,
  type AgentApiKeyProviderId,
} from "@/components/settings/panes/agent-auth/agent-api-key-providers";
import { AGENT_API_KEYS_COPY } from "@/copy/settings/agent-api-keys-copy";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  buildRevokeConfirmation,
  formatApiKeyUsages,
  formatLastValidated,
  usagesForApiKey,
} from "./api-key-usages";

export function ApiKeysPane() {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  const keysQuery = useAgentApiKeys(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();

  const [provider, setProvider] = useState<AgentApiKeyProviderId>("anthropic");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<AgentApiKey | null>(null);

  const keys = keysQuery.data?.keys ?? [];
  const selections = selectionsQuery.data?.selections ?? [];
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
          showToast(error.message || AGENT_API_KEYS_COPY.addError);
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
        showToast(AGENT_API_KEYS_COPY.revokedToast, "info");
      },
      onError: (error) => {
        setPendingRevoke(null);
        showToast(error.message || AGENT_API_KEYS_COPY.revokeError);
      },
    });
  }

  if (!cloudActive) {
    return (
      <section className="space-y-5">
        <SettingsPageHeader
          title={AGENT_API_KEYS_COPY.title}
          description={AGENT_API_KEYS_COPY.description}
        />
        <SettingsSection>
          <SettingsRow
            label={AGENT_API_KEYS_COPY.title}
            description={AGENT_API_KEYS_COPY.signInRequired}
          />
        </SettingsSection>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title={AGENT_API_KEYS_COPY.title}
        description={AGENT_API_KEYS_COPY.description}
      />

      <SettingsSection title={AGENT_API_KEYS_COPY.keysSection}>
        {keysQuery.isLoading ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.keysSection}
            description={AGENT_API_KEYS_COPY.loading}
          />
        ) : keysQuery.isError ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.keysSection}
            description={AGENT_API_KEYS_COPY.loadError}
          />
        ) : keys.length === 0 ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.emptyTitle}
            description={AGENT_API_KEYS_COPY.emptyDescription}
          />
        ) : (
          keys.map((key) => (
            <SettingsRow
              key={key.id}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone="neutral">{agentApiKeyProviderLabel(key.provider)}</Badge>
                  <span className="truncate">{key.displayName}</span>
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {key.redactedHint}
                  </span>
                </span>
              }
              description={`${formatLastValidated(key.lastValidatedAt)} · ${
                formatApiKeyUsages(usagesForApiKey(key.id, selections))
              }`}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPendingRevoke(key)}
              >
                {AGENT_API_KEYS_COPY.revokeAction}
              </Button>
            </SettingsRow>
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title={AGENT_API_KEYS_COPY.addSection}
        description={AGENT_API_KEYS_COPY.addSectionDescription}
      >
        <form className="flex flex-col gap-2 pt-2 sm:flex-row" onSubmit={handleSubmit}>
          <label className="sm:w-44">
            <span className="sr-only">{AGENT_API_KEYS_COPY.providerLabel}</span>
            <Select
              aria-label={AGENT_API_KEYS_COPY.providerLabel}
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
          </label>
          <Input
            aria-label={AGENT_API_KEYS_COPY.nameLabel}
            placeholder={AGENT_API_KEYS_COPY.namePlaceholder}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="sm:flex-1"
          />
          <Input
            aria-label={AGENT_API_KEYS_COPY.secretLabel}
            placeholder={AGENT_API_KEYS_COPY.secretPlaceholder}
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
            {AGENT_API_KEYS_COPY.addAction}
          </Button>
        </form>
      </SettingsSection>

      <ConfirmationDialog
        open={pendingRevoke !== null}
        title={AGENT_API_KEYS_COPY.revokeTitle}
        description={pendingRevoke
          ? buildRevokeConfirmation(
            pendingRevoke,
            usagesForApiKey(pendingRevoke.id, selections),
          )
          : ""}
        confirmLabel={AGENT_API_KEYS_COPY.revokeConfirmLabel}
        confirmVariant="destructive"
        loading={revokeKey.isPending}
        onClose={() => setPendingRevoke(null)}
        onConfirm={handleConfirmRevoke}
      />
    </section>
  );
}
