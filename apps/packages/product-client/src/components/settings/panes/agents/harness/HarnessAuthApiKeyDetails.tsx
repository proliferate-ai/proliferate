import { lazy, Suspense, useState } from "react";
import { useCreateAgentApiKey, useRevokeAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import { ApiKeyCreatorModal } from "#product/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import {
  ProviderConfigCreatorModal,
  type ProviderConfigCreatorSubmit,
} from "#product/components/settings/panes/agent-auth/ProviderConfigCreatorModal";
import {
  getHarnessEnvVarSuggestions,
  getProviderSecretEnvVar,
} from "#product/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  getProviderConfigFieldSpec,
  getSupportedProviderConfigKinds,
  type ProviderConfigKind,
} from "#product/lib/domain/settings/provider-config-fields";
import { useToastStore } from "#product/stores/toast/toast-store";
import { HarnessAuthApiKeyRow } from "#product/components/settings/panes/agents/harness/HarnessAuthApiKeyRow";

// Lazy: the picker pulls in the vendored provider-logo asset map (170+ marks),
// which must never reach the login-path chunk (login JS budget gate,
// scripts/measure-login-runtime-budget.mjs).
const ProviderPickerModal = lazy(async () => ({
  default: (
    await import("#product/components/settings/panes/agents/harness/ProviderPickerModal")
  ).ProviderPickerModal,
}));

/**
 * §4 — API keys. The container is now a flat titled section (no card, no
 * bordered panel), matching the Conductor rhythm; the key components themselves
 * (ApiKeyCreatorModal, KeyPicker via HarnessAuthApiKeyRow) are untouched.
 *
 * §4's typed "Configure Bedrock"/"Configure Azure" affordances are owned by the
 * in-flight typed-config work and are deliberately NOT rebuilt here: the
 * existing `providerConfigKinds` buttons stay exactly as they were (they render
 * only once the registry declares providerConfig, which is still never today).
 */
export function ApiKeyDetails({
  harnessKind,
  editor,
}: {
  harnessKind: string;
  editor: HarnessAuthEditorApi;
}) {
  const apiKeys = editor.apiKeysQuery.data ?? [];
  const { providerModalOpen, setProviderModalOpen } = useProviderModal();
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();
  const showToast = useToastStore((state) => state.show);
  // Inline error for the provider picker's two-write flow — the modal stays open
  // on failure so the user can retry.
  const [providerError, setProviderError] = useState<string | null>(null);

  // Compute the env-var suggestion for the modal prefill.
  const usedEnvVars = new Set(editor.editorState.rows.map((row) => row.envVarName));
  const envVarSuggestion = getHarnessEnvVarSuggestions(harnessKind).find(
    (candidate) => !usedEnvVars.has(candidate.envVarName),
  );

  // Providers this harness already has a row for — always expanded in the
  // picker (agent-auth.md §5: "already-configured providers are the ones a
  // returning user came for").
  const configuredProviderIds = editor.editorState.rows
    .map((row) => row.providerHint)
    .filter((hint): hint is string => typeof hint === "string" && hint.length > 0);

  // env_var_name values already taken on this harness. The server keys a
  // selection scope by (source_kind, env_var_name), so the picker must not offer
  // a second add of one of these (it would create a vault key and then 400).
  const boundEnvVarNames = [...usedEnvVars].filter((name) => name.length > 0);

  // Typed provider-config kinds (Bedrock/Azure) this harness may offer. Empty
  // for EVERY harness until D1 lands registry.json's `providerConfig`
  // declarations (agents-impl-plan.md §4) — see
  // provider-config-fields.ts's module comment. The buttons below simply
  // don't render while this stays empty, so the UI never promises a create
  // flow the server can't yet store or launch on.
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

  // §5's two writes: a vault api_key entry, then one selection row whose
  // env_var_name is the provider's key-shaped registry env var (never blindly
  // envVarNames[0] — that is a resource name on multi-field providers) and whose
  // provider_hint is the provider id (display-only).
  //
  // The two writes are not atomic, so the modal only closes once write 2 lands.
  // If the selection PUT is rejected, the just-created vault key is revoked
  // (nothing references it, so the revoke succeeds) and the error renders inline
  // — a failed save never leaves an orphaned key or a row that looks wired.
  function handleProviderSubmit(
    provider: { id: string; displayName: string; envVarNames: readonly string[] },
    value: string,
  ) {
    const envVarName = getProviderSecretEnvVar(provider);
    if (envVarName === null) {
      // The picker filters these out; belt-and-braces so no secret is ever
      // written under a non-key env var.
      setProviderError(HARNESS_PANE_COPY.addApiKeyError);
      return;
    }
    setProviderError(null);
    createKey.mutate(
      { title: `${provider.displayName} API key`, value },
      {
        onSuccess: (created) => {
          editor.addBoundApiKey(envVarName, provider.id, created.id, {
            onSuccess: () => {
              setProviderError(null);
              setProviderModalOpen(false);
            },
            onError: (message) => {
              setProviderError(message);
              revokeKey.mutate(created.id);
            },
          });
        },
        onError: (error) => {
          setProviderError(error.message || HARNESS_PANE_COPY.addApiKeyError);
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

  // Placeholder submit: there is no server endpoint yet for a typed vault
  // entry (D1's `kind` column + create-request shape land later), so this
  // wires the collected payload nowhere — the button that opens this modal
  // never renders today (providerConfigKinds is always []), so this path is
  // unreachable in the shipped product. D3 replaces this with the real
  // mutation once D1's request shape exists.
  function handleProviderConfigSubmit(_input: ProviderConfigCreatorSubmit) {
    setOpenProviderConfigKind(null);
  }

  const hasRows = editor.editorState.rows.length > 0;

  return (
    <SettingsSection title={HARNESS_PANE_COPY.detailsApiKey}>
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

      {editor.multiSource && providerModalOpen ? (
        <Suspense fallback={null}>
          <ProviderPickerModal
            open
            onClose={() => {
              setProviderError(null);
              setProviderModalOpen(false);
            }}
            configuredProviderIds={configuredProviderIds}
            boundEnvVarNames={boundEnvVarNames}
            submitting={createKey.isPending || editor.busy}
            error={providerError}
            onSubmit={handleProviderSubmit}
          />
        </Suspense>
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
    </SettingsSection>
  );
}

function useProviderModal() {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  return { providerModalOpen, setProviderModalOpen };
}
