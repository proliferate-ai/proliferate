import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { useCreateAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Plus, RefreshCw } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { ApiKeyCreatorModal } from "@/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import { getHarnessEnvVarSuggestions } from "@/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useAgentResourcesCache } from "@/hooks/access/anyharness/agents/use-agent-resources-cache";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { isReadyAgent } from "@/lib/domain/agents/status";
import {
  isMultiSourceHarness,
  type AuthMethod,
} from "@/lib/domain/settings/harness-auth-sources";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";
import { HarnessAuthApiKeyRow } from "./HarnessAuthApiKeyRow";
import { isMultiSourceApiKeyConfigVisible } from "./HarnessAuthSection";
import { ProviderPickerModal } from "./ProviderPickerModal";
import type { HarnessAuthEditorApi } from "./use-harness-auth-editor";

interface HarnessAuthDetailsSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  // Single-source harnesses pass the resolved radio method; multi-source
  // harnesses ignore it and render the union of active/config blocks.
  selectedMethod: AuthMethod;
  editor: HarnessAuthEditorApi;
  variant?: HarnessBlockVariant;
}

export function HarnessAuthDetailsSection({
  harnessKind,
  displayName,
  surface,
  selectedMethod,
  editor,
  variant = "section",
}: HarnessAuthDetailsSectionProps) {
  // Multi-source (opencode): gateway, api_key, and native CLI can all be active
  // at once, so the details area is not a single-method switch. Render the
  // gateway block when gateway is on, the api_key block whenever there are rows
  // present or a key is being configured, and always the CLI/native block
  // (opencode's own providers always coexist).
  if (isMultiSourceHarness(harnessKind)) {
    return (
      <>
        {editor.editorState.gatewayEnabled ? (
          <GatewayDetails editor={editor} variant={variant} />
        ) : null}
        {isMultiSourceApiKeyConfigVisible(editor) ? (
          <ApiKeyDetails
            harnessKind={harnessKind}
            displayName={displayName}
            editor={editor}
            variant={variant}
          />
        ) : null}
        <CliDetails surface={surface} editor={editor} variant={variant} />
      </>
    );
  }

  if (selectedMethod === "gateway") {
    return <GatewayDetails editor={editor} variant={variant} />;
  }

  if (selectedMethod === "api_key") {
    return (
      <ApiKeyDetails
        harnessKind={harnessKind}
        displayName={displayName}
        editor={editor}
        variant={variant}
      />
    );
  }

  return (
    <CliDetails
      surface={surface}
      editor={editor}
      variant={variant}
    />
  );
}

function GatewayDetails({
  editor,
  variant,
}: {
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;
  return (
    <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsGateway}>
      <p className="py-3 text-sm text-muted-foreground">
        {gatewaySubtitle(capabilities, enrollment)}
      </p>
    </HarnessPanelBlock>
  );
}

function ApiKeyDetails({
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

  return (
    <HarnessPanelBlock
      variant={variant}
      title={HARNESS_PANE_COPY.detailsApiKey}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName)}
    >
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

function CliDetails({
  surface,
  editor,
  variant,
}: {
  surface: AgentAuthSurface;
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const { localAgent, loginSession, loginWorkflow } = editor;
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const { invalidateAgentListResources } = useAgentResourcesCache();
  const [refreshing, setRefreshing] = useState(false);

  function handleRefreshCredential() {
    if (!runtimeUrl.trim()) return;
    setRefreshing(true);
    void invalidateAgentListResources(runtimeUrl).finally(() => {
      setRefreshing(false);
    });
  }

  if (surface === "cloud") {
    return (
      <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsCli}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.nativeStateCloud}
        </p>
      </HarnessPanelBlock>
    );
  }

  const canRunLogin =
    localAgent != null
    && !isReadyAgent(localAgent)
    && localAgent.readiness === "login_required"
    && localAgent.supportsLogin;

  const showLoginTerminal =
    loginSession != null
    && (loginSession.isStarting
      || loginSession.terminal !== null
      || loginSession.errorMessage !== null);

  const isAuthenticated = localAgent != null && isReadyAgent(localAgent);

  return (
    <HarnessPanelBlock variant={variant} title={HARNESS_PANE_COPY.detailsCli}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {canRunLogin ? (
            <p className="text-sm font-medium text-destructive">
              {HARNESS_PANE_COPY.cliNotAuthenticated}
            </p>
          ) : isAuthenticated ? (
            <p className="text-sm text-muted-foreground">
              {HARNESS_PANE_COPY.cliAuthenticated}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {HARNESS_PANE_COPY.nativeStateLocal}
            </p>
          )}
          <IconButton
            aria-label="Refresh credential status"
            title="Refresh credential status"
            disabled={refreshing}
            onClick={handleRefreshCredential}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </IconButton>
        </div>

        {canRunLogin ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loginSession?.isStarting ?? false}
              onClick={() => {
                if (localAgent) {
                  void loginWorkflow.openAuthTerminal(localAgent, {
                    restart: Boolean(loginSession),
                  });
                }
              }}
            >
              {loginSession?.isStarting
                ? HARNESS_PANE_COPY.runLoginOpening
                : HARNESS_PANE_COPY.runLogin}
            </Button>
          </div>
        ) : null}

        {showLoginTerminal && loginSession ? (
          <AgentLoginTerminalPanel
            session={loginSession}
            baseUrl={loginWorkflow.runtimeConnection.baseUrl}
            authToken={loginWorkflow.runtimeConnection.authToken}
            onClose={(kind) => {
              void loginWorkflow.closeAuthTerminal(kind);
            }}
            onExit={(kind, code) => {
              void loginWorkflow.handleTerminalExit(kind, code);
            }}
            onRestart={() => {
              if (localAgent) {
                void loginWorkflow.openAuthTerminal(localAgent, { restart: true });
              }
            }}
          />
        ) : null}
      </div>
    </HarnessPanelBlock>
  );
}

function useProviderModal() {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  return { providerModalOpen, setProviderModalOpen };
}
