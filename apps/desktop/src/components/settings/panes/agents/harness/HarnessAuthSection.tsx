import { useEffect, useRef, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useAgentGatewayCapabilities,
  useAgentGatewayEnrollment,
  useAuthSelections,
  usePutAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { AgentLoginTerminalPanel } from "@/components/agents/AgentLoginTerminalPanel";
import { HarnessAuthApiKeyRow } from "./HarnessAuthApiKeyRow";
import { ProviderPickerModal } from "./ProviderPickerModal";
import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { getHarnessEnvVarSuggestions } from "@/config/harness-env-vars";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentLoginTerminalWorkflow } from "@/hooks/agents/workflows/use-agent-login-terminal-workflow";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { isReadyAgent } from "@/lib/domain/agents/status";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  buildDesiredSources,
  deriveEditorState,
  isMultiSourceHarness,
  isNativeState,
  type EditableApiKeyRow,
  type HarnessAuthEditorState,
} from "@/lib/domain/settings/harness-auth-sources";

interface HarnessAuthSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}

const CURSOR_HARNESS = "cursor";

export function HarnessAuthSection({
  harnessKind,
  displayName,
  surface,
}: HarnessAuthSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useAuthSelections(null, cloudActive);
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const putSelections = usePutAuthSelections();
  const { agentsByKind } = useAgentCatalog();
  const loginWorkflow = useAgentLoginTerminalWorkflow();

  // Local-authoritative editor: seeded once per (harness, surface) scope, then
  // every edit PUTs the full desired source list (contract §5). We never reseed
  // from a later refetch of the same scope, so a PUT never clobbers the draft.
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [rows, setRows] = useState<EditableApiKeyRow[]>([]);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const seededScopeRef = useRef<string | null>(null);
  const lastPutSigRef = useRef<string>("");
  const draftCounterRef = useRef(0);

  const scopeKey = `${harnessKind}:${surface}`;
  const selections = selectionsQuery.data;

  useEffect(() => {
    if (selections === undefined || seededScopeRef.current === scopeKey) {
      return;
    }
    seededScopeRef.current = scopeKey;
    const derived = deriveEditorState(selections, harnessKind, surface);
    setGatewayEnabled(derived.gatewayEnabled);
    setRows(derived.rows);
    lastPutSigRef.current = JSON.stringify(buildDesiredSources(derived));
  }, [selections, scopeKey, harnessKind, surface]);

  const localAgent = agentsByKind.get(harnessKind) ?? null;
  const loginSession = loginWorkflow.sessionsByKind[harnessKind] ?? null;

  // Close the auth terminal once the login round-trip made the agent ready.
  useEffect(() => {
    if (!loginSession?.terminal || !localAgent || !isReadyAgent(localAgent)) {
      return;
    }
    showToast(HARNESS_PANE_COPY.readyToast(displayName));
    void loginWorkflow.closeAuthTerminal(harnessKind);
  }, [
    displayName,
    harnessKind,
    localAgent,
    loginSession,
    loginWorkflow.closeAuthTerminal,
    showToast,
  ]);

  if (harnessKind === CURSOR_HARNESS) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.authenticationTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.cursorNativeDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  if (!cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  // Undefined capabilities means "not yet known" (still loading or errored), not
  // "gateway enabled" — treat it as disabled so a user can never persist a
  // gateway source on a gateway-disabled account before capabilities resolve. A
  // known-unsynced enrollment locks the gateway the same way.
  const gatewayLocked =
    !capabilities?.gatewayEnabled
    || (enrollment !== undefined && enrollment.syncStatus !== "synced");
  const apiKeys = apiKeysQuery.data ?? [];
  const multiSource = isMultiSourceHarness(harnessKind);
  const busy = putSelections.isPending;
  const editorState: HarnessAuthEditorState = { gatewayEnabled, rows };
  const native = isNativeState(editorState);

  function commit(next: HarnessAuthEditorState) {
    setGatewayEnabled(next.gatewayEnabled);
    setRows(next.rows);
    const sources = buildDesiredSources(next);
    const signature = JSON.stringify(sources);
    // De-dupe redundant PUTs (e.g. blur with no effective change).
    if (signature === lastPutSigRef.current) {
      return;
    }
    lastPutSigRef.current = signature;
    putSelections.mutate(
      { harnessKind, surface, body: { sources } },
      {
        onError: (error) => {
          showToast(
            error.message || HARNESS_PANE_COPY.selectionUpdateError(displayName),
          );
        },
      },
    );
  }

  function handleGatewayToggle(next: boolean) {
    // Single-source harnesses hold at most one enabled source: turning the
    // gateway on turns every api-key row off (radio semantics via switches).
    const nextRows =
      next && !multiSource ? rows.map((row) => ({ ...row, enabled: false })) : rows;
    commit({ gatewayEnabled: next, rows: nextRows });
  }

  function handleRowEnabledToggle(uid: string, next: boolean) {
    const nextRows = rows.map((row) => {
      if (row.uid === uid) {
        return { ...row, enabled: next };
      }
      return next && !multiSource ? { ...row, enabled: false } : row;
    });
    const nextGateway = next && !multiSource ? false : gatewayEnabled;
    commit({ gatewayEnabled: nextGateway, rows: nextRows });
  }

  function handleRowKeySelect(uid: string, keyId: string) {
    commit({
      gatewayEnabled,
      rows: rows.map((row) => (row.uid === uid ? { ...row, apiKeyId: keyId } : row)),
    });
  }

  function handleRowEnvVarChange(uid: string, envVarName: string) {
    // Free-form editing stays local; the PUT lands on blur (or another action).
    setRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, envVarName } : row)),
    );
  }

  function handleRowEnvVarBlur() {
    commit(editorState);
  }

  function handleRemoveRow(uid: string) {
    commit({ gatewayEnabled, rows: rows.filter((row) => row.uid !== uid) });
  }

  function addRow(envVarName: string, providerHint: string | null) {
    draftCounterRef.current += 1;
    const newRow: EditableApiKeyRow = {
      uid: `draft-${draftCounterRef.current}`,
      envVarName,
      apiKeyId: null,
      providerHint,
      enabled: false,
    };
    // New rows are incomplete (no key yet) so nothing is PUT until wired.
    setRows((current) => [...current, newRow]);
  }

  function handleAddVariable() {
    const used = new Set(rows.map((row) => row.envVarName));
    const suggestion = getHarnessEnvVarSuggestions(harnessKind).find(
      (candidate) => !used.has(candidate.envVarName),
    );
    addRow(suggestion?.envVarName ?? "", suggestion?.providerHint ?? null);
  }

  const canRunLogin =
    surface === "local"
    && native
    && localAgent !== null
    && !isReadyAgent(localAgent)
    && localAgent.readiness === "login_required"
    && localAgent.supportsLogin;
  const showLoginTerminal =
    surface === "local"
    && native
    && loginSession !== null
    && (loginSession.isStarting
      || loginSession.terminal !== null
      || loginSession.errorMessage !== null);

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.authenticationTitle}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName)}
    >
      {selectionsQuery.isLoading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading authentication...</p>
      ) : (
        <div className="space-y-3">
          <SettingsRow
            label={HARNESS_PANE_COPY.gatewayLabel}
            description={gatewaySubtitle(capabilities, enrollment)}
          >
            <Switch
              aria-label={HARNESS_PANE_COPY.gatewayLabel}
              checked={gatewayEnabled}
              disabled={gatewayLocked || busy}
              onChange={handleGatewayToggle}
            />
          </SettingsRow>

          <div>
            <div className="flex flex-col">
              {rows.map((row) => (
                <HarnessAuthApiKeyRow
                  key={row.uid}
                  row={row}
                  apiKeys={apiKeys}
                  busy={busy}
                  onEnvVarChange={handleRowEnvVarChange}
                  onEnvVarBlur={handleRowEnvVarBlur}
                  onKeySelect={handleRowKeySelect}
                  onEnabledToggle={handleRowEnabledToggle}
                  onRemove={handleRemoveRow}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={handleAddVariable}
              >
                <Plus className="size-3.5" />
                {HARNESS_PANE_COPY.addVariable}
              </Button>
              {multiSource ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => setProviderModalOpen(true)}
                >
                  <Plus className="size-3.5" />
                  {HARNESS_PANE_COPY.addProvider}
                </Button>
              ) : null}
            </div>
          </div>

          {native ? (
            <p className="text-sm text-muted-foreground">
              {surface === "local"
                ? HARNESS_PANE_COPY.nativeStateLocal
                : HARNESS_PANE_COPY.nativeStateCloud}
            </p>
          ) : null}

          {canRunLogin ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loginSession?.isStarting ?? false}
                onClick={() => {
                  void loginWorkflow.openAuthTerminal(localAgent, {
                    restart: Boolean(loginSession),
                  });
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
      )}

      {multiSource ? (
        <ProviderPickerModal
          open={providerModalOpen}
          onClose={() => setProviderModalOpen(false)}
          onSelect={(provider) =>
            addRow(provider.envVarNames[0] ?? "", provider.id)}
        />
      ) : null}
    </SettingsSection>
  );
}
