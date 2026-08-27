import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentLoginTerminalRecord } from "@anyharness/sdk";
import { ProliferateClientError, type AgentApiKey } from "@proliferate/cloud-sdk";
import { useMintAgentSeat } from "@proliferate/cloud-sdk-react";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  claimAgentMintToken,
  closeAgentLoginTerminal,
  getAgentLoginTerminal,
  startAgentLoginTerminal,
} from "#product/lib/access/anyharness/agents";

/**
 * The seat-mint flow (seats v1, agent_auth spec §3 flow 2), client side:
 *
 * 1. start the `mint_seat` login terminal on the runtime (`claude setup-token`
 *    in an isolated dir; single-flight per harness — a second start focuses
 *    the open terminal),
 * 2. poll the terminal's mint capture until it completes (terminal exit, or
 *    the runtime's 60s grace after the token pattern appears),
 * 3. claim the token — the runtime's ONE-TIME handoff; its buffer is wiped as
 *    the response is served — and hold it in memory only,
 * 4. `uploadSeatToken`: one POST to the vault (`kind: anthropic_subscription`
 *    + the user-entered labels). Never retried silently: a failed upload
 *    surfaces as an error telling the user to re-run the mint (the claimed
 *    token is gone with the wiped buffer — that is the design, not a gap).
 *
 * The token never touches component state, storage, or logs — it lives in a
 * local variable inside the poll tick, handed straight to the mutation.
 */

export type SeatMintPhase =
  | "idle"
  | "starting"
  | "waiting"
  | "capturing"
  | "uploading"
  | "error";

export interface SeatMintLabels {
  email: string | null;
  planTier: string | null;
}

export interface SeatMintState {
  phase: SeatMintPhase;
  terminal: AgentLoginTerminalRecord | null;
  message: string | null;
  error: string | null;
}

const IDLE_STATE: SeatMintState = {
  phase: "idle",
  terminal: null,
  message: null,
  error: null,
};

const MINT_POLL_MS = 1200;

export interface SeatMintConnection {
  baseUrl: string;
  authToken?: string;
}

function toClientConnection(connection: SeatMintConnection) {
  return { runtimeUrl: connection.baseUrl, authToken: connection.authToken };
}

