import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { isReadyAgent } from "@/lib/domain/agents/status";
import { HarnessPanelBlock, type HarnessBlockVariant } from "./HarnessPanelBlock";
import { HarnessAuthApiKeyRow } from "./HarnessAuthApiKeyRow";
import { ProviderPickerModal } from "./ProviderPickerModal";
import type { HarnessAuthEditorApi } from "./use-harness-auth-editor";

type AuthMethod = "gateway" | "api_key" | "cli";

interface HarnessAuthDetailsSectionProps {
  displayName: string;
  surface: AgentAuthSurface;
  selectedMethod: AuthMethod;
  editor: HarnessAuthEditorApi;
  variant?: HarnessBlockVariant;
}

export function HarnessAuthDetailsSection({
  displayName,
  surface,
  selectedMethod,
  editor,
  variant = "section",
}: HarnessAuthDetailsSectionProps) {
  if (selectedMethod === "gateway") {
    return <GatewayDetails editor={editor} variant={variant} />;
  }

  if (selectedMethod === "api_key") {
    return (
      <ApiKeyDetails
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
  displayName,
  editor,
  variant,
}: {
  displayName: string;
  editor: HarnessAuthEditorApi;
  variant: HarnessBlockVariant;
}) {
  const apiKeys = editor.apiKeysQuery.data ?? [];
  const { providerModalOpen, setProviderModalOpen } = useProviderModal();

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
          {/* "Add API key" adds a binding ROW (env var + key picker). Creating a
              brand-new vault secret happens inside the row's KeyPicker via its
              "New API key…" option — CREATE and BIND stay separate. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            disabled={editor.busy}
            onClick={() => editor.handleAddVariable()}
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
