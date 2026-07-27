import type { ReactNode } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Check } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { gatewaySubtitle } from "#product/copy/settings/agent-auth-copy";
import {
  isGatewayCapableHarness,
  isMultiSourceHarness,
  type AuthMethod,
} from "#product/lib/domain/settings/harness-auth-sources";
import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";

export type { AuthMethod };

interface HarnessAuthSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
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
 * toggles that may both be active. CLI (native auth) is ALWAYS selected because
 * opencode's native providers coexist with injected sources — the render plane
 * no longer isolates XDG_DATA_HOME, so `opencode auth login` providers are
 * always reachable alongside gateway/api_key sources.
 *
 * api_key lights when a row is enabled (a wired key is truly active) OR while
 * the user is mid-configuration (pendingMethod === "api_key"): clicking the
 * card seeds a draft row that is not yet enabled, so a plain rows.some(enabled)
 * check would leave the card dark and the deadlock in place. Turning api_key
 * off clears pendingMethod, so "off" darkens the card even though disabled rows
 * linger for re-enabling.
 */
export function deriveSelectedMethods(editor: HarnessAuthEditorApi): Set<AuthMethod> {
  const methods = new Set<AuthMethod>(["cli"]);
  if (editor.editorState.gatewayEnabled) methods.add("gateway");
  if (isMultiSourceApiKeyActive(editor)) methods.add("api_key");
  return methods;
}

/** api_key is "on or being configured" for a multi-source harness. */
export function isMultiSourceApiKeyActive(editor: HarnessAuthEditorApi): boolean {
  return (
    editor.editorState.rows.some((row) => row.enabled)
    || editor.pendingMethod === "api_key"
  );
}

/**
 * Whether the api_key row editor should be surfaced for a multi-source harness.
 * Broader than the highlight: any row present (draft OR persisted-but-disabled)
 * or a pending click keeps the editor open so the user can wire/re-enable keys.
 */
export function isMultiSourceApiKeyConfigVisible(editor: HarnessAuthEditorApi): boolean {
  return editor.editorState.rows.length > 0 || editor.pendingMethod === "api_key";
}

const POLICY_TOOLTIP = "Disabled by your organization's policy";

export function HarnessAuthSection({
  harnessKind,
  displayName,
  surface,
  editor,
}: HarnessAuthSectionProps) {
  // Cloud surface gating is now handled at the pane level by wrapping the
  // entire cloud surface content in CloudGuard. The local surface keeps its
  // lighter inline sign-in prompt — but it gates on the auth plane (signed in),
  // NOT on cloud compute, so a local-only / self-hosted user with no E2B still
  // gets the route cards to store a key or pick a route.
  if (surface === "local" && !editor.authReady) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
        <p className="py-3 text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  return (
    <HarnessAuthMethods
      harnessKind={harnessKind}
      displayName={displayName}
      editor={editor}
    />
  );
}

interface HarnessAuthMethodsProps {
  harnessKind: string;
  displayName: string;
  editor: HarnessAuthEditorApi;
}

