import { useState } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { EnvironmentSearchSelect } from "@proliferate/ui/primitives/EnvironmentSearchSelect";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useToastStore } from "@/stores/toast/toast-store";
import { ApiKeyCreatorModal } from "./ApiKeyCreatorModal";

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
 * hint, secrets never re-shown. "New API key…" opens the shared
 * {@link ApiKeyCreatorModal} in create-only mode (title + value, no env-var
 * field) — CREATE and BIND stay separate. On create we `onSelect` the new key
 * into the row that owns this picker, which already holds the env-var binding.
 */
export function KeyPicker({
  keys,
  selectedKeyId,
  disabled = false,
  onSelect,
}: KeyPickerProps) {
  const createKey = useCreateAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  const [creating, setCreating] = useState(false);

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
      label: HARNESS_PANE_COPY.newApiKeyOption,
      detail: HARNESS_PANE_COPY.newApiKeyOptionDetail,
      onSelect: () => setCreating(true),
    },
  ];

  function handleCreate(input: { title: string; value: string }) {
    createKey.mutate(
      { title: input.title, value: input.value },
      {
        onSuccess: (created) => {
          setCreating(false);
          onSelect(created.id);
        },
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.addApiKeyError);
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

      <ApiKeyCreatorModal
        open={creating}
        onClose={() => setCreating(false)}
        heading={HARNESS_PANE_COPY.newApiKeyModalTitle}
        description={HARNESS_PANE_COPY.newApiKeyModalDescription}
        showTitleField
        submitLabel={HARNESS_PANE_COPY.newApiKeySubmit}
        submitting={createKey.isPending}
        error={null}
        onSubmit={handleCreate}
      />
    </div>
  );
}
