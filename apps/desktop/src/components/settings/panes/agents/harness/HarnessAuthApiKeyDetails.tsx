import { useState } from "react";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { ApiKeyCreatorModal } from "@/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import { getHarnessEnvVarSuggestions } from "@/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "@/hooks/agents/workflows/use-harness-auth-editor";
import { useToastStore } from "@/stores/toast/toast-store";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";
import { HarnessAuthApiKeyRow } from "./HarnessAuthApiKeyRow";
import { ProviderPickerModal } from "./ProviderPickerModal";

export function ApiKeyDetails({
  harnessKind,
  displayName,
  editor,
  variant,
}: {
  harnessKind: string;
  displayName: string;
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const apiKeys = editor.apiKeysQuery.data ?? [];
  const { providerModalOpen, setProviderModalOpen } = useProviderModal();
  const createKey = useCreateAgentApiKey();
  const showToast = useToastStore((state) => state.show);

  // Compute the env-var suggestion for the modal prefill.
  const usedEnvVars = new Set(editor.editorState.rows.map((row) => row.envVarName));
  const envVarSuggestion = getHarnessEnvVarSuggestions(harnessKind).find(
    (candidate) => !usedEnvVars.has(candidate.envVarName),
  );

  function handleAddKeyModalSubmit(input: { title: string; value: string; envVarName: string }) {
    createKey.mutate(
      { title: input.title, value: input.value },
      {
        onSuccess: (created) => {
          editor.setAddKeyModalOpen(false);
          editor.addBoundApiKey(
            input.envVarName,
            envVarSuggestion?.providerHint ?? null,
            created.id,
          );
        },
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.addApiKeyError);
        },
      },
    );
  }

  function handleAddKeyModalClose() {
    editor.setAddKeyModalOpen(false);
    // If the modal is cancelled and there are no wired rows, revert pending
    // method so the card de-highlights.
    if (!editor.editorState.rows.some((row) => row.apiKeyId !== null && row.enabled)) {
      editor.setPendingMethod(null);
    }
  }

  const hasRows = editor.editorState.rows.length > 0;

  return (
    <HarnessPanelBlock
      variant={variant}
      title={HARNESS_PANE_COPY.detailsApiKey}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName)}
    >
      {hasRows ? (
        <div className="space-y-3">
          <div className="flex flex-col">
            {editor.editorState.rows.map((row) => (
              <HarnessAuthApiKeyRow
                key={row.uid}
                row={row}
                apiKeys={apiKeys}
                busy={editor.busy}
                onEnvVarChange={editor.handleRowEnvVarChange}
                onEnvVarBlur={editor.handleRowEnvVarBlur}
                onKeySelect={editor.handleRowKeySelect}
                onEnabledToggle={editor.handleRowEnabledToggle}
                onRemove={editor.handleRemoveRow}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={editor.busy}
              onClick={() => editor.setAddKeyModalOpen(true)}
            >
              <Plus className="size-3.5" />
              {HARNESS_PANE_COPY.addApiKey}
            </Button>
            {editor.multiSource ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={editor.busy}
                onClick={() => setProviderModalOpen(true)}
              >
                <Plus className="size-3.5" />
                {HARNESS_PANE_COPY.addProvider}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="py-3 text-sm text-muted-foreground">
            No API key configured.
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={editor.busy}
              onClick={() => editor.setAddKeyModalOpen(true)}
            >
              <Plus className="size-3.5" />
              {HARNESS_PANE_COPY.addApiKey}
            </Button>
          </div>
        </div>
      )}

      <ApiKeyCreatorModal
        open={editor.addKeyModalOpen}
        onClose={handleAddKeyModalClose}
        heading={HARNESS_PANE_COPY.newApiKeyModalTitle}
        description="Create and bind a new API key in one step."
        showTitleField
        envVarField={{
          label: "Environment variable",
          placeholder: "ENV_VAR_NAME",
          initialValue: envVarSuggestion?.envVarName ?? "",
          helpText: `The variable name the harness reads at launch.`,
        }}
        submitLabel="Create and bind"
        submitting={createKey.isPending}
        error={null}
        onSubmit={handleAddKeyModalSubmit}
      />

      {editor.multiSource ? (
        <ProviderPickerModal
          open={providerModalOpen}
          onClose={() => setProviderModalOpen(false)}
          onSelect={(provider) =>
            editor.addRow(provider.envVarNames[0] ?? "", provider.id)}
        />
      ) : null}
    </HarnessPanelBlock>
  );
}

function useProviderModal() {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  return { providerModalOpen, setProviderModalOpen };
}
