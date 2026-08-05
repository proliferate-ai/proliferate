import { ChevronDown } from "#product/primitives/icons/core";
import { Spinner } from "#product/primitives/Spinner";
import { Button } from "#product/primitives/Button";

export function TranscriptScrollToBottomButton({
  visible,
  bottomInsetPx,
  onClick,
}: {
  visible: boolean;
  bottomInsetPx: number;
  onClick: () => void;
}) {
  // UX_SPEC §6: 32px circle, --background fill, 1px --border, muted arrow,
  // 150ms opacity fade, floating above the composer.
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
      style={{ bottom: bottomInsetPx + 12 }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Scroll to bottom"
        aria-hidden={!visible}
        tabIndex={visible ? 0 : -1}
        data-chat-transcript-ignore
        onClick={onClick}
        className={`size-8 rounded-full border border-border bg-background text-muted-foreground shadow-none transition-opacity duration-hover ease-in-out hover:bg-background hover:text-foreground ${
          visible
            ? "pointer-events-auto opacity-100"
            : "opacity-0"
        }`}
      >
        <ChevronDown className="icon-control" />
      </Button>
    </div>
  );
}

/**
 * The transcript's floating overlay controls, as one call site.
 *
 * Both row lists (full and virtualized) mount the identical set above their
 * rows, so the glue lives here instead of being duplicated per list. A new
 * floating control is added here once, not twice.
 *
 * Every control floated here must be pressable. A permanently-`disabled`
 * affordance still reads as a promise the transcript does not keep, so
 * behavior lands with the visuals or the visuals wait.
 */
export function TranscriptFloatingControls({
  bottomInsetPx,
  isPinnedToBottom,
  onScrollToBottomClick,
}: {
  bottomInsetPx: number;
  isPinnedToBottom: boolean;
  onScrollToBottomClick: () => void;
}) {
  return (
    <TranscriptScrollToBottomButton
      visible={!isPinnedToBottom}
      bottomInsetPx={bottomInsetPx}
      onClick={onScrollToBottomClick}
    />
  );
}

export function TranscriptHistoryLoadingRow() {
  return (
    <div className="flex justify-center pb-3 text-muted-foreground" role="status">
      <Spinner className="icon-control" />
      <span className="sr-only">Loading earlier messages</span>
    </div>
  );
}
