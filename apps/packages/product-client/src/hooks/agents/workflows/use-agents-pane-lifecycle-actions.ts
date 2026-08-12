import { useCallback } from "react";
import { AnyHarnessError, type AgentOperationsAgent } from "@anyharness/sdk";
import {
  useCloseSubagentMutation,
  useOpenSubagentMutation,
  usePromoteSubagentMutation,
} from "@anyharness/sdk-react";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";

export type AgentsPaneLifecycleErrorKind =
  /** The child was closed by someone else while the dialog was open. The
   * caller must surface the error and refetch the roster — never success. */
  | "closed_race"
  /** Raw 404 from the lifecycle route. Explicitly NOT success: the durable
   * child no longer resolves and the integration must refetch. */
  | "not_found"
  | "unknown";

export type AgentsPaneLifecycleAction = "close" | "open" | "promote";

export interface AgentsPaneLifecycleFailure {
  ok: false;
  action: AgentsPaneLifecycleAction;
  kind: AgentsPaneLifecycleErrorKind;
  status: number | null;
  code: string | null;
  message: string;
  parentSessionId: string;
  childSessionId: string;
  clientSessionId: string;
}

export interface AgentsPaneCloseOutcome {
  ok: true;
  agent: AgentOperationsAgent;
  parentSessionId: string;
  childSessionId: string;
  clientSessionId: string;
}

export interface AgentsPaneOpenOutcome {
  ok: true;
  agent: AgentOperationsAgent;
  /** Response truth: an opened child reports running OR available. */
  presentation: AgentOperationsAgent["status"]["presentation"];
  parentSessionId: string;
  childSessionId: string;
  clientSessionId: string;
}

export interface AgentsPanePromoteOutcome {
  ok: true;
  agent: AgentOperationsAgent;
  /** Enough for integration to suppress the roster row, set the root hint,
   * and open the exact mapped ordinary tab. */
  workspaceId: string;
  parentSessionId: string;
  childSessionId: string;
  clientSessionId: string;
}

export interface AgentsPaneLifecycleTargetInput {
  parentSessionId: string;
  childSessionId: string;
  /** Mapped ProductClient client session ID for local intent/stream state. */
  clientSessionId: string;
}

function toLifecycleFailure(
  action: AgentsPaneLifecycleAction,
  input: AgentsPaneLifecycleTargetInput,
  error: unknown,
): AgentsPaneLifecycleFailure {
  const status = error instanceof AnyHarnessError
    ? typeof error.problem.status === "number" ? error.problem.status : null
    : null;
  const code = error instanceof AnyHarnessError
    ? error.problem.code ?? null
    : null;
  const kind: AgentsPaneLifecycleErrorKind = code === "SUBAGENT_OPEN_REQUIRED"
    ? "closed_race"
    : status === 404
      ? "not_found"
      : "unknown";
  return {
    ok: false,
    action,
    kind,
    status,
    code,
    message: error instanceof Error ? error.message : String(error),
    parentSessionId: input.parentSessionId,
    childSessionId: input.childSessionId,
    clientSessionId: input.clientSessionId,
  };
}

/**
 * Accepted subagent lifecycle mutations for the Agents-pane detail lane.
 * Close/Open/Promote go through the existing sdk-react mutations (which own
 * roster/session query invalidation); this hook adds the pane-local
 * consequences — purging queued intents and disconnecting the pane-owned
 * stream on Close — and folds transport errors into typed outcomes so the
 * integration layer can distinguish a Closed race from success.
 */
export function useAgentsPaneLifecycleActions({ workspaceId }: { workspaceId: string | null }) {
  const closeSubagentMutation = useCloseSubagentMutation({ workspaceId });
  const openSubagentMutation = useOpenSubagentMutation({ workspaceId });
  const promoteSubagentMutation = usePromoteSubagentMutation({ workspaceId });

  const closeChild = useCallback(async (
    input: AgentsPaneLifecycleTargetInput,
  ): Promise<AgentsPaneCloseOutcome | AgentsPaneLifecycleFailure> => {
    try {
      const response = await closeSubagentMutation.mutateAsync({
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
      });
      // Close discards queued prompts but preserves transcript state. The
      // detail's accepted response flips it to Closed, and the pane lifecycle
      // then releases only the exact stream lease that pane owns. Never close
      // the shared slot here: hot-session ingestion may own its handle.
      useSessionIntentStore.getState().clearSession(input.clientSessionId);
      return {
        ok: true,
        agent: response.agent,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        clientSessionId: input.clientSessionId,
      };
    } catch (error) {
      return toLifecycleFailure("close", input, error);
    }
  }, [closeSubagentMutation]);

  const openChild = useCallback(async (
    input: AgentsPaneLifecycleTargetInput,
  ): Promise<AgentsPaneOpenOutcome | AgentsPaneLifecycleFailure> => {
    try {
      const response = await openSubagentMutation.mutateAsync({
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
      });
      return {
        ok: true,
        agent: response.agent,
        presentation: response.agent.status.presentation,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        clientSessionId: input.clientSessionId,
      };
    } catch (error) {
      return toLifecycleFailure("open", input, error);
    }
  }, [openSubagentMutation]);

  const promoteChild = useCallback(async (
    input: AgentsPaneLifecycleTargetInput,
  ): Promise<AgentsPanePromoteOutcome | AgentsPaneLifecycleFailure> => {
    try {
      const response = await promoteSubagentMutation.mutateAsync({
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
      });
      return {
        ok: true,
        agent: response.agent,
        workspaceId: response.agent.workspace.workspaceId,
        parentSessionId: input.parentSessionId,
        childSessionId: input.childSessionId,
        clientSessionId: input.clientSessionId,
      };
    } catch (error) {
      return toLifecycleFailure("promote", input, error);
    }
  }, [promoteSubagentMutation]);

  return {
    closeChild,
    openChild,
    promoteChild,
    closePending: closeSubagentMutation.isPending,
    openPending: openSubagentMutation.isPending,
    promotePending: promoteSubagentMutation.isPending,
  };
}
