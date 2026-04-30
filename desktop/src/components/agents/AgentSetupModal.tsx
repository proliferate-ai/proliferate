import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import { useId } from "react";
import { AGENT_SETUP_COPY } from "@/config/agents";
import { type AgentReconcileState } from "@/lib/domain/agents/status";
import { useAgentSetupWorkflow } from "@/hooks/agents/use-agent-setup-workflow";
import { ProviderIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";

interface AgentSetupModalProps {
  agent: AgentSummary;
  onClose: () => void;
  runtimeHome?: string | null;
  anyHarnessLogPath?: string | null;
  reconcileState?: AgentReconcileState;
  reconcileResult?: ReconcileAgentResult;
}

export function AgentSetupModal({
  agent,
  onClose,
  runtimeHome = null,
  anyHarnessLogPath = null,
  reconcileState = "idle",
  reconcileResult,
}: AgentSetupModalProps) {
  const credentialIdPrefix = useId();
  const state = useAgentSetupWorkflow({
    agent,
    onClose,
    reconcileState,
    reconcileResult,
  });

  return (
    <ModalShell
      open
      onClose={onClose}
      title={(
        <div className="flex items-center gap-3">
          <ProviderIcon kind={agent.kind} className="size-6" />
          <span>{agent.displayName}</span>
        </div>
      )}
      description={(
        <span>
          {state.subtitle}
          {agent.docsUrl && (
            <>
              {" · "}
              <a
                href={agent.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                {AGENT_SETUP_COPY.docs}
              </a>
            </>
          )}
        </span>
      )}
      sizeClassName="max-w-lg"
      footer={(
        <>
          {state.shouldRestartRuntime && (
            <Button
              variant="primary"
              size="sm"
              loading={state.isApplyBusy}
              onClick={() => {
                void state.handleApplyAndClose();
              }}
            >
              {state.isApplyBusy
                ? AGENT_SETUP_COPY.applying
                : AGENT_SETUP_COPY.applyAndRestart}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            {state.shouldRestartRuntime
              ? AGENT_SETUP_COPY.close
              : AGENT_SETUP_COPY.done}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {agent.message && (
          <div
            className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${state.isUnsupported
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-border bg-muted/40 text-muted-foreground"
              }`}
          >
            {agent.message}
          </div>
        )}

        {state.needsInstall && (
          <div className="space-y-2">
            <Button
              variant="primary"
              loading={state.isInstallBusy}
              onClick={() => {
                void state.handleInstall();
              }}
              disabled={
                state.isBusy
                || state.isAgentSeedHydrating
                || reconcileState === "reconciling"
              }
              className="w-full"
            >
              {state.installButtonLabel}
            </Button>
            {(state.installError || (state.isRetry && reconcileResult?.message)) && (
              <div className="space-y-1 text-xs text-destructive">
                <p>{state.installError ?? reconcileResult?.message}</p>
                {(runtimeHome || anyHarnessLogPath) && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {runtimeHome && (
                      <span>Runtime home: {runtimeHome}</span>
                    )}
                    {runtimeHome && anyHarnessLogPath && " · "}
                    {anyHarnessLogPath && (
                      <span>AnyHarness log: {anyHarnessLogPath}</span>
                    )}
                  </p>
                )}
                {agent.docsUrl && (
                  <a
                    href={agent.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-link"
                  >
                    {AGENT_SETUP_COPY.docs}
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {state.showCredentials && state.hasEnvVars && (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {AGENT_SETUP_COPY.apiKeys}
            </p>
            {state.credentialFields.map((field) => {
              const inputId = `${credentialIdPrefix}-${field.name}`;
              return (
                <div key={field.name} className="space-y-1.5">
                  <Label
                    htmlFor={inputId}
                    className="mb-0 text-xs font-medium text-foreground"
                  >
                    {field.label}
                  </Label>
                  {field.isConfigured && !field.isEditing ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-success/70" />
                        {AGENT_SETUP_COPY.savedInKeychain}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => state.startEditingCredential(field.name)}
                        className="h-auto px-0 py-0 text-xs"
                      >
                        {AGENT_SETUP_COPY.changeSavedCredential}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        id={inputId}
                        type="password"
                        value={field.value}
                        onChange={(event) =>
                          state.updateCredentialValue(field.name, event.target.value)}
                        placeholder={AGENT_SETUP_COPY.credentialPlaceholder}
                        className="h-8 flex-1 px-2.5 text-sm"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        loading={field.isSaving}
                        onClick={() => {
                          void state.handleSaveCredential(field.name);
                        }}
                        disabled={state.isBusy || !field.value.trim()}
                      >
                        {AGENT_SETUP_COPY.saveCredential}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {state.credentialsError && (
              <p className="text-xs text-destructive">
                {state.credentialsError}
              </p>
            )}
          </div>
        )}

        {state.showCredentials && agent.supportsLogin && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {AGENT_SETUP_COPY.cliLogin}
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={state.isLoginBusy}
              onClick={() => {
                void state.handleLogin();
              }}
              disabled={state.isBusy}
            >
              {state.loginButtonLabel}
            </Button>
            {state.loginError && (
              <p className="text-xs text-destructive">{state.loginError}</p>
            )}
            {state.loginCommand && (
              <>
                {state.loginMessage && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {state.loginMessage}
                  </p>
                )}
                <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                  {state.loginCommand}
                </code>
              </>
            )}
          </div>
        )}

        {state.showCredentials && !state.hasEnvVars && !agent.supportsLogin && (
          <p className="text-sm text-muted-foreground">
            {AGENT_SETUP_COPY.noCredentials}
          </p>
        )}

        {state.shouldRestartRuntime && (
          <div className="rounded-md border border-link/40 bg-link/10 px-3 py-2 text-xs text-link-foreground">
            {AGENT_SETUP_COPY.savedChangesNotice}
          </div>
        )}

        {state.applyError && (
          <p className="text-xs text-destructive">{state.applyError}</p>
        )}
      </div>
    </ModalShell>
  );
}
