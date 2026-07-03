import { useState, type FormEvent } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { EnvironmentSearchSelect } from "@proliferate/ui/primitives/EnvironmentSearchSelect";
import { Input } from "@proliferate/ui/primitives/Input";
import { useToastStore } from "@/stores/toast/toast-store";

const ADD_NEW_KEY_OPTION_ID = "__add-new-key__";

export interface KeyPickerProps {
  /** The caller's vault (usually `useAgentApiKeys().data`). */
  keys: AgentApiKey[];
  selectedKeyId: string | null;
  disabled?: boolean;
  /** Called with the chosen (or freshly created) key id. */
  onSelect: (keyId: string) => void;
}

/**
 * Searchable picker over the titled key vault (contract §7): title + redacted
 * hint, secrets never re-shown. "New API key…" saves a new secret to the vault
 * and wires it in one step — vault entries have no provider.
 */
export function KeyPicker({
  keys,
  selectedKeyId,
  disabled = false,
  onSelect,
}: KeyPickerProps) {
  const createKey = useCreateAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");

  const pool = keys.filter((key) => key.status === "active");
  const selected = pool.find((key) => key.id === selectedKeyId) ?? null;

  const options = [
    ...pool.map((key) => ({
      id: key.id,
      label: key.title,
      detail: key.redactedHint,
      selected: key.id === selectedKeyId,
      searchValues: [key.redactedHint],
      onSelect: () => onSelect(key.id),
    })),
    {
      id: ADD_NEW_KEY_OPTION_ID,
      label: "New API key…",
      detail: "Save a new secret to your vault and wire it here.",
      onSelect: () => setAdding(true),
    },
  ];

  const canSubmit =
    title.trim().length > 0 && value.trim().length > 0 && !createKey.isPending;

  function handleAddKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createKey.mutate(
      { title: title.trim(), value: value.trim() },
      {
        onSuccess: (created) => {
          setAdding(false);
          setTitle("");
          setValue("");
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
        className="w-full"
        menuClassName="w-72"
        label={selected
          ? `${selected.title} (${selected.redactedHint})`
          : "Select an API key"}
        options={options}
        searchPlaceholder="Search keys..."
        emptyLabel="No API keys in your vault."
        disabled={disabled}
      />
      {adding ? (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleAddKey}>
          <Input
            aria-label="Key title"
            placeholder="Key title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="sm:flex-1"
          />
          <Input
            aria-label="Value"
            placeholder="Value"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
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
