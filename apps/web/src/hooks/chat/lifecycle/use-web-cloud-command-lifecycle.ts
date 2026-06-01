import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  getCommandStatus,
  type CloudCommandResponse,
  type ProliferateCloudClient,
} from "@proliferate/cloud-sdk";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";
import type { PendingConfigChange } from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  commandStatusFailureMessage,
  isRejectedCommandStatus,
  isTerminalCommandStatus,
  isWorkspacePreparationStatus,
  planDecisionFailureMessage,
  planDecisionProgressMessage,
  promptCommandFailureMessage,
  sessionConfigCommandFailureMessage,
} from "../../../lib/domain/chat/cloud-chat-command-presentation";
import { removePendingConfigCommand } from "../../../lib/domain/chat/cloud-chat-command-tracking";
import {
  planDecisionResolvedInRow,
  type ActivePlanDecision,
} from "../../../lib/domain/chat/cloud-chat-plan-decision";
import type { WebCloudPromptIntent } from "../../../stores/cloud/web-cloud-prompt-intent-store";
import {
  useCloudCommandStatusPolling,
  useStableCommandIds,
} from "./use-cloud-command-status-polling";

export function useWebCloudCommandLifecycle(input: {
  client: ProliferateCloudClient;
  commandStatus: CloudCommandResponse | undefined;
  pendingPromptCommandId: string | null;
  pendingPromptCommandIds: readonly string[];
  pendingPromptCommandIdsKey: string;
  optimisticPrompts: readonly WebCloudPromptIntent[];
  optimisticPromptCommandIds: readonly string[];
  optimisticPromptCommandIdsKey: string;
  pendingConfigCommandIds: readonly string[];
  pendingConfigCommandIdsKey: string;
  activePlanDecision: ActivePlanDecision | null;
  visibleTranscriptRows: readonly CloudChatTranscriptRowView[];
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setActivePlanDecision: Dispatch<SetStateAction<ActivePlanDecision | null>>;
  transcriptRefetch: () => void;
  sessionEventsRefetch: () => void;
  workspaceRefetch: () => void;
}) {
  const {
    client,
    commandStatus,
    pendingPromptCommandId,
    pendingPromptCommandIds,
    pendingPromptCommandIdsKey,
    optimisticPrompts,
    optimisticPromptCommandIds,
    optimisticPromptCommandIdsKey,
    pendingConfigCommandIds,
    pendingConfigCommandIdsKey,
    activePlanDecision,
    visibleTranscriptRows,
    setOptimisticPrompts,
    setPendingConfigChanges,
    setPendingHomePromptStatus,
    setActivePlanDecision,
    transcriptRefetch,
    sessionEventsRefetch,
    workspaceRefetch,
  } = input;
  const pendingPromptCommandIdsForPolling = useStableCommandIds(
    pendingPromptCommandIds,
    pendingPromptCommandIdsKey,
  );
  const optimisticPromptCommandIdsForPolling = useStableCommandIds(
    optimisticPromptCommandIds,
    optimisticPromptCommandIdsKey,
  );
  const pendingConfigCommandIdsForPolling = useStableCommandIds(
    pendingConfigCommandIds,
    pendingConfigCommandIdsKey,
  );

  useEffect(() => {
    const command = commandStatus;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    const hasMatchingOptimisticPrompt = optimisticPrompts.some((prompt) =>
      prompt.commandId === command.commandId && prompt.status !== "failed"
    );
    const isPersistedPendingPromptCommand = pendingPromptCommandId === command.commandId;
    if (!hasMatchingOptimisticPrompt && !isPersistedPendingPromptCommand) {
      return;
    }
    const message = commandStatusFailureMessage(
      command,
      promptCommandFailureMessage(command.status),
    ) ?? promptCommandFailureMessage(command.status);
    const isPreparing = isWorkspacePreparationStatus(message);
    if (hasMatchingOptimisticPrompt) {
      setOptimisticPrompts((current) =>
        current.map((prompt) =>
          prompt.commandId === command.commandId
            ? { ...prompt, status: isPreparing ? "queued" : "failed" }
            : prompt
        )
      );
      setPendingHomePromptStatus(message);
    }
    if (isPersistedPendingPromptCommand) {
      void transcriptRefetch();
      void sessionEventsRefetch();
    }
  }, [
    commandStatus?.commandId,
    commandStatus?.errorCode,
    commandStatus?.errorMessage,
    commandStatus?.status,
    pendingPromptCommandId,
    optimisticPrompts,
    sessionEventsRefetch,
    setOptimisticPrompts,
    setPendingHomePromptStatus,
    transcriptRefetch,
  ]);

  useCloudCommandStatusPolling({
    client,
    commandIds: pendingPromptCommandIdsForPolling,
    intervalMs: 3000,
    onCommands: (commands) => {
      if (commands.some((command) => isTerminalCommandStatus(command.status))) {
        void transcriptRefetch();
        void sessionEventsRefetch();
      }
    },
  });

  useCloudCommandStatusPolling({
    client,
    commandIds: optimisticPromptCommandIdsForPolling,
    intervalMs: 3000,
    onCommands: (commands) => {
      let failureMessage: string | null = null;
      for (const command of commands) {
        if (isRejectedCommandStatus(command.status)) {
          const message = commandStatusFailureMessage(
            command,
            promptCommandFailureMessage(command.status),
          );
          failureMessage = failureMessage ?? message;
          setOptimisticPrompts((current) =>
            current.map((prompt) =>
              prompt.commandId === command.commandId
                ? { ...prompt, status: "failed", errorMessage: message }
                : prompt
            )
          );
        } else if (command.status === "accepted" || command.status === "accepted_but_queued") {
          setOptimisticPrompts((current) =>
            current.map((prompt) =>
              prompt.commandId === command.commandId && prompt.status === "sending"
                ? { ...prompt, status: "queued" }
                : prompt
            )
          );
        }
      }
      if (failureMessage) {
        setPendingHomePromptStatus(failureMessage);
      }
      if (commands.some((command) => isTerminalCommandStatus(command.status))) {
        void transcriptRefetch();
        void sessionEventsRefetch();
      }
    },
  });

  useCloudCommandStatusPolling({
    client,
    commandIds: pendingConfigCommandIdsForPolling,
    intervalMs: 1000,
    onCommands: (commands) => {
      for (const command of commands) {
        if (isRejectedCommandStatus(command.status)) {
          setPendingConfigChanges((current) =>
            removePendingConfigCommand(current, command.commandId)
          );
          setPendingHomePromptStatus(
            commandStatusFailureMessage(
              command,
              sessionConfigCommandFailureMessage(command.status),
            ) ?? sessionConfigCommandFailureMessage(command.status),
          );
        }
      }
      if (commands.some((command) => isTerminalCommandStatus(command.status))) {
        void workspaceRefetch();
      }
    },
  });

  useEffect(() => {
    const command = commandStatus;
    if (!command || command.commandId !== pendingPromptCommandId) {
      return;
    }
    if (!isTerminalCommandStatus(command.status)) {
      return;
    }
    void transcriptRefetch();
    void sessionEventsRefetch();
  }, [
    commandStatus?.commandId,
    commandStatus?.status,
    pendingPromptCommandId,
    sessionEventsRefetch,
    transcriptRefetch,
  ]);

  useEffect(() => {
    if (!activePlanDecision) {
      return;
    }
    if (!visibleTranscriptRows.some((row) => planDecisionResolvedInRow(row, activePlanDecision))) {
      return;
    }
    setActivePlanDecision(null);
    setPendingHomePromptStatus((current) =>
      current === planDecisionProgressMessage(activePlanDecision.decision) ? null : current
    );
  }, [activePlanDecision, setActivePlanDecision, setPendingHomePromptStatus, visibleTranscriptRows]);

  useEffect(() => {
    const commandId = activePlanDecision?.commandId;
    if (!commandId) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollPlanDecisionCommand = async () => {
      try {
        const command = await getCommandStatus(commandId, client);
        if (!active) {
          return;
        }
        if (isRejectedCommandStatus(command.status)) {
          setActivePlanDecision((current) =>
            current?.commandId === command.commandId ? null : current
          );
          setPendingHomePromptStatus(
            commandStatusFailureMessage(
              command,
              planDecisionFailureMessage(activePlanDecision.decision),
            ) ?? planDecisionFailureMessage(activePlanDecision.decision),
          );
          void transcriptRefetch();
          void sessionEventsRefetch();
          return;
        }
        if (isTerminalCommandStatus(command.status)) {
          void transcriptRefetch();
          void sessionEventsRefetch();
        }
      } catch {
        // Keep polling; transient status reads should not strand the plan action UI.
      }
      if (active) {
        timeoutId = window.setTimeout(pollPlanDecisionCommand, 1500);
      }
    };

    timeoutId = window.setTimeout(pollPlanDecisionCommand, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activePlanDecision?.commandId,
    activePlanDecision?.decision,
    client,
    sessionEventsRefetch,
    setActivePlanDecision,
    setPendingHomePromptStatus,
    transcriptRefetch,
  ]);

  useEffect(() => {
    const command = commandStatus;
    if (
      !activePlanDecision?.commandId
      || !command
      || command.commandId !== activePlanDecision.commandId
      || !isRejectedCommandStatus(command.status)
    ) {
      return;
    }
    setActivePlanDecision(null);
    setPendingHomePromptStatus(
      commandStatusFailureMessage(
        command,
        planDecisionFailureMessage(activePlanDecision.decision),
      ) ?? planDecisionFailureMessage(activePlanDecision.decision),
    );
  }, [
    activePlanDecision?.commandId,
    activePlanDecision?.decision,
    commandStatus?.commandId,
    commandStatus?.errorCode,
    commandStatus?.errorMessage,
    commandStatus?.status,
    setActivePlanDecision,
    setPendingHomePromptStatus,
  ]);

  useEffect(() => {
    const command = commandStatus;
    if (!command || !isRejectedCommandStatus(command.status)) {
      return;
    }
    if (!optimisticPrompts.some((prompt) =>
      prompt.commandId === command.commandId && prompt.status !== "failed"
    )) {
      return;
    }
    const message = commandStatusFailureMessage(
      command,
      promptCommandFailureMessage(command.status),
    ) ?? promptCommandFailureMessage(command.status);
    const isPreparing = isWorkspacePreparationStatus(message);
    setOptimisticPrompts((current) =>
      current.map((prompt) =>
        prompt.commandId === command.commandId && prompt.status !== "failed"
          ? { ...prompt, status: isPreparing ? "queued" : "failed" }
          : prompt
      ),
    );
    setPendingHomePromptStatus(message);
  }, [
    commandStatus?.commandId,
    commandStatus?.errorCode,
    commandStatus?.errorMessage,
    commandStatus?.status,
    optimisticPrompts,
    setOptimisticPrompts,
    setPendingHomePromptStatus,
  ]);
}
