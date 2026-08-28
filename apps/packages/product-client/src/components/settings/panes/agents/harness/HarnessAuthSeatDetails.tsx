import { useCallback, useState } from "react";
import type { AgentApiKey, AgentAuthSurface } from "@proliferate/cloud-sdk";
import { useRevokeAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Switch } from "#product/primitives/Switch";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { formatSeatResetTime } from "#product/domain/chats/transcript/seat-usage-limit";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useSeatMintWorkflow } from "#product/hooks/agents/workflows/use-seat-mint-workflow";
import { useSeatRotateSetting } from "#product/hooks/agents/workflows/use-seat-rotate-setting";
import { useHarnessStatus } from "#product/hooks/access/anyharness/agent-auth/use-harness-status";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * The Claude.ai logins section (seats v1 + slice 2, Auth Options v2 design):
 * the seat list with labels and serving-now/next-up tags, the all-cooling
 * line, the rotate switch, the "Add a Claude.ai login" affordance, the mint
 * sheet (email + optional plan tier, defaulting server-side to "Max seat N"),
 * and the inline waiting-for-sign-in row with the mint terminal. Meters are a
 * later slice.
 *
 * The tags render the runtime's rotation status VERBATIM, straight off the
 * status document (agent_auth §2): `applied.seat_id` IS the serving seat,
 * `next_seat_id` the next in line, `cooling_until` non-null only when no seat
 * can serve right now. The frontend derives nothing.
 *
 * Seat identity is user-entered by design: a setup-token carries no profile
 * scope, so the system can learn neither email nor plan on its own.
 */
