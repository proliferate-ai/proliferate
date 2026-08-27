import type { ReactNode } from "react";
import { useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { Check, KeyRound } from "#product/primitives/icons/core";
import { CircleUser, CloudIcon } from "#product/primitives/icons/platform";
import { SquareTerminal } from "#product/primitives/icons/workspace";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { gatewaySubtitle } from "#product/copy/settings/agent-auth-copy";
import { useAgentResourcesCache } from "#product/hooks/access/anyharness/agents/use-agent-resources-cache";
import {
  isGatewayCapableHarness,
  isSeatCapableHarness,
  type AuthMethod,
} from "#product/lib/domain/settings/harness-auth-sources";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { HarnessAuthEvidenceBadge } from "#product/components/settings/panes/agents/harness/HarnessAuthEvidenceBadge";
import { useHarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";

export type { AuthMethod };

interface HarnessAuthSectionProps {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
  editor: HarnessAuthEditorApi;
  /** Method detail area (API key config / CLI login), 16px below the cards. */
  children?: ReactNode;
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
  if (editor.editorState.seatEnabled) return "seat";
  if (editor.editorState.rows.some((row) => row.enabled)) return "api_key";
  if (editor.pendingMethod) return editor.pendingMethod;
  return "cli";
}

const POLICY_TOOLTIP = "Disabled by your organization's policy";

export function HarnessAuthSection({
  harnessKind,
  displayName,
  surface,
  editor,
  children,
}: HarnessAuthSectionProps) {
  // Cloud surface gating is handled at the pane level by CloudGuard. The local
  // surface keeps its lighter inline sign-in prompt — gated on the auth plane
  // (signed in), NOT on cloud compute, so a local-only / self-hosted user with
  // no E2B still gets the route cards to store a key or pick a route.
  if (surface === "local" && !editor.authReady) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle} titleWeight="emphasized" surface="plain">
        <p className="text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  return (
    <HarnessAuthMethods
      harnessKind={harnessKind}
      displayName={displayName}
      surface={surface}
      editor={editor}
    >
      {children}
    </HarnessAuthMethods>
  );
}

interface HarnessAuthMethodsProps extends HarnessAuthSectionProps {}

