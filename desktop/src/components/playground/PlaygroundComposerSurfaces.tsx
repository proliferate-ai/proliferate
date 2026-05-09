import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ArrowRight, ArrowUp } from "@/components/ui/icons";
import { ChatComposerSurface } from "@/components/workspace/chat/input/ChatComposerSurface";
import { ComposerFileMentionBadge } from "@/components/workspace/chat/input/ComposerFileMentionBadge";
import { ComposerFileMentionSearch } from "@/components/workspace/chat/input/ComposerFileMentionSearch";
import { ComposerTextarea } from "@/components/workspace/chat/input/ComposerTextarea";
import { ComposerTextareaFrame } from "@/components/workspace/chat/input/ComposerTextareaFrame";
import {
  CHAT_COMPOSER_INPUT_LINE_HEIGHT_REM,
  WORKSPACE_CHAT_COMPOSER_INPUT,
} from "@/config/chat";
import type { ScenarioKey } from "@/config/playground";
import { useComposerTextareaAutosize } from "@/hooks/chat/ui/use-composer-textarea-autosize";
import type { PlaygroundReplayState } from "@/hooks/playground/use-replay-session";
import {
  FILE_MENTION_SEARCH_RESULTS,
  PLAYGROUND_LONG_COMPOSER_DRAFT,
} from "@/lib/domain/chat/__fixtures__/playground/composer-surface-fixtures";
import { noop } from "@/components/playground/PlaygroundComposerActions";

export function renderComposerSurfaceForScenario(scenario: ScenarioKey): ReactNode {
  switch (scenario) {
    case "composer-long-input":
      return <PlaygroundLongInputComposerSurface />;
    case "file-mention-search":
      return <PlaygroundFileMentionComposerSurface />;
    default:
      return <PlaygroundComposerSurface />;
  }
}

export function PlaygroundComposerSurface() {
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

function PlaygroundFileMentionComposerSurface() {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <>
      <div className="relative z-20 flex flex-col px-5">
        <ComposerFileMentionSearch
          query="chat"
          results={FILE_MENTION_SEARCH_RESULTS}
          highlightedIndex={0}
          isLoading={false}
          errorMessage={null}
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
            <span>
              Update{" "}
              <ComposerFileMentionBadge
                name="ChatInput.tsx"
                path="desktop/src/components/workspace/chat/input/ChatInput.tsx"
                onRemove={noop}
              />
              {" "}and @chat
            </span>
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
    </>
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
