import { useEffect, useRef } from "react";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import type { SelectedResponsePendingAnnotation } from "#product/components/workspace/chat/transcript/SelectedResponseActionMenu";
import { useSelectedResponseActions } from "#product/hooks/chat/workflows/use-selected-response-actions";

export function ConnectedSelectedResponseAnnotationComposer({
  annotation,
  onDone,
}: {
  annotation: SelectedResponsePendingAnnotation;
  onDone: () => void;
}) {
  const actions = useSelectedResponseActions();
  return (
    <SelectedResponseAnnotationComposer
      annotation={annotation}
      onSettle={(comment, options) => {
        if (comment.trim()) {
          actions.setAnnotationComment(annotation.id, comment);
        }
        // Focus is handed to the composer only for keyboard exits. A blur
        // already moved focus where the user wanted it — often the start of
        // the NEXT selection drag, which a focus steal would wipe out.
        if (options.focusComposer) {
          actions.focusComposer();
        }
        onDone();
      }}
    />
  );
}

export function SelectedResponseAnnotationComposer({
  annotation,
  onSettle,
}: {
  annotation: SelectedResponsePendingAnnotation;
  onSettle: (comment: string, options: { focusComposer: boolean }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Enter, Escape, blur, and scroll can race on the way out (settling
  // unmounts the input, which fires its blur); the first outcome wins.
  const settledRef = useRef(false);
  const settle = (comment: string, options: { focusComposer: boolean }) => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    onSettle(comment, options);
  };
  const settleOnScrollRef = useRef(() => {
    settle(inputRef.current?.value ?? "", { focusComposer: false });
  });

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    // The anchor rect goes stale the moment the transcript scrolls, matching
    // the selection menu's scroll dismissal.
    const handleScroll = () => settleOnScrollRef.current();
    window.addEventListener("scroll", handleScroll, { capture: true });
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, []);

  const anchorRect = annotation.anchorRect;

  return (
    <div
      // Runtime-calculated position from the annotated selection rect — the
      // same sanctioned inline-style case (and the same fixed-position
      // containing-block caveat) as the selection menu's anchor.
      style={{
        position: "fixed",
        top: anchorRect.top - 8,
        left: anchorRect.left + anchorRect.width / 2,
        transform: "translate(-50%, -100%)",
      }}
      className="z-50 flex items-center gap-2 rounded-full bg-popover py-1.5 pl-2 pr-3 shadow-popover ring-[0.5px] ring-border"
      data-telemetry-mask
    >
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-special text-ui-sm tabular-nums text-special-foreground"
      >
        {annotation.ordinal}
      </span>
      <input
        ref={inputRef}
        type="text"
        aria-label={CHAT_SELECTED_RESPONSE_ACTIONS.annotationCommentLabel}
        placeholder={CHAT_SELECTED_RESPONSE_ACTIONS.annotationCommentPlaceholder}
        className="w-64 bg-transparent text-ui-sm text-foreground outline-none placeholder:text-muted-foreground"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            settle(event.currentTarget.value, { focusComposer: true });
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            settle("", { focusComposer: true });
          }
        }}
        onBlur={(event) => settle(event.currentTarget.value, { focusComposer: false })}
      />
    </div>
  );
}
