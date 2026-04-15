import { type ReactNode } from "react";
import { ApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ChatComposerDock } from "@/components/workspace/chat/input/ChatComposerDock";
import { ComposerControlButton } from "@/components/workspace/chat/input/ComposerControlButton";
import { ChatComposerSurface } from "@/components/workspace/chat/input/ChatComposerSurface";
import { PendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { UserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { McpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { WorkspaceMobilityLocationPopover } from "@/components/workspace/chat/input/WorkspaceMobilityLocationPopover";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { type MobilityPromptState } from "@/lib/domain/workspaces/mobility-prompt";
import {
  ArrowUp,
  BrailleSweepBadge,
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  GitBranch,
} from "@/components/ui/icons";
import type { ScenarioKey } from "@/config/playground";
import {
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
  TODOS_LONG,
  TODOS_MID,
  TODOS_SHORT,
  USER_INPUT_MULTI_QUESTION,
  USER_INPUT_OPTION_PLUS_OTHER,
  USER_INPUT_SECRET,
  USER_INPUT_SINGLE_FREEFORM,
  USER_INPUT_SINGLE_OPTION,
} from "@/lib/domain/chat/__fixtures__/playground";

interface PlaygroundComposerProps {
  scenario: ScenarioKey;
}

const noop = () => {};
const noopAsync = async () => {};
const revealExampleUrl = async () => "https://accounts.example.com/oauth/authorize?client_id=redacted";

export function PlaygroundComposer({ scenario }: PlaygroundComposerProps) {
  const topSlot = renderTopSlot(scenario);
  return (
    <div className="relative">
      <ChatComposerDock
        topSlot={topSlot ?? undefined}
        footerSlot={<PlaygroundMobilityFooterRow scenario={scenario} />}
      >
        <PlaygroundComposerSurface />
      </ChatComposerDock>
      {scenario === "mobility-in-flight" && <MobilityOverlayPreview />}
    </div>
  );
}

function renderTopSlot(scenario: ScenarioKey): ReactNode | null {
  switch (scenario) {
    case "clean":
    case "gemini-retry-status":
    case "gemini-blocked-warning":
    case "gemini-no-response-warning":
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
      return null;
    case "pending-prompts-single":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_SINGLE}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-multi":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_MULTI}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-editing":
      return (
        <PendingPromptList
          entries={PENDING_PROMPTS_WITH_EDITING}
          onBeginEdit={noop}
          onDelete={noop}
        />
      );
    case "pending-prompts-with-approval":
      return (
        <>
          <div className="mx-8 flex flex-col">
            <ApprovalCard
              title="wc -l /Users/pablo/proliferate/server/proliferate/**/*.py | tail -1"
              actions={EXECUTE_OPTIONS}
              onSelectOption={noop}
              onAllow={noop}
              onDeny={noop}
            />
          </div>
          <PendingPromptList
            entries={PENDING_PROMPTS_SINGLE}
            onBeginEdit={noop}
            onDelete={noop}
          />
        </>
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

function PlaygroundComposerSurface() {
  return (
    <ChatComposerSurface>
      <form className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            placeholder="Playground composer (read-only)"
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pb-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            disabled
            aria-label="Send (playground — disabled)"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </form>
    </ChatComposerSurface>
  );
}

function PlaygroundMobilityFooterRow({ scenario }: { scenario: ScenarioKey }) {
  const prompt = mobilityPromptForScenario(scenario);
  const locationLabel = scenario === "mobility-in-flight"
    ? "Cloud workspace"
    : "Local worktree";

  return (
    <div className="relative rounded-[var(--radius-composer)] border border-border bg-card px-2 py-2 shadow-xs">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        <ComposerControlButton
          icon={(scenario === "mobility-in-flight" ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />)}
          label={locationLabel}
          active={Boolean(prompt) || scenario === "mobility-in-flight"}
          trailing={<ChevronDown className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={<Folder className="size-3.5" />}
          label="/Users/pablo/proliferate"
          labelClassName="[direction:rtl]"
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
        <ComposerControlButton
          icon={<GitBranch className="size-3.5" />}
          label="feature/workspace-mobility"
          trailing={<Copy className="size-3 text-muted-foreground/70" />}
          disabled
        />
      </div>
      {prompt && (
        <div className="absolute bottom-full left-2 z-10 mb-2">
          <WorkspaceMobilityLocationPopover
            prompt={prompt}
            onClose={noop}
            onPrimaryAction={noop}
          />
        </div>
      )}
    </div>
  );
}

function MobilityOverlayPreview() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/66 backdrop-blur-[2px]">
      <div className="pointer-events-none absolute inset-0 grid grid-cols-4 gap-x-8 gap-y-10 px-8 py-10">
        {Array.from({ length: 24 }, (_, index) => (
          <span
            key={index}
            className={`font-mono text-2xl leading-none tracking-[-0.18em] ${
              index % 2 === 0 ? "text-foreground/14" : "text-foreground/10"
            }`}
          >
            {index % 3 === 0 ? "⣿⣿" : "⣶⣤"}
          </span>
        ))}
      </div>
      <div className="relative z-10 flex max-w-lg flex-col items-center px-6 text-center">
        <span className="font-mono text-7xl leading-none tracking-[-0.22em] text-foreground">
          ⣿⣿
        </span>
        <p className="mt-6 text-xs uppercase tracking-[0.12em] text-muted-foreground/80">
          Cloud workspace
        </p>
        <h2 className="mt-3 text-2xl font-medium tracking-tight text-foreground">
          Finalizing workspace move
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Switching this workspace to its new runtime.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground/6 px-3 py-1.5 text-sm text-muted-foreground">
          <BrailleSweepBadge className="text-base text-foreground" />
          <span>Syncing files and supported sessions</span>
        </div>
      </div>
    </div>
  );
}

function mobilityPromptForScenario(
  scenario: ScenarioKey,
): MobilityPromptState | null {
  switch (scenario) {
    case "mobility-local-actionable":
      return {
        variant: "actionable",
        direction: "local_to_cloud",
        headline: "You're working in a local worktree.",
        body: "You can move this workspace to the cloud.",
        helper: null,
        actionLabel: "Move to cloud",
        secondaryActionLabel: null,
        warning: "Active terminals will stay here.",
        blocker: null,
        primaryActionKind: "confirm_move",
      };
    case "mobility-local-blocked":
    case "mobility-unpublished-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "This branch isn't on GitHub yet.",
        helper: "Publish `feature/workspace-mobility` before moving to cloud.",
        actionLabel: "Publish branch",
        secondaryActionLabel: null,
        warning: "Uncommitted changes will move with the workspace after this branch is synced.",
        blocker: null,
        primaryActionKind: "publish_branch",
      };
    case "mobility-unpushed-commits":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "Your latest commit isn't on GitHub yet.",
        helper: "Push `feature/workspace-mobility` before moving to cloud.",
        actionLabel: "Push commits",
        secondaryActionLabel: null,
        warning: "Uncommitted changes will move with the workspace after this branch is synced.",
        blocker: null,
        primaryActionKind: "push_commits",
      };
    case "mobility-out-of-sync-branch":
      return {
        variant: "blocked",
        direction: "local_to_cloud",
        headline: "Can't move this workspace to cloud yet",
        body: "This branch is out of sync with GitHub.",
        helper: "Pull or rebase locally, then try again.",
        actionLabel: null,
        secondaryActionLabel: null,
        warning: null,
        blocker: null,
        primaryActionKind: null,
      };
    case "mobility-failed":
      return {
        variant: "terminal_failure",
        direction: "local_to_cloud",
        headline: "Workspace move failed",
        body: "The workspace stayed on its current runtime.",
        helper: "Try the move again when you're ready.",
        actionLabel: "Try again",
        secondaryActionLabel: null,
        warning: null,
        blocker: null,
        primaryActionKind: "retry_prepare",
      };
    default:
      return null;
  }
}
