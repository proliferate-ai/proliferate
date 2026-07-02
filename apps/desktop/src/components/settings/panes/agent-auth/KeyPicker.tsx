import { useMemo, useState, type FormEvent } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { EnvironmentSearchSelect } from "@proliferate/ui/primitives/EnvironmentSearchSelect";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  AGENT_API_KEY_PROVIDERS,
  agentApiKeyProviderLabel,
  type AgentApiKeyProviderId,
} from "@/config/agent-api-key-providers";

const ADD_NEW_KEY_OPTION_ID = "__add-new-key__";

export interface KeyPickerProps {
  /** The caller's key pool (usually `useAgentApiKeys().data.keys`). */
  keys: AgentApiKey[];
  /** Restrict the pool (and inline creation) to one provider. */
  provider?: string;
  selectedKeyId: string | null;
  disabled?: boolean;
  /** Called with the chosen (or freshly created) key id. */
  onSelect: (keyId: string) => void;
}

/**
 * Reusable searchable picker over the personal API key pool: display name +
 * provider + redacted hint, secrets never re-shown. "+ Add new key" pastes a
 * new secret inline, saves it to the pool, and attaches it in one step.
 */
export function KeyPicker({
  keys,
  provider,
  selectedKeyId,
  disabled = false,
  onSelect,
}: KeyPickerProps) {
  const createKey = useCreateAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  const [adding, setAdding] = useState(false);
  const [newProvider, setNewProvider] = useState<AgentApiKeyProviderId>("anthropic");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");

  const pool = useMemo(
    () =>
      keys.filter(
        (key) => key.status === "active" && (!provider || key.provider === provider),
      ),
    [keys, provider],
  );
  const selected = pool.find((key) => key.id === selectedKeyId) ?? null;

  const options = [
    ...pool.map((key) => ({
      id: key.id,
      label: key.displayName,
      detail: `${agentApiKeyProviderLabel(key.provider)} · ${key.redactedHint}`,
      selected: key.id === selectedKeyId,
      searchValues: [key.provider, key.redactedHint],
      onSelect: () => onSelect(key.id),
    })),
    {
      id: ADD_NEW_KEY_OPTION_ID,
      label: "+ Add new key",
      detail: "Paste a key to save it to your pool and attach it here.",
      onSelect: () => setAdding(true),
    },
  ];

  const canSubmit =
    displayName.trim().length > 0 && secret.trim().length > 0 && !createKey.isPending;

  function handleAddKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createKey.mutate(
      {
        provider: provider ?? newProvider,
        displayName: displayName.trim(),
        secret: secret.trim(),
      },
      {
        onSuccess: (created) => {
          setAdding(false);
          setDisplayName("");
          setSecret("");
          onSelect(created.id);
        },
        onError: (error) => {
          showToast(error.message || "Could not add the API key.");
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      <EnvironmentSearchSelect
        label={selected
          ? `${selected.displayName} (${selected.redactedHint})`
          : "Select an API key"}
        options={options}
        searchPlaceholder="Search keys..."
        emptyLabel={provider
          ? `No ${agentApiKeyProviderLabel(provider)} keys in your pool.`
          : "No API keys in your pool."}
        disabled={disabled}
      />
      {adding ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleAddKey}>
          {provider === undefined ? (
            <div className="sm:w-40">
              <Label htmlFor="agent-api-key-provider" className="sr-only">
                Provider
              </Label>
              <Select
                id="agent-api-key-provider"
                aria-label="Provider"
                value={newProvider}
                onChange={(event) =>
                  setNewProvider(event.target.value as AgentApiKeyProviderId)}
              >
                {AGENT_API_KEY_PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
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
            Save key
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}
    </div>
  );
}
