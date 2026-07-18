import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { ArrowRight } from "@proliferate/ui/icons";
import { ChatComposerSurface } from "@proliferate/product-ui/chat/composer/ChatComposerSurface";
import { ChatInputControlRow } from "#product/components/workspace/chat/input/ChatInputControlRow";
import { ComposerSlashCommandSearch } from "#product/components/workspace/chat/input/ComposerSlashCommandSearch";
import { ComposerTextarea } from "@proliferate/ui/primitives/ComposerTextarea";
import { ComposerTextareaFrame } from "@proliferate/ui/primitives/ComposerTextareaFrame";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "#product/config/chat";
import type { ScenarioKey } from "#product/config/playground";
import { useComposerTextareaAutosize } from "#product/hooks/chat/ui/use-composer-textarea-autosize";
import type { PlaygroundReplayState } from "#product/hooks/playground/lifecycle/use-replay-session";
import {
  createPlaygroundModelSelectorProps,
  createPlaygroundSessionConfigControls,
  createPlaygroundUltraSessionConfigControls,
  PLAYGROUND_LONG_COMPOSER_DRAFT,
  PLAYGROUND_SLASH_COMMANDS,
} from "#product/lib/domain/chat/__fixtures__/playground/composer-surface-fixtures";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";
import { noop } from "#product/components/playground/PlaygroundComposerActions";
import { WorkspaceStatusComposerControl } from "#product/components/workspace/chat/input/workspace-status/WorkspaceStatusComposerControl";
import { createPlaygroundWorkspaceStatusModel } from "#product/lib/domain/chat/__fixtures__/playground/workspace-status-fixtures";
import { RuntimePressureDetailsDialog } from "#product/components/workspace/chat/input/RuntimePressureDetailsDialog";
import {
  createPlaygroundEnvironmentAdvancedControls,
  createPlaygroundEnvironmentTargetState,
} from "#product/lib/domain/chat/__fixtures__/playground/environment-fixtures";

export function renderComposerSurfaceForScenario(scenario: ScenarioKey): ReactNode {
  switch (scenario) {
    case "composer-long-input":
      return <PlaygroundLongInputComposerSurface />;
    case "composer-ultra":
      return <PlaygroundComposerSurface ultra />;
    case "workspace-status-card":
      return <PlaygroundComposerSurface statusControl={<PlaygroundWorkspaceStatusControl />} />;
    case "status-live-stream":
      return <PlaygroundComposerSurface interactive />;
    case "slash-command-search":
      return <PlaygroundSlashCommandComposerSurface commands={PLAYGROUND_SLASH_COMMANDS} />;
    case "slash-command-empty":
      return <PlaygroundSlashCommandComposerSurface commands={[]} />;
    default:
      return <PlaygroundComposerSurface />;
  }
}

export function PlaygroundComposerSurface({
  ultra = false,
  interactive = false,
  statusControl,
}: {
  ultra?: boolean;
  interactive?: boolean;
  statusControl?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  return (
    <ChatComposerSurface>
      <form className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            data-chat-composer-editor
            variant="ghost"
            rows={2}
            value={draft}
            onChange={interactive ? (event) => setDraft(event.target.value) : undefined}
            placeholder={interactive ? "Type while the response renders" : "Playground composer (read-only)"}
            spellCheck={false}
            readOnly={!interactive}
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <PlaygroundComposerControlRow ultra={ultra} statusControl={statusControl} />
      </form>
    </ChatComposerSurface>
  );
}

function PlaygroundLongInputComposerSurface() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useComposerTextareaAutosize({
    textareaRef,
    value: PLAYGROUND_LONG_COMPOSER_DRAFT,
    lineHeightRem: CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
    minRows: WORKSPACE_CHAT_COMPOSER_INPUT.minRows,
    maxRows: WORKSPACE_CHAT_COMPOSER_INPUT.maxRows,
    minHeightRem: WORKSPACE_CHAT_COMPOSER_INPUT.minHeightRem,
  });

  return (
    <ChatComposerSurface overflowMode="clip">
      <form className="relative flex flex-col">
        <ComposerTextareaFrame topInset="standard">
          <ComposerTextarea
            data-chat-composer-editor
            data-telemetry-mask
            ref={textareaRef}
            rows={WORKSPACE_CHAT_COMPOSER_INPUT.minRows}
            value={PLAYGROUND_LONG_COMPOSER_DRAFT}
            placeholder="Playground long composer"
            spellCheck={false}
            readOnly
          />
        </ComposerTextareaFrame>
        <PlaygroundComposerControlRow />
      </form>
    </ChatComposerSurface>
  );
}

