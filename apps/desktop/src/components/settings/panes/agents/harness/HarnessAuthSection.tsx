import type React from "react";
import { Check, CloudIcon, KeyRound, SquareTerminal } from "@proliferate/ui/icons";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import {
  isMultiSourceHarness,
  type AuthMethod,
} from "@/lib/domain/settings/harness-auth-sources";
import type { HarnessAuthEditorApi } from "./use-harness-auth-editor";

export type { AuthMethod };

interface HarnessAuthSectionProps {
  harnessKind: string;
  displayName: string;
  editor: HarnessAuthEditorApi;
}

/**
 * Single-source radio selection (claude/codex/grok/…): exactly one method is
 * active. An enabled source wins; otherwise the user's last click (pendingMethod)
 * highlights the card even before a key is wired; the implicit fallback is CLI.
 * Never infers from a draft/disabled row's mere presence (that lit up api_key
 * while gateway was on).
 */
export function deriveSelectedMethod(editor: HarnessAuthEditorApi): AuthMethod {
  if (editor.editorState.gatewayEnabled) return "gateway";
  if (editor.editorState.rows.some((row) => row.enabled)) return "api_key";
  if (editor.pendingMethod) return editor.pendingMethod;
  return "cli";
}

/**
 * Multi-source selection (opencode only): gateway and api_key are independent
 * toggles and may both be selected on purpose. CLI is shown only when neither is
 * on.
 */
export function deriveSelectedMethods(editor: HarnessAuthEditorApi): Set<AuthMethod> {
  const methods = new Set<AuthMethod>();
  if (editor.editorState.gatewayEnabled) methods.add("gateway");
  if (editor.editorState.rows.some((row) => row.enabled)) methods.add("api_key");
  if (methods.size === 0) methods.add("cli");
  return methods;
}

const CURSOR_HARNESS = "cursor";

export function HarnessAuthSection({
  harnessKind,
  displayName,
  editor,
}: HarnessAuthSectionProps) {
  if (harnessKind === CURSOR_HARNESS) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.authenticationTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.cursorNativeDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  if (!editor.cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  if (editor.selectionsQuery.isLoading) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.authenticationTitle}>
        <p className="py-3 text-sm text-muted-foreground">Loading authentication...</p>
      </SettingsSection>
    );
  }

  const multiSource = isMultiSourceHarness(harnessKind);
  // Single-source harnesses are a radio (exactly one active method); only
  // opencode keeps the independent multi-select set.
  const selectedMethods = multiSource
    ? deriveSelectedMethods(editor)
    : new Set<AuthMethod>([deriveSelectedMethod(editor)]);
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;

  function selectMethod(method: AuthMethod) {
    if (multiSource) {
      handleMultiSourceSelect(method, editor);
    } else {
      handleSingleSourceSelect(method, editor);
    }
  }

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.authenticationTitle}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName)}
    >
      <div className="grid grid-cols-3 gap-3">
        <MethodCard
          label={HARNESS_PANE_COPY.methodGateway}
          icon={<CloudIcon className="size-5" />}
          selected={selectedMethods.has("gateway")}
          disabled={editor.gatewayLocked || editor.busy}
          disabledReason={editor.gatewayLocked ? gatewaySubtitle(capabilities, enrollment) : undefined}
          onClick={() => selectMethod("gateway")}
        />
        <MethodCard
          label={HARNESS_PANE_COPY.methodApiKey}
          icon={<KeyRound className="size-5" />}
          selected={selectedMethods.has("api_key")}
          disabled={editor.busy}
          onClick={() => selectMethod("api_key")}
        />
        <MethodCard
          label={HARNESS_PANE_COPY.methodCli}
          icon={<SquareTerminal className="size-5" />}
          selected={selectedMethods.has("cli")}
          disabled={editor.busy}
          onClick={() => selectMethod("cli")}
        />
      </div>
    </SettingsSection>
  );
}

function handleSingleSourceSelect(method: AuthMethod, editor: HarnessAuthEditorApi) {
  switch (method) {
    case "gateway":
      // handleGatewayToggle already turns every api-key row off (radio
      // semantics); an enabled gateway makes deriveSelectedMethod return
      // "gateway" so no pending marker is needed.
      editor.handleGatewayToggle(true);
      editor.setPendingMethod("gateway");
      break;
    case "api_key": {
      // Disable gateway; enable first complete row if one exists, otherwise seed
      // a draft row via the existing env-var suggestion logic. Mark api_key
      // pending so the card highlights immediately even before a key is wired.
      if (editor.editorState.gatewayEnabled) {
        editor.handleGatewayToggle(false);
      }
      const firstComplete = editor.editorState.rows.find(
        (row) => row.apiKeyId !== null,
      );
      if (firstComplete && !firstComplete.enabled) {
        editor.handleRowEnabledToggle(firstComplete.uid, true);
      } else if (editor.editorState.rows.length === 0) {
        editor.handleAddVariable();
      }
      editor.setPendingMethod("api_key");
      break;
    }
    case "cli":
      // Native state: drop gateway and any incomplete draft rows (so nothing
      // keeps api_key "active"), and disable the rest. Marking cli pending makes
      // the card stick even though complete rows may linger disabled.
      editor.commit({
        gatewayEnabled: false,
        rows: editor.editorState.rows
          .filter((row) => row.apiKeyId !== null)
          .map((row) => ({ ...row, enabled: false })),
      });
      editor.setPendingMethod("cli");
      break;
  }
}

function handleMultiSourceSelect(method: AuthMethod, editor: HarnessAuthEditorApi) {
  switch (method) {
    case "gateway":
      editor.handleGatewayToggle(!editor.editorState.gatewayEnabled);
      break;
    case "api_key": {
      const hasEnabled = editor.editorState.rows.some((row) => row.enabled);
      if (hasEnabled) {
        // Toggle off all api key rows.
        editor.commit({
          gatewayEnabled: editor.editorState.gatewayEnabled,
          rows: editor.editorState.rows.map((row) => ({ ...row, enabled: false })),
        });
      } else {
        const firstComplete = editor.editorState.rows.find(
          (row) => row.apiKeyId !== null,
        );
        if (firstComplete) {
          editor.handleRowEnabledToggle(firstComplete.uid, true);
        } else if (editor.editorState.rows.length === 0) {
          editor.handleAddVariable();
        }
      }
      break;
    }
    case "cli":
      // Clicking CLI in multi-source disables everything.
      editor.commit({
        gatewayEnabled: false,
        rows: editor.editorState.rows.map((row) => ({ ...row, enabled: false })),
      });
      break;
  }
}

interface MethodCardProps {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

function MethodCard({
  label,
  icon,
  selected,
  disabled,
  disabledReason,
  onClick,
}: MethodCardProps) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        className={[
          "relative flex flex-col items-center gap-2 rounded-lg border px-4 py-5 transition-colors",
          selected
            ? "border-foreground/20 bg-foreground/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:border-foreground/10 hover:bg-foreground/[0.02]",
          disabled ? "pointer-events-none opacity-50" : "",
        ].join(" ")}
        onClick={onClick}
      >
        {selected ? (
          <Check className="absolute right-2.5 top-2.5 size-4 text-foreground" />
        ) : null}
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </button>
      {disabled && disabledReason ? (
        <p className="px-1 text-[11px] leading-tight text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
