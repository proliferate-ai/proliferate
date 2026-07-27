import { useState } from "react";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { ApiKeyCreatorModal } from "#product/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import {
  ProviderConfigCreatorModal,
  type ProviderConfigCreatorSubmit,
} from "#product/components/settings/panes/agent-auth/ProviderConfigCreatorModal";
import { getHarnessEnvVarSuggestions } from "#product/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  getProviderConfigFieldSpec,
  getSupportedProviderConfigKinds,
  type ProviderConfigKind,
} from "#product/lib/domain/settings/provider-config-fields";
import { useToastStore } from "#product/stores/toast/toast-store";
import { HarnessPanelBlock, type HarnessBlockVariant } from "#product/components/settings/panes/agents/harness/HarnessPanelBlock";
import { HarnessAuthApiKeyRow } from "#product/components/settings/panes/agents/harness/HarnessAuthApiKeyRow";
import { ProviderPickerModal } from "#product/components/settings/panes/agents/harness/ProviderPickerModal";

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

  // Typed provider-config kinds (Bedrock/Azure) this harness may offer:
  // the registry's non-pending `providerConfig` declarations — the same set
  // the server's selection write gate admits (see provider-config-fields.ts's
  // module comment). Empty for a harness with no declarations (cursor, grok),
  // so those panes render no typed-config buttons.
  const providerConfigKinds = getSupportedProviderConfigKinds(harnessKind);
  const [openProviderConfigKind, setOpenProviderConfigKind] =
    useState<ProviderConfigKind | null>(null);

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

  // FOLLOW-UP (typed-config UI wiring): the server side is fully open —
  // POST /v1/cloud/agent-auth/keys/provider-config stores the entry and a
  // selection referencing it (api_key source, NO envVarName) persists and
  // renders — but this submit is still a placeholder: the editor's row model
  // (EditableApiKeyRow / buildDesiredSources) is env-var-keyed and cannot yet
  // represent a typed row, so the collected payload is not wired anywhere.
  // The real mutation + typed-row editor support is the remaining UI half.
  function handleProviderConfigSubmit(_input: ProviderConfigCreatorSubmit) {
    setOpenProviderConfigKind(null);
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
              <Plus className="icon-paired" />
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
                <Plus className="icon-paired" />
                {HARNESS_PANE_COPY.addProvider}
              </Button>
            ) : null}
            {providerConfigKinds.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={editor.busy}
                onClick={() => setOpenProviderConfigKind(kind)}
              >
                <Plus className="icon-paired" />
                {getProviderConfigFieldSpec(kind).displayName}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="py-3 text-ui-sm text-muted-foreground">
            No API key configured.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="gap-1.5"
              disabled={editor.busy}
              onClick={() => editor.setAddKeyModalOpen(true)}
            >
              <Plus className="icon-paired" />
              {HARNESS_PANE_COPY.addApiKey}
            </Button>
            {providerConfigKinds.map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                disabled={editor.busy}
                onClick={() => setOpenProviderConfigKind(kind)}
              >
                <Plus className="icon-paired" />
                {getProviderConfigFieldSpec(kind).displayName}
              </Button>
            ))}
          </div>
        </div>
      )}

      <ApiKeyCreatorModal
        open={editor.addKeyModalOpen}
        onClose={handleAddKeyModalClose}
        heading={HARNESS_PANE_COPY.newApiKeyModalTitle}
        description="Create and bind a new API key in one step."
        providerHint={envVarSuggestion?.providerHint ?? null}
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

      {openProviderConfigKind ? (
        <ProviderConfigCreatorModal
          open
          onClose={() => setOpenProviderConfigKind(null)}
          kind={openProviderConfigKind}
          submitLabel="Save"
          submitting={false}
          error={null}
          onSubmit={handleProviderConfigSubmit}
        />
      ) : null}
    </HarnessPanelBlock>
  );
}

function useProviderModal() {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  return { providerModalOpen, setProviderModalOpen };
}
