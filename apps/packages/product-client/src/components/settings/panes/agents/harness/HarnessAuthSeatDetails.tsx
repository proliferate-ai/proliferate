import { useCallback, useState } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { useRevokeAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { AgentLoginTerminalPanel } from "#product/components/agents/AgentLoginTerminalPanel";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useSeatMintWorkflow } from "#product/hooks/agents/workflows/use-seat-mint-workflow";
import { useToastStore } from "#product/stores/toast/toast-store";

/**
 * The Claude.ai logins section, single-seat subset (seats v1 — Auth Options
 * v2 design, the slice-1 cut): the seat list with labels, the "Add a
 * Claude.ai login" affordance, the mint sheet (email + optional plan tier,
 * defaulting server-side to "Max seat N"), and the inline waiting-for-sign-in
 * row with the mint terminal. Meters, serving-now/next-up tags, and the
 * rotate switch are later slices.
 *
 * Seat identity is user-entered by design: a setup-token carries no profile
 * scope, so the system can learn neither email nor plan on its own.
 */
export function SeatDetails({ editor }: { editor: HarnessAuthEditorApi }) {
  const showToast = useToastStore((state) => state.show);
  const revokeKey = useRevokeAgentApiKey();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [planTier, setPlanTier] = useState("");

  const seats = (editor.apiKeysQuery.data ?? []).filter(
    (key) => key.kind === "anthropic_subscription" && key.status === "active",
  );

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