function PlaygroundSlashCommandComposerSurface({
  commands,
}: {
  commands: SessionSlashCommandViewModel[];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <>
      <div className="relative z-20 flex flex-col px-5">
        <ComposerSlashCommandSearch
          commands={commands}
          highlightedIndex={0}
          listRef={listRef}
          onSelect={noop}
          onRowMouseEnter={noop}
          setRowRef={(index, element) => {
            rowRefs.current[index] = element;
          }}
          className="mx-0"
        />
      </div>
      <ChatComposerSurface>
        <form className="relative flex flex-col">
          <div
            data-telemetry-mask
            className="mb-2 flex min-h-14 flex-grow select-text items-start px-5 text-base leading-relaxed text-foreground"
          >
            <span>/rev</span>
          </div>
          <PlaygroundComposerControlRow />
        </form>
      </ChatComposerSurface>
    </>
  );
}

/**
 * Makes the fixture descriptors interactive: selections land in local state
 * instead of the fixtures' no-op onSelect, so control affordances that react
 * to stepping (reasoning level swap, fast-mode toggle) can be exercised in
 * the playground.
 */
/** Workspace-status scenario: the full card — fixture status model, fixture
 * runtime resources (Resources row opens the worktrees modal), and
 * interactive advanced controls absorbed from the old overflow menu. */
function PlaygroundWorkspaceStatusControl() {
  const baseControls = useMemo(createPlaygroundEnvironmentAdvancedControls, []);
  const advancedControls = usePlaygroundLiveControls(baseControls);
  const targetState = useMemo(createPlaygroundEnvironmentTargetState, []);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  return (
    <>
      <WorkspaceStatusComposerControl
        model={createPlaygroundWorkspaceStatusModel()}
        actions={{
          onOpenChanges: noop,
          onCommitOrPush: noop,
          onCompareBranch: noop,
          onViewChecks: noop,
          onOpenAgentSession: noop,
        }}
        environmentState={targetState}
        onOpenWorktrees={() => setWorktreesOpen(true)}
        advancedControls={advancedControls}
        agentKind="codex"
      />
      <RuntimePressureDetailsDialog
        open={worktreesOpen}
        targetState={targetState}
        actions={{ pruneOrphan: noop, purgeWorkspace: noop }}
        onClose={() => setWorktreesOpen(false)}
      />
    </>
  );
}

function usePlaygroundLiveControls(controls: LiveSessionControlDescriptor[]) {
  const [selectedByKey, setSelectedByKey] = useState<Record<string, string>>({});
  return controls.map((control) => {
    const selectedValue = selectedByKey[control.key];
    const options = selectedValue === undefined
      ? control.options
      : control.options.map((option) => ({
        ...option,
        selected: option.value === selectedValue,
      }));
    return {
      ...control,
      options,
      isEnabled: control.kind === "toggle" && selectedValue !== undefined
        ? selectedValue === control.enabledValue
        : control.isEnabled,
      onSelect: (value: string) =>
        setSelectedByKey((state) => ({ ...state, [control.key]: value })),
    };
  });
}

function PlaygroundComposerControlRow({
  ultra = false,
  statusControl,
}: {
  ultra?: boolean;
  statusControl?: ReactNode;
}) {
  const baseControls = useMemo(
    () => (ultra
      ? createPlaygroundUltraSessionConfigControls()
      : createPlaygroundSessionConfigControls()),
    [ultra],
  );
  const sessionConfigControls = usePlaygroundLiveControls(baseControls);

  return (
    <ChatInputControlRow
      runtimeControlsDisabled={false}
      modelSelectorProps={createPlaygroundModelSelectorProps()}
      agentKind="codex"
      statusControl={statusControl}
      sessionConfigControls={sessionConfigControls}
      isEditingQueuedPrompt={false}
      chatDisabled={false}
      isSubmitting={false}
      supportsAttachments
      canAttachFiles
      activeSessionId="playground-session"
      onAttachFile={noop}
      isRunning={false}
      isEmpty
      onSubmit={noop}
      onCancel={noop}
    />
  );
}

export function ReplayComposerSurface({ replay }: { replay: PlaygroundReplayState }) {
  const statusText = replay.hasPendingInteraction
    ? "Waiting for interaction"
    : replay.isBusy
      ? "Playing"
      : replay.canAdvance
        ? "Paused"
        : replay.isCreatingSession
          ? "Loading"
          : "Ready";

  return (
    <ChatComposerSurface>
      <div className="relative flex flex-col">
        <div
          className="mb-2 flex-grow select-text overflow-y-auto px-5 pt-3.5"
          style={{ minHeight: "3.5rem" }}
        >
          <Textarea
            variant="ghost"
            rows={2}
            value=""
            placeholder={statusText}
            spellCheck={false}
            readOnly
            className="min-h-0 px-0 py-0 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="px-2 text-xs text-muted-foreground">{statusText}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!replay.canAdvance}
            loading={replay.isAdvancing}
            onClick={() => {
              void replay.advance();
            }}
          >
            <ArrowRight className="size-3.5" />
            Next turn
          </Button>
        </div>
      </div>
    </ChatComposerSurface>
  );
}