function HarnessAuthMethods({
  harnessKind,
  displayName,
  editor,
}: HarnessAuthMethodsProps): ReactNode {
  if (editor.selectionsQuery.isLoading) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.authenticationTitle}>
        <p className="py-3 text-ui-sm text-muted-foreground">Loading authentication...</p>
      </SettingsSection>
    );
  }

  const multiSource = isMultiSourceHarness(harnessKind);
  // Cursor has no gateway recipe (agent-auth.md: "typed refusal, no gateway
  // route exists for cursor") — its only sourced method is api_key
  // (CURSOR_API_KEY), radio-selected against CLI same as any other
  // single-source harness. The gateway card is omitted entirely rather than
  // shown-and-disabled, since there is no capability state that would ever
  // unlock it.
  const gatewayCapable = isGatewayCapableHarness(harnessKind);
  // Single-source harnesses are a radio (exactly one active method); only
  // opencode keeps the independent multi-select set.
  const selectedMethods = multiSource
    ? deriveSelectedMethods(editor)
    : new Set<AuthMethod>([deriveSelectedMethod(editor)]);
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;

  // A disallowed policy only blocks MOVING to a method, never staying on one
  // that's already selected — that's the only remediation path for a
  // pre-existing selection on a harness/route the org has since disallowed
  // (there is no DELETE endpoint). Native is deliberately excluded from the
  // harness-level gate (see editor.nativeDisallowed) so clearing a selection
  // by switching to CLI always stays reachable.
  const gatewayCardDisallowed = editor.gatewayDisallowed && !selectedMethods.has("gateway");
  const apiKeyCardDisallowed = editor.apiKeyDisallowed && !selectedMethods.has("api_key");
  const nativeCardDisallowed = editor.nativeDisallowed && !selectedMethods.has("cli");

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
      {editor.harnessDisallowed ? (
        <p className="pb-2 text-ui-sm text-muted-foreground">{POLICY_TOOLTIP}.</p>
      ) : null}
      {editor.deliveryPending ? (
        // Applied means acknowledged (agent-auth.md): the selection is stored
        // but the surface's runtime has not confirmed the delivered auth state
        // yet. Flips off when the ack lands (the selections query polls while
        // pending).
        <p className="pb-2 text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.deliveryPending}
        </p>
      ) : null}
      <div
        className="flex flex-col"
        data-harness-auth-section={harnessKind}
        data-harness-auth-delivery={editor.deliveryPending ? "pending" : "applied"}
        data-harness-selected-route={[...selectedMethods]
          .map((method) => `${harnessKind}:${method}`)
          .join(" ")}
      >
        {gatewayCapable ? (
          <MethodRow
            label={HARNESS_PANE_COPY.methodGateway}
            description={HARNESS_PANE_COPY.methodGatewayDescription}
            selected={selectedMethods.has("gateway")}
            disabled={editor.gatewayLocked || editor.busy || gatewayCardDisallowed}
            disabledReason={
              editor.gatewayLocked
                ? gatewaySubtitle(capabilities, enrollment)
                : gatewayCardDisallowed
                  ? POLICY_TOOLTIP
                  : undefined
            }
            routeOptionId={`${harnessKind}:gateway`}
            onClick={() => selectMethod("gateway")}
          />
        ) : null}
        <MethodRow
          label={HARNESS_PANE_COPY.methodApiKey}
          description={HARNESS_PANE_COPY.methodApiKeyDescription}
          selected={selectedMethods.has("api_key")}
          disabled={editor.busy || apiKeyCardDisallowed}
          disabledReason={apiKeyCardDisallowed ? POLICY_TOOLTIP : undefined}
          routeOptionId={`${harnessKind}:api_key`}
          onClick={() => selectMethod("api_key")}
        />
        <MethodRow
          label={HARNESS_PANE_COPY.methodCli}
          description={HARNESS_PANE_COPY.methodCliDescription}
          selected={selectedMethods.has("cli")}
          disabled={multiSource || editor.busy || nativeCardDisallowed}
          disabledReason={
            multiSource
              ? HARNESS_PANE_COPY.cliAlwaysActive
              : nativeCardDisallowed
                ? POLICY_TOOLTIP
                : undefined
          }
          routeOptionId={`${harnessKind}:cli`}
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
      // Disable gateway; enable first complete row if one exists. Mark api_key
      // pending so the card highlights immediately even before a key is wired.
      // If no rows exist, the details section will show an empty state with an
      // "Add API key" button; clicking the card itself never opens the modal.
      if (editor.editorState.gatewayEnabled) {
        editor.handleGatewayToggle(false);
      }
      const firstComplete = editor.editorState.rows.find(
        (row) => row.apiKeyId !== null,
      );
      if (firstComplete && !firstComplete.enabled) {
        editor.handleRowEnabledToggle(firstComplete.uid, true);
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
      if (isMultiSourceApiKeyActive(editor)) {
        // Toggle OFF: disable every row, but keep the ones that carry a wired
        // key (apiKeyId != null) so the user can re-enable them; drop bare draft
        // rows so nothing lingers. Clearing pendingMethod darkens the card, so
        // "off" reads as off even though wired-but-disabled rows remain.
        editor.commit({
          gatewayEnabled: editor.editorState.gatewayEnabled,
          rows: editor.editorState.rows
            .filter((row) => row.apiKeyId !== null)
            .map((row) => ({ ...row, enabled: false })),
        });
        editor.setPendingMethod(null);
      } else {
        // Toggle ON: enable the first wired row if one exists. Mark api_key
        // pending so the card lights immediately even before a key is wired.
        // If no rows exist, the details section will show an empty state with an
        // "Add API key" button; clicking the card itself never opens the modal.
        const firstComplete = editor.editorState.rows.find(
          (row) => row.apiKeyId !== null,
        );
        if (firstComplete) {
          editor.handleRowEnabledToggle(firstComplete.uid, true);
        }
        editor.setPendingMethod("api_key");
      }
      break;
    }
    case "cli":
      // No-op: native auth always participates for multi-source harnesses
      // (opencode's own providers coexist with gateway/api_key sources).
      // The CLI card is permanently selected and not a toggle.
      break;
  }
}

interface MethodRowProps {
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Qualification testid value (`data-harness-route-option="<kind>:<method>"`). */
  routeOptionId?: string;
  onClick: () => void;
}

/**
 * One auth-method choice as a Conductor setting row (agent-auth.md §2: "rendered
 * Conductor-style but NOT inside a card"): label and rationale on the left, the
 * selected checkmark on the right, hairline separator between rows. The whole
 * row is the hit target, and the pane's own section rules provide the structure
 * that the retired tile grid used a border box for.
 *
 * The choice is one-of-N by behavior, not by markup: `handleSingleSourceSelect`
 * drops the other sources on every pick (selection_rules.py's
 * SINGLE_SOURCE_HARNESSES), so the control writes exactly one enabled source.
 * `aria-pressed` is retained deliberately — the qualification DOM
 * (tests/release/.../chat-authroute.ts) and the pane's own suite both read it as
 * the selected-route signal.
 */
function MethodRow({
  label,
  description,
  selected,
  disabled,
  disabledReason,
  routeOptionId,
  onClick,
}: MethodRowProps) {
  return (
    <div className="border-t border-border first:border-t-0">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled}
        data-harness-route-option={routeOptionId}
        className={[
          "flex w-full min-h-[2.875rem] items-center justify-between gap-4 py-3 text-left transition-colors",
          disabled ? "pointer-events-none opacity-50" : "hover:text-foreground",
        ].join(" ")}
        onClick={onClick}
      >
        <span className="min-w-0 space-y-1">
          <span
            className={[
              "block text-ui font-medium leading-5",
              selected ? "text-foreground" : "text-muted-foreground",
            ].join(" ")}
          >
            {label}
          </span>
          <span className="block max-w-2xl whitespace-normal text-ui-sm font-normal text-muted-foreground">
            {disabled && disabledReason ? disabledReason : description}
          </span>
        </span>
        <span className="flex size-5 shrink-0 items-center justify-center">
          {selected ? <Check className="icon-paired text-foreground" /> : null}
        </span>
      </Button>
    </div>
  );
}