export function SeatDetails({
  editor,
  surface,
}: {
  editor: HarnessAuthEditorApi;
  surface: AgentAuthSurface;
}) {
  const showToast = useToastStore((state) => state.show);
  const revokeKey = useRevokeAgentApiKey();
  const rotateSetting = useSeatRotateSetting("claude", surface, editor);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [planTier, setPlanTier] = useState("");

  const seats = (editor.apiKeysQuery.data ?? []).filter(
    (key) => key.kind === "anthropic_subscription" && key.status === "active",
  );
  const authStatus = useHarnessStatus("claude");
  // The serving seat is the applied SEAT method's own id; any other applied
  // method means no seat is serving, and no tag is shown.
  const servingSeatId =
    authStatus.applied?.kind === "seat"
      ? authStatus.applied.seat_id ?? null
      : null;
  const coolingResetTime = authStatus.coolingUntil === null
    ? null
    : formatSeatResetTime(authStatus.coolingUntil);

  const handleSeatAdded = useCallback((seat: AgentApiKey) => {
    showToast(HARNESS_PANE_COPY.seatAddedToast(seat.title), "info");
    setSheetOpen(false);
    setEmail("");
    setPlanTier("");
    // The card click was the explicit method pick; the first seat landing is
    // what makes the pool selection satisfiable, so wire it now. (With zero
    // seats the pool row would have failed every launch closed.)
    if (!editor.editorState.seatEnabled) {
      editor.handleSeatToggle(true);
    }
  }, [editor, showToast]);

  const mint = useSeatMintWorkflow({
    harnessKind: "claude",
    connection: editor.loginWorkflow.runtimeConnection,
    onSeatAdded: handleSeatAdded,
  });

  const minting = mint.state.phase !== "idle" && mint.state.phase !== "error";

  function handleStartMint() {
    setSheetOpen(false);
    void mint.startMint({
      email: email.trim() || null,
      planTier: planTier.trim() || null,
    });
  }

  function handleRemoveSeat(seat: AgentApiKey) {
    revokeKey.mutate(seat.id, {
      onError: (error) => {
        showToast(error.message || HARNESS_PANE_COPY.seatRemoveError);
      },
    });
  }

  const waitingCopy =
    mint.state.phase === "capturing"
      ? HARNESS_PANE_COPY.seatCapturing
      : mint.state.phase === "uploading"
        ? HARNESS_PANE_COPY.seatUploading
        : HARNESS_PANE_COPY.seatWaitingForSignIn;

  return (
    <div className="space-y-3" data-harness-seat-details="claude">
      {seats.length === 0 && !minting ? (
        <p className="text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.seatEmptyList}
        </p>
      ) : null}

      {seats.map((seat) => (
        <SettingsRow
          key={seat.id}
          data-seat-row={seat.id}
          label={
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{seat.title}</span>
              <span className="font-mono text-ui-sm font-normal text-muted-foreground">
                {seat.redactedHint}
              </span>
              {seat.id === servingSeatId ? (
                <Badge size="micro" tone="success" data-seat-serving-now={seat.id}>
                  {HARNESS_PANE_COPY.seatServingNowTag}
                </Badge>
              ) : seat.id === authStatus.nextSeatId ? (
                <Badge size="micro" data-seat-next-up={seat.id}>
                  {HARNESS_PANE_COPY.seatNextUpTag}
                </Badge>
              ) : null}
            </span>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={revokeKey.isPending}
            onClick={() => handleRemoveSeat(seat)}
          >
            {HARNESS_PANE_COPY.seatRemove}
          </Button>
        </SettingsRow>
      ))}

      {coolingResetTime !== null ? (
        <p className="text-ui-sm text-muted-foreground" data-seat-cooling-line>
          {HARNESS_PANE_COPY.seatCoolingLine(coolingResetTime)}
        </p>
      ) : null}

      {seats.length > 0 ? (
        <SettingsRow
          data-seat-rotate-row
          label={HARNESS_PANE_COPY.seatRotateLabel}
          description={HARNESS_PANE_COPY.seatRotateDescription}
        >
          <Switch
            checked={rotateSetting.rotateEnabled}
            disabled={!rotateSetting.loaded || rotateSetting.busy}
            aria-label={HARNESS_PANE_COPY.seatRotateLabel}
            onChange={(next) => rotateSetting.setRotate(next)}
          />
        </SettingsRow>
      ) : null}

      {minting ? (
        // The inline waiting-for-sign-in row + the mint terminal (the
        // browser sign-in may need the terminal's link or a keypress).
        <div className="space-y-2" data-seat-mint-state={mint.state.phase}>
          <p className="text-ui-sm text-muted-foreground">{waitingCopy}</p>
          {mint.state.terminal ? (
            <AgentLoginTerminalPanel
              session={{
                kind: "claude",
                terminal: mint.state.terminal,
                message: mint.state.message,
                errorMessage: null,
                isStarting: mint.state.phase === "starting",
                focusRequestToken: 0,
              }}
              baseUrl={editor.loginWorkflow.runtimeConnection.baseUrl}
              authToken={editor.loginWorkflow.runtimeConnection.authToken}
              webSocketAuthTransport={
                editor.loginWorkflow.runtimeConnection.webSocketAuthTransport
              }
              onClose={() => {
                void mint.cancelMint();
              }}
              onExit={() => {
                // Terminal exit is a capture-completion signal the RUNTIME
                // owns; the poll picks the outcome up on its next tick.
              }}
              onRestart={() => {
                void mint.cancelMint().then(() =>
                  mint.startMint({
                    email: email.trim() || null,
                    planTier: planTier.trim() || null,
                  }),
                );
              }}
            />
          ) : null}
        </div>
      ) : sheetOpen ? (
        <div className="space-y-3 rounded-lg border border-border p-3" data-seat-mint-sheet>
          <div>
            <p className="text-ui font-medium">{HARNESS_PANE_COPY.seatSheetTitle}</p>
            <p className="text-ui-sm text-muted-foreground">
              {HARNESS_PANE_COPY.seatSheetDescription}
            </p>
          </div>
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="seat-mint-email">{HARNESS_PANE_COPY.seatEmailLabel}</Label>
              <Input
                id="seat-mint-email"
                value={email}
                autoComplete="off"
                placeholder={HARNESS_PANE_COPY.seatEmailPlaceholder}
                onChange={(event) => setEmail(event.target.value)}
                data-seat-email-input
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seat-mint-plan">{HARNESS_PANE_COPY.seatPlanLabel}</Label>
              <Input
                id="seat-mint-plan"
                value={planTier}
                autoComplete="off"
                placeholder={HARNESS_PANE_COPY.seatPlanPlaceholder}
                onChange={(event) => setPlanTier(event.target.value)}
                data-seat-plan-input
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="primary" size="sm" onClick={handleStartMint} data-seat-mint-start>
              {HARNESS_PANE_COPY.seatSheetStart}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSheetOpen(false)}
            >
              {HARNESS_PANE_COPY.seatSheetCancel}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setSheetOpen(true)}
          data-seat-add-login
        >
          {HARNESS_PANE_COPY.seatAddLogin}
        </Button>
      )}

      {mint.state.error ? (
        <p className="text-ui-sm text-destructive" data-seat-mint-error>
          {mint.state.error}
        </p>
      ) : null}
    </div>
  );
}