function HarnessAuthMethods({
  harnessKind,
  displayName,
  surface,
  editor,
  children,
}: HarnessAuthMethodsProps): ReactNode {
  const { invalidateAgentListResources } = useAgentResourcesCache();
  const [cliRefreshing, setCliRefreshing] = useState(false);
  // The ONE seam to the machine's auth truth: subscribed on mount, re-read at
  // the pane's boundaries. Nothing below derives a pane state from readiness,
  // credentialState, or cliAuthState.
  const authStatus = useHarnessStatus(harnessKind);

  if (editor.selectionsQuery.isLoading) {
    return (
      <SettingsSection
        title={HARNESS_PANE_COPY.authenticationTitle}
        description={HARNESS_PANE_COPY.authenticationDescription(displayName, surface)}
        titleWeight="emphasized"
        surface="plain"
      >
        <p className="text-ui-sm text-muted-foreground">Loading authentication...</p>
      </SettingsSection>
    );
  }

  // Cursor has no gateway recipe (agent-auth.md: "typed refusal, no gateway
  // route exists for cursor") — the gateway card is omitted entirely rather
  // than shown-and-disabled, since no capability state would ever unlock it.
  const gatewayCapable = isGatewayCapableHarness(harnessKind);
  const selectedMethod = deriveSelectedMethod(editor);
  const capabilities = editor.capabilitiesQuery.data;
  const enrollment = editor.enrollmentQuery.data;

  // A disallowed policy only blocks MOVING to a method, never staying on one
  // that's already selected — the only remediation path for a pre-existing
  // selection the org has since disallowed (there is no DELETE endpoint).
  const gatewayCardDisallowed = editor.gatewayDisallowed && selectedMethod !== "gateway";
  const apiKeyCardDisallowed = editor.apiKeyDisallowed && selectedMethod !== "api_key";
  const seatCardDisallowed = editor.seatDisallowed && selectedMethod !== "seat";
  const nativeCardDisallowed = editor.nativeDisallowed && selectedMethod !== "cli";

  // The merged header state (design-handoff v2): status is said exactly once,
  // as a badge next to the section title — and it is the runtime's document, not
  // a recomputation from the selected method. The refresh re-reads that document
  // plus the queries backing the selected method's editable material.
  const refreshing =
    selectedMethod === "gateway"
      ? editor.capabilitiesQuery.isFetching || editor.enrollmentQuery.isFetching
      : selectedMethod === "api_key"
        ? editor.apiKeysQuery.isFetching || editor.selectionsQuery.isFetching
        : cliRefreshing;

  function handleRefresh() {
    // The frontend never probes: it re-reads the document the runtime holds.
    authStatus.refresh();
    switch (selectedMethod) {
      case "gateway":
        void editor.capabilitiesQuery.refetch();
        void editor.enrollmentQuery.refetch();
        break;
      case "api_key":
        void editor.apiKeysQuery.refetch();
        void editor.selectionsQuery.refetch();
        break;
      case "cli": {
        const runtimeUrl = editor.loginWorkflow.runtimeConnection.baseUrl;
        if (!runtimeUrl.trim()) return;
        setCliRefreshing(true);
        void invalidateAgentListResources(runtimeUrl).finally(() => {
          setCliRefreshing(false);
        });
        break;
      }
    }
  }

  // Credits exhaustion is a failure reason even though the gateway is not
  // "locked": the state renderer is withholding the virtual key, so a launch
  // will fail closed. Naming it here is the honest surface for AA-3 — the
  // runtime's own refusal is the generic AGENT_ROUTE_SELECTION_MISSING.
  const gatewayFailureReason =
    editor.gatewayLocked || capabilities?.creditsExhausted
      ? gatewaySubtitle(capabilities, enrollment)
      : null;
  const seatCapable = isSeatCapableHarness(harnessKind);
  const cardCount = (gatewayCapable ? 3 : 2) + (seatCapable ? 1 : 0);

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.authenticationTitle}
      description={HARNESS_PANE_COPY.authenticationDescription(displayName, surface)}
      titleWeight="emphasized"
      surface="plain"
      action={(
        <HarnessAuthEvidenceBadge
          status={authStatus}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          data-harness-status={selectedMethod === "cli" ? "native" : selectedMethod}
        />
      )}
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
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cardCount}, minmax(0, 1fr))` }}
        data-harness-auth-section={harnessKind}
        data-harness-auth-delivery={editor.deliveryPending ? "pending" : "applied"}
        data-harness-selected-route={`${harnessKind}:${selectedMethod}`}
      >
        {gatewayCapable ? (
          <MethodCard
            label={HARNESS_PANE_COPY.methodGateway}
            description={HARNESS_PANE_COPY.methodGatewayDescription}
            icon={<CloudIcon className="icon-control" />}
            selected={selectedMethod === "gateway"}
            disabled={editor.gatewayLocked || editor.busy || gatewayCardDisallowed}
            subtitle={
              gatewayFailureReason
                ?? (gatewayCardDisallowed ? POLICY_TOOLTIP : undefined)
            }
            routeOptionId={`${harnessKind}:gateway`}
            onClick={() => handleSingleSourceSelect("gateway", editor)}
          />
        ) : null}
        {seatCapable ? (
          <MethodCard
            label={HARNESS_PANE_COPY.methodSeat}
            description={HARNESS_PANE_COPY.methodSeatDescription}
            icon={<CircleUser className="icon-control" />}
            selected={selectedMethod === "seat"}
            disabled={editor.busy || seatCardDisallowed}
            subtitle={seatCardDisallowed ? POLICY_TOOLTIP : undefined}
            routeOptionId={`${harnessKind}:seat`}
            onClick={() => handleSingleSourceSelect("seat", editor)}
          />
        ) : null}
        <MethodCard
          label={HARNESS_PANE_COPY.methodApiKey}
          description={HARNESS_PANE_COPY.methodApiKeyDescription}
          icon={<KeyRound className="icon-control" />}
          selected={selectedMethod === "api_key"}
          disabled={editor.busy || apiKeyCardDisallowed}
          subtitle={apiKeyCardDisallowed ? POLICY_TOOLTIP : undefined}
          routeOptionId={`${harnessKind}:api_key`}
          onClick={() => handleSingleSourceSelect("api_key", editor)}
        />
        <MethodCard
          label={HARNESS_PANE_COPY.methodCli}
          description={HARNESS_PANE_COPY.methodCliDescription}
          icon={<SquareTerminal className="icon-control" />}
          selected={selectedMethod === "cli"}
          disabled={editor.busy || nativeCardDisallowed}
          subtitle={nativeCardDisallowed ? POLICY_TOOLTIP : undefined}
          routeOptionId={`${harnessKind}:cli`}
          onClick={() => handleSingleSourceSelect("cli", editor)}
        />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </SettingsSection>
  );
}

export function handleSingleSourceSelect(method: AuthMethod, editor: HarnessAuthEditorApi) {
  switch (method) {
    case "gateway":
      // handleGatewayToggle already turns every api-key row off (radio
      // semantics); an enabled gateway makes deriveSelectedMethod return
      // "gateway" so no pending marker is needed.
      editor.handleGatewayToggle(true);
      editor.setPendingMethod("gateway");
      break;
    case "api_key": {
      // Disable gateway and enable the first complete row in ONE commit (one
      // PUT): two independent mutations for the same scope race, and the loser
      // can persist the row disabled while the UI claims api_key is wired.
      // Mark api_key pending so the card highlights even before a key exists.
      const firstComplete = editor.editorState.rows.find(
        (row) => row.apiKeyId !== null,
      );
      const needsGatewayOff = editor.editorState.gatewayEnabled;
      const needsSeatOff = editor.editorState.seatEnabled;
      const needsRowOn = firstComplete !== undefined && !firstComplete.enabled;
      if (needsGatewayOff || needsSeatOff || needsRowOn) {
        editor.commit({
          gatewayEnabled: false,
          seatEnabled: false,
          rows: needsRowOn
            ? editor.editorState.rows.map((row) =>
                row.uid === firstComplete.uid
                  ? { ...row, enabled: true }
                  : { ...row, enabled: false },
              )
            : editor.editorState.rows,
        });
      }
      editor.setPendingMethod("api_key");
      break;
    }
    case "seat":
      // Seats v1: switching to the Claude.ai-login method enables the seat
      // pool ONLY when the vault already holds a seat — with zero seats an
      // enabled pool row would render present-but-empty and refuse every
      // launch (fail-closed). With none yet, the card goes pending and the
      // detail area's mint flow commits the selection once the first seat
      // lands (the card click WAS the explicit method pick).
      if (editor.hasSeats) {
        editor.handleSeatToggle(true);
      }
      editor.setPendingMethod("seat");
      break;
    case "cli":
      // Native state: drop gateway and any incomplete draft rows (so nothing
      // keeps api_key "active"), and disable the rest. Marking cli pending makes
      // the card stick even though complete rows may linger disabled.
      editor.commit({
        gatewayEnabled: false,
        seatEnabled: false,
        rows: editor.editorState.rows
          .filter((row) => row.apiKeyId !== null)
          .map((row) => ({ ...row, enabled: false })),
      });
      editor.setPendingMethod("cli");
      break;
  }
}

interface MethodCardProps {
  label: string;
  description: string;
  icon: ReactNode;
  selected: boolean;
  disabled?: boolean;
  /** Rendered under the card when disabled (e.g. gateway enrollment failure). */
  subtitle?: string;
  /** Qualification testid value (`data-harness-route-option="<kind>:<method>"`). */
  routeOptionId?: string;
  onClick: () => void;
}

/**
 * One auth-method choice as a card (design-handoff v2): 32px
 * icon tile pinned top, label + one-line rationale bottom, check icon top-right
 * when selected. The cards are a radio by behavior, not by markup:
 * `handleSingleSourceSelect` drops the other sources on every pick
 * (selection_rules.py's SINGLE_SOURCE_HARNESSES), so the control writes exactly
 * one enabled source. `aria-pressed` is retained deliberately — the
 * qualification DOM (tests/release/.../chat-authroute.ts) and the pane's own
 * suite both read it as the selected-route signal.
 */
function MethodCard({
  label,
  description,
  icon,
  selected,
  disabled,
  subtitle,
  routeOptionId,
  onClick,
}: MethodCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled}
        data-harness-route-option={routeOptionId}
        className={[
          "relative flex min-h-28 w-full flex-col justify-end rounded-lg border px-4 py-3.5 text-left transition-colors",
          selected
            ? "border-foreground/20 bg-selected"
            : "border-border bg-transparent",
          disabled
            ? "pointer-events-none opacity-45"
            : selected
              ? ""
              : "hover:bg-hover",
        ].join(" ")}
        onClick={onClick}
      >
        <IconTile aria-hidden className="mb-auto">
          {icon}
        </IconTile>
        {selected ? (
          // MethodCard→RadioCardGroup is deferred (frozen spec §4.3: the
          // shipped RadioCardOption has no data-attribute passthrough, which
          // would drop data-harness-route-option below). 11px centers the
          // check glyph in the card's px-4 py-3.5 corner inset; not on the
          // 4px/2px space scale because it tracks the icon's own optical
          // center, not a layout gap.
          <Check
            aria-hidden
            className="icon-paired absolute right-[11px] top-[11px] text-foreground"
          />
        ) : null}
        <span
          className={[
            "mt-2.5 block text-ui font-medium",
            selected ? "text-foreground" : "text-muted-foreground",
          ].join(" ")}
        >
          {label}
        </span>
        <span className="block whitespace-normal text-ui-sm font-normal text-muted-foreground">
          {description}
        </span>
      </Button>
      {disabled && subtitle ? (
        <p className="text-ui-sm text-muted-foreground/65">{subtitle}</p>
      ) : null}
    </div>
  );
}