export function useSeatMintWorkflow(options: {
  harnessKind: string;
  connection: SeatMintConnection;
  onSeatAdded: (seat: AgentApiKey) => void;
}) {
  const { harnessKind, connection, onSeatAdded } = options;
  const mintSeat = useMintAgentSeat();
  const [state, setState] = useState<SeatMintState>(IDLE_STATE);
  const labelsRef = useRef<SeatMintLabels>({ email: null, planTier: null });
  const pollRef = useRef<number | null>(null);
  const activeTerminalRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Stop the poll on unmount. The terminal itself is deliberately left open:
  // the runtime's single-flight guard hands the SAME terminal back on the next
  // "Add a Claude.ai login" click, so a pane switch never aborts a sign-in.
  useEffect(() => stopPolling, [stopPolling]);

  const closeTerminal = useCallback(async (terminalId: string) => {
    try {
      await closeAgentLoginTerminal(toClientConnection(connection), terminalId);
    } catch {
      // Best effort; the runtime reaps exited PTYs.
    }
  }, [connection]);

  const beginPolling = useCallback((terminalId: string) => {
    stopPolling();
    activeTerminalRef.current = terminalId;
    const clientConnection = toClientConnection(connection);
    let settled = false;
    const tick = async () => {
      if (settled) return;
      let record: AgentLoginTerminalRecord;
      try {
        record = await getAgentLoginTerminal(clientConnection, terminalId);
      } catch {
        // A vanished terminal (runtime restart) is a failed mint.
        settled = true;
        stopPolling();
        setState({
          phase: "error",
          terminal: null,
          message: null,
          error: HARNESS_PANE_COPY.seatMintFailed,
        });
        return;
      }
      // Re-check AFTER the await: with setInterval, a slow GET lets a second
      // tick start before this one resumes. Both passed the top-of-tick check,
      // and without this guard both would claim — the loser's 409 then flips
      // the UI to "mint failed" AFTER the winner already created the seat.
      if (settled) return;
      const mintStatus = record.mintStatus;
      if (mintStatus === "ready") {
        settled = true;
        stopPolling();
        setState((current) => ({ ...current, phase: "uploading", terminal: record }));
        try {
          // The one-time handoff: the runtime wipes its buffer as it serves
          // this. The token lives only in this scope.
          const { token } = await claimAgentMintToken(clientConnection, terminalId);
          const seat = await mintSeat.mutateAsync({
            value: token,
            kind: "anthropic_subscription",
            email: labelsRef.current.email,
            planTier: labelsRef.current.planTier,
          });
          await closeTerminal(terminalId);
          activeTerminalRef.current = null;
          setState(IDLE_STATE);
          onSeatAdded(seat);
        } catch (error) {
          // No silent retry (the wiped buffer means there is nothing to
          // retry WITH): tell the user to re-run the mint — EXCEPT when the
          // vault upload was refused by the server's typed GitHub-link gate
          // (403 `github_link_required`, auth/dependencies.py). "Re-run the
          // sign-in" would burn another Claude.ai sign-in into the same 403;
          // the real fix is connecting GitHub. Only the cloud upload speaks
          // `ProliferateClientError`; a runtime claim failure is a different
          // client and keeps the generic copy.
          await closeTerminal(terminalId);
          activeTerminalRef.current = null;
          setState({
            phase: "error",
            terminal: null,
            message: null,
            error:
              error instanceof ProliferateClientError
                && error.code === "github_link_required"
                ? HARNESS_PANE_COPY.seatUploadGithubLinkRequired
                : HARNESS_PANE_COPY.seatUploadFailed,
          });
        }
        return;
      }
      if (mintStatus === "failed" || mintStatus === "consumed" || mintStatus === undefined) {
        settled = true;
        stopPolling();
        await closeTerminal(terminalId);
        activeTerminalRef.current = null;
        setState({
          phase: "error",
          terminal: null,
          message: null,
          error: HARNESS_PANE_COPY.seatMintFailed,
        });
        return;
      }
      setState((current) => ({
        ...current,
        phase: mintStatus === "captured" ? "capturing" : "waiting",
        terminal: record,
      }));
    };
    pollRef.current = window.setInterval(() => {
      void tick();
    }, MINT_POLL_MS);
    void tick();
  }, [closeTerminal, connection, mintSeat, onSeatAdded, stopPolling]);

  const startMint = useCallback(async (labels: SeatMintLabels) => {
    if (!connection.baseUrl.trim()) {
      setState({
        phase: "error",
        terminal: null,
        message: null,
        error: "AnyHarness runtime is not available.",
      });
      return;
    }
    labelsRef.current = labels;
    setState({ phase: "starting", terminal: null, message: null, error: null });
    try {
      const response = await startAgentLoginTerminal(
        toClientConnection(connection),
        harnessKind,
        "mint_seat",
      );
      setState({
        phase: "waiting",
        terminal: response.agentLoginTerminal,
        message: response.message ?? null,
        error: null,
      });
      beginPolling(response.agentLoginTerminal.id);
    } catch (error) {
      setState({
        phase: "error",
        terminal: null,
        message: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [beginPolling, connection, harnessKind]);

  const cancelMint = useCallback(async () => {
    stopPolling();
    const terminalId = activeTerminalRef.current ?? state.terminal?.id ?? null;
    activeTerminalRef.current = null;
    if (terminalId) {
      await closeTerminal(terminalId);
    }
    setState(IDLE_STATE);
  }, [closeTerminal, state.terminal, stopPolling]);

  return { state, startMint, cancelMint };
}
