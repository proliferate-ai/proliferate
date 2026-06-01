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
import type { WebCloudPromptIntent } from "../../../stores/cloud/web-cloud-chat-state-store";

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
    }
    if (hasMatchingOptimisticPrompt) {
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

  useEffect(() => {
    if (pendingPromptCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollPendingCommands = async () => {
      let sawTerminalCommand = false;
      for (const commandId of pendingPromptCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
        } catch {
          // Keep polling other pending commands; transient status reads should not stop transcript updates.
        }
      }
      if (!active) {
        return;
      }
      if (sawTerminalCommand) {
        void transcriptRefetch();
        void sessionEventsRefetch();
      }
      timeoutId = window.setTimeout(pollPendingCommands, 3000);
    };

    timeoutId = window.setTimeout(pollPendingCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    pendingPromptCommandIds,
    pendingPromptCommandIdsKey,
    sessionEventsRefetch,
    transcriptRefetch,
  ]);

  useEffect(() => {
    if (optimisticPromptCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollOptimisticPromptCommands = async () => {
      let sawTerminalCommand = false;
      let failureMessage: string | null = null;
      for (const commandId of optimisticPromptCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
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
        } catch {
          // Keep polling other commands; a transient read should not strand prompt echoes.
        }
      }
      if (!active) {
        return;
      }
      if (failureMessage) {
        setPendingHomePromptStatus(failureMessage);
      }
      if (sawTerminalCommand) {
        void transcriptRefetch();
        void sessionEventsRefetch();
      }
      timeoutId = window.setTimeout(pollOptimisticPromptCommands, 3000);
    };

    timeoutId = window.setTimeout(pollOptimisticPromptCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    optimisticPromptCommandIds,
    optimisticPromptCommandIdsKey,
    sessionEventsRefetch,
    setOptimisticPrompts,
    setPendingHomePromptStatus,
    transcriptRefetch,
  ]);

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
    if (pendingConfigCommandIds.length === 0) {
      return;
    }
    let active = true;
    let timeoutId: number | undefined;

    const pollPendingConfigCommands = async () => {
      let sawTerminalCommand = false;
      for (const commandId of pendingConfigCommandIds) {
        try {
          const command = await getCommandStatus(commandId, client);
          if (isTerminalCommandStatus(command.status)) {
            sawTerminalCommand = true;
          }
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
        } catch {
          // Keep polling other pending config commands; transient reads should not strand indicators.
        }
      }
      if (!active) {
        return;
      }
      if (sawTerminalCommand) {
        void workspaceRefetch();
      }
      timeoutId = window.setTimeout(pollPendingConfigCommands, 1000);
    };

    timeoutId = window.setTimeout(pollPendingConfigCommands, 0);
    return () => {
      active = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    client,
    pendingConfigCommandIds,
    pendingConfigCommandIdsKey,
    setPendingConfigChanges,
    setPendingHomePromptStatus,
    workspaceRefetch,
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
