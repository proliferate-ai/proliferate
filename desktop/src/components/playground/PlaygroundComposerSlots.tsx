import type { ReactNode } from "react";
import { ApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { McpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { UserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { CloudRuntimeAttachedPanelView } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanelView } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { WorkspaceArrivalCloudPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalCloudPanel";
import type { ScenarioKey } from "@/config/playground";
import {
  CLOUD_RUNTIME_RECONNECT_ERROR,
  CLOUD_RUNTIME_RECONNECTING,
  CLOUD_STATUS_APPLYING_FILES,
  CLOUD_STATUS_BLOCKED,
  CLOUD_STATUS_ERROR,
  CLOUD_STATUS_FIRST_RUNTIME,
  CLOUD_STATUS_PROVISIONING,
  EDIT_OPTIONS,
  EXECUTE_OPTIONS,
  GEMINI_MCP_OPTIONS,
  MCP_ELICITATION_BOOLEAN,
  MCP_ELICITATION_ENUM,
  MCP_ELICITATION_MIXED_REQUIRED,
  MCP_ELICITATION_MULTI_SELECT,
  MCP_ELICITATION_URL,
  PENDING_PROMPTS_MULTI,
  PENDING_PROMPTS_SINGLE,
  PENDING_PROMPTS_WITH_EDITING,
  PENDING_REVIEW_COMPLETE,
  PENDING_REVIEW_FEEDBACK_READY,
  PLAYGROUND_SUBAGENT_WAKE_QUEUE,
  TODOS_LONG,
  TODOS_MID,
  TODOS_SHORT,
  USER_INPUT_MULTI_QUESTION,
  USER_INPUT_OPTION_PLUS_OTHER,
  USER_INPUT_SECRET,
  USER_INPUT_SINGLE_FREEFORM,
  USER_INPUT_SINGLE_OPTION,
  WORKSPACE_ARRIVAL_CREATED,
} from "@/lib/domain/chat/__fixtures__/playground";
import {
  derivePendingPromptQueueRow,
  type PendingPromptQueueEntry,
} from "@/lib/domain/chat/outbox/pending-prompt-queue";
import { noop, noopAsync, revealExampleUrl } from "@/components/playground/PlaygroundComposerActions";
import { renderDelegationSlot } from "@/components/playground/PlaygroundComposerDelegation";

export function renderActiveSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "todos-short":
    case "todos-mid":
    case "todos-long":
    case "execute-approval":
    case "edit-approval":
    case "pending-prompts-with-approval":
    case "subagents-queued-wake-with-approval":
    case "subagents-coding-review-with-approval":
    case "gemini-mcp-approval-options":
    case "gemini-tool-before-approval":
    case "user-input-single-option":
    case "user-input-single-freeform":
    case "user-input-option-plus-other":
    case "user-input-secret":
    case "user-input-multi-question":
    case "mcp-elicitation-boolean":
    case "mcp-elicitation-enum":
    case "mcp-elicitation-multi-select":
    case "mcp-elicitation-mixed-required":
    case "mcp-elicitation-url":
    case "mcp-elicitation-validation-error":
    case "mcp-elicitation-cancel-decline":
      return renderPanelSlotFixture(scenario);
    default:
      return null;
  }
}

export function renderAttachedSlot(scenario: ScenarioKey): ReactNode | null {
  const contextPanel = (() => {
    switch (scenario) {
      case "workspace-arrival-created":
      case "cloud-first-runtime":
      case "cloud-provisioning":
      case "cloud-applying-files":
      case "cloud-blocked":
      case "cloud-error":
      case "cloud-reconnecting":
      case "cloud-reconnect-error":
        return renderPanelSlotFixture(scenario);
      default:
        return null;
    }
  })();
  const delegationPanel = renderDelegationSlot(scenario);

  if (!contextPanel && !delegationPanel) {
    return null;
  }

  return (
    <>
      {contextPanel}
      {delegationPanel}
    </>
  );
}

function renderPanelSlotFixture(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "clean":
    case "gemini-retry-status":
    case "gemini-blocked-warning":
    case "gemini-no-response-warning":
    case "subagents-composer-few":
    case "subagents-composer-many":
    case "subagents-queued-wake":
    case "subagent-wake-card":
      return null;
    case "todos-short":
      return <TodoTrackerPanel entries={TODOS_SHORT} />;
    case "todos-mid":
      return <TodoTrackerPanel entries={TODOS_MID} />;
    case "todos-long":
      return <TodoTrackerPanel entries={TODOS_LONG} />;
    case "execute-approval":
      return (
        <ApprovalCard
          title="git push origin main"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "edit-approval":
      return (
        <ApprovalCard
          title="Edit desktop/src/components/workspace/chat/input/ApprovalCard.tsx"
          actions={EDIT_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "gemini-mcp-approval-options":
    case "gemini-tool-before-approval":
      return (
        <ApprovalCard
          title="MCP: github.search_pull_requests"
          actions={GEMINI_MCP_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "claude-plan-short":
    case "claude-plan-long":
    case "pending-prompts-single":
    case "pending-prompts-multi":
    case "pending-prompts-editing":
      return null;
    case "pending-prompts-with-approval":
    case "subagents-queued-wake-with-approval":
    case "subagents-coding-review-with-approval":
      return (
        <ApprovalCard
          title="wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "workspace-arrival-created":
      return (
        <WorkspaceArrivalAttachedPanelView
          viewModel={WORKSPACE_ARRIVAL_CREATED}
          expanded
          onToggleExpanded={noop}
          onDismiss={noop}
          onSetupAction={noop}
        />
      );
    case "cloud-first-runtime":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_FIRST_RUNTIME}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-provisioning":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_PROVISIONING}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-applying-files":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_APPLYING_FILES}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-blocked":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_BLOCKED}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-error":
      return (
        <WorkspaceArrivalCloudPanel
          model={CLOUD_STATUS_ERROR}
          isPrimaryActionPending={false}
          onPrimaryAction={noop}
        />
      );
    case "cloud-reconnecting":
      return (
        <CloudRuntimeAttachedPanelView
          state={CLOUD_RUNTIME_RECONNECTING}
          retry={noop}
        />
      );
    case "cloud-reconnect-error":
      return (
        <CloudRuntimeAttachedPanelView
          state={CLOUD_RUNTIME_RECONNECT_ERROR}
          retry={noop}
        />
      );
    case "user-input-single-option":
      return (
        <UserInputCard
          key="user-input-single-option"
          title="Choose provider"
          questions={USER_INPUT_SINGLE_OPTION}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-single-freeform":
      return (
        <UserInputCard
          key="user-input-single-freeform"
          title="Name workspace"
          questions={USER_INPUT_SINGLE_FREEFORM}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-option-plus-other":
      return (
        <UserInputCard
          key="user-input-option-plus-other"
          title="Pick a strategy"
          questions={USER_INPUT_OPTION_PLUS_OTHER}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-secret":
      return (
        <UserInputCard
          key="user-input-secret"
          title="Provide secret"
          questions={USER_INPUT_SECRET}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "user-input-multi-question":
      return (
        <UserInputCard
          key="user-input-multi-question"
          title="Answer questions"
          questions={USER_INPUT_MULTI_QUESTION}
          onSubmit={noop}
          onCancel={noop}
        />
      );
    case "mcp-elicitation-boolean":
      return (
        <McpElicitationCard
          title="MCP confirmation"
          payload={MCP_ELICITATION_BOOLEAN}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-enum":
      return (
        <McpElicitationCard
          title="MCP review choice"
          payload={MCP_ELICITATION_ENUM}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-multi-select":
      return (
        <McpElicitationCard
          title="MCP calendar scope"
          payload={MCP_ELICITATION_MULTI_SELECT}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-mixed-required":
      return (
        <McpElicitationCard
          title="MCP publish metadata"
          payload={MCP_ELICITATION_MIXED_REQUIRED}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-url":
      return (
        <McpElicitationCard
          title="MCP URL request"
          payload={MCP_ELICITATION_URL}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-validation-error":
      return (
        <McpElicitationCard
          title="MCP validation preview"
          payload={MCP_ELICITATION_MIXED_REQUIRED}
          onAccept={async () => {
            throw new Error("Server validation failed: Review priority must be a safe integer.");
          }}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
    case "mcp-elicitation-cancel-decline":
      return (
        <McpElicitationCard
          title="MCP cancellation controls"
          payload={MCP_ELICITATION_URL}
          onAccept={noopAsync}
          onCancel={noopAsync}
          onDecline={noopAsync}
          onRevealUrl={revealExampleUrl}
        />
      );
  }
}

export function renderOutboundSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "pending-prompts-single":
    case "pending-prompts-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_SINGLE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_MULTI)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_PROMPTS_WITH_EDITING)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-feedback-ready":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_FEEDBACK_READY)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-review-complete":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PENDING_REVIEW_COMPLETE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "subagents-queued-wake":
    case "subagents-queued-wake-with-approval":
      return (
        <PendingPromptList
          entries={pendingQueueRows(PLAYGROUND_SUBAGENT_WAKE_QUEUE)}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    default:
      return null;
  }
}

function pendingQueueRows(entries: PendingPromptQueueEntry[]) {
  return entries.map(derivePendingPromptQueueRow);
}
