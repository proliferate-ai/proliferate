import type { ReactNode } from "react";
import { ApprovalCard } from "#product/components/workspace/chat/input/ApprovalCard";
import { McpElicitationCard } from "#product/components/workspace/chat/input/McpElicitationCard";
import { UserInputCard } from "#product/components/workspace/chat/input/UserInputCard";
import { PlaygroundInteractionMotionFixture } from "#product/components/playground/composer-slots/PlaygroundInteractionMotionFixture";
import { CloudRuntimeAttachedPanelView } from "#product/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalCloudPanel } from "#product/components/workspace/chat/surface/WorkspaceArrivalCloudPanel";
import { WorkspaceCreationReceiptView } from "#product/components/workspace/chat/transcript/WorkspaceCreationReceipt";
import { presentWorkspaceCreationReceipt } from "#product/lib/domain/workspaces/creation/creation-receipt";
import type { ScenarioKey } from "#product/config/playground";
import {
  CLOUD_RUNTIME_RECONNECT_ERROR,
  CLOUD_RUNTIME_RECONNECTING,
  CLOUD_STATUS_APPLYING_FILES,
  CLOUD_STATUS_BLOCKED,
  CLOUD_STATUS_ERROR,
  CLOUD_STATUS_FIRST_RUNTIME,
  CLOUD_STATUS_PROVISIONING,
} from "#product/lib/domain/chat/__fixtures__/playground/panel-cloud-fixtures";
import {
  EDIT_OPTIONS,
  EXECUTE_OPTIONS,
  MCP_APPROVAL_OPTIONS,
  MCP_ELICITATION_BOOLEAN,
  MCP_ELICITATION_ENUM,
  MCP_ELICITATION_MIXED_REQUIRED,
  MCP_ELICITATION_MULTI_SELECT,
  MCP_ELICITATION_URL,
  USER_INPUT_MULTI_QUESTION,
  USER_INPUT_OPTION_PLUS_OTHER,
  USER_INPUT_SECRET,
  USER_INPUT_SINGLE_FREEFORM,
  USER_INPUT_SINGLE_OPTION,
} from "#product/lib/domain/chat/__fixtures__/playground/panel-interaction-fixtures";
import { noop, noopAsync, revealExampleUrl } from "#product/components/playground/PlaygroundComposerActions";

export function renderPanelSlotFixture(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "clean":
    case "grok-retry-status":
    case "grok-blocked-warning":
    case "grok-no-response-warning":
    case "subagents-composer-few":
    case "subagents-composer-many":
    case "subagents-queued-wake":
    case "subagent-wake-card":
      return null;
    // Auto-cycling pending→resolved loop for the dock-card mount/exit motion.
    case "interaction-motion":
      return <PlaygroundInteractionMotionFixture />;
    // Docked counterparts of the transcript pending-interaction markers
    // (PlaygroundStatusTranscript renders the marker rows for these keys).
    case "interaction-marker-permission":
      return (
        <ApprovalCard
          title="git push origin feature/interaction-markers"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "interaction-marker-question":
      return (
        <UserInputCard
          key="interaction-marker-question"
          title="Choose provider"
          questions={USER_INPUT_SINGLE_OPTION}
          onSubmit={noop}
          onCancel={noop}
        />
      );
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
          title="Edit apps/desktop/src/components/workspace/chat/input/ApprovalCard.tsx"
          actions={EDIT_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "opencode-mcp-approval-options":
    case "opencode-tool-before-approval":
      return (
        <ApprovalCard
          title="MCP: github.search_pull_requests"
          actions={MCP_APPROVAL_OPTIONS}
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
      return (
        <ApprovalCard
          title="wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1"
          actions={EXECUTE_OPTIONS}
          onSelectOption={noop}
          onAllow={noop}
          onDeny={noop}
        />
      );
    case "workspace-receipt-setup-succeeded":
      return (
        <WorkspaceCreationReceiptView
          presentation={presentWorkspaceCreationReceipt({
            phase: "created",
            noun: "worktree",
            workspacePath: "/Users/pablo/.proliferate/worktrees/proliferate/prism",
            materializedWorkspaceId: "workspace-receipt-setup-succeeded",
            setup: {
              command: "pnpm install",
              status: "succeeded",
              failureSummary: null,
              terminalId: null,
            },
          })}
          expanded={false}
          onToggleExpanded={noop}
        />
      );
    case "workspace-receipt-setup-failed":
      return (
        <WorkspaceCreationReceiptView
          presentation={presentWorkspaceCreationReceipt({
            phase: "created",
            noun: "worktree",
            workspacePath: "/Users/pablo/.proliferate/worktrees/proliferate/prism",
            materializedWorkspaceId: "workspace-receipt-setup-failed",
            setup: {
              command: "pnpm install",
              status: "failed",
              failureSummary: "Setup failed with exit code 1: pnpm ERR! ENOENT",
              terminalId: "terminal-playground",
            },
          })}
          expanded
          onToggleExpanded={noop}
          showSeeTerminal
          onSeeTerminal={noop}
          onRerun={noop}
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
    default:
      return null;
  }
}
