import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Badge, type BadgeTone } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { POPOVER_FRAME_CLASS } from "#product/primitives/popover-surface";
import { twMerge } from "#product/primitives/utils/tw-merge";
import {
  readToastPayload,
  toastOverflowLabel,
} from "#product/primitives/utils/toast-payload";
import {
  collapseToastExpansion,
  readExpandedToastId,
  subscribeToastExpansion,
  toggleToastExpansion,
} from "#product/primitives/utils/toast-expansion-store";
import {
  ANNOUNCEMENT_DESCRIPTION_MAX_CHARS,
  STATUS_MESSAGE_MAX_CHARS,
  type AnnouncementToastInput,
  type DetailToastInput,
  type StatusToastInput,
  type ToastAction,
  type ToastTone,
} from "#product/primitives/utils/toast-model";

/**
 * The three toast weights, rendered — and the card itself.
 *
 * The body owns the whole surface: the sonner shell is a transparent
 * positioner (see `Sonner.tsx`), and the popover frame — the same panel
 * chrome popovers wear — is worn here. That inversion is what the details
 * transform requires: Details widens the card 356→480px while the payload
 * unfolds in place, and a width that animates per-toast, padding that differs
 * per weight, and an always-visible corner close are properties of the
 * message, not of a shell styled once for everyone.
 *
 * Severity still lives in a 6px dot (status) or the badge tone
 * (announcement/detail), so three stacked toasts read as three messages
 * rather than three warnings.
 */

const TOAST_CARD_CLASS = `${POPOVER_FRAME_CLASS} group-focus-visible/toast:ring-2 group-focus-visible/toast:ring-ring`;

/**
 * One easing for both halves of the transform — the width and the unfold move
 * as one surface or the seam shows. `motion-reduce` jump-cuts.
 */
const DETAILS_TRANSFORM_EASING =
  "duration-[350ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

/** Kit action recipe: 28px control, `text-ui` label, `radius-md`. */
const ACTION_SIZE_CLASS = "h-7 rounded-md px-2.5 text-ui";
/** Quiet secondary: faint fill plus a full-contrast label. */
const SECONDARY_ACTION_CLASS = `${ACTION_SIZE_CLASS} border border-input bg-surface-elevated-secondary font-medium text-foreground hover:bg-hover active:bg-active`;
/** Ghost-quiet: no chrome until hover. Copy details while expanded. */
const GHOST_ACTION_CLASS = `${ACTION_SIZE_CLASS} text-muted-foreground hover:bg-hover hover:text-foreground`;

const DOT_TONE_CLASS: Record<ToastTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  info: "bg-info",
  // Not `bg-warning`: that role is a pale surface tint, invisible as a 6px dot
  // on a light card. The tone's ink role is what the other four dots use.
  warning: "bg-warning-foreground",
  destructive: "bg-destructive",
};

const BADGE_TONE: Record<ToastTone, BadgeTone> = {
  neutral: "neutral",
  success: "success",
  info: "info",
  warning: "warning",
  destructive: "destructive",
};

function clampDescription(text: string): string {
  return text.length <= ANNOUNCEMENT_DESCRIPTION_MAX_CHARS
    ? text
    : `${text.slice(0, ANNOUNCEMENT_DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Severity, spoken. The dot itself stays `aria-hidden` — a coloured circle has
 * no text to read — but the announcement weights carry a Badge that names the
 * tone, and a status line carries nothing at all. So the word rides alongside
 * it, visually hidden, or "Couldn't save" and "Saved" reach a screen reader as
 * the same sentence with the only distinguishing signal being a colour.
 *
 * `neutral` is silent on purpose: it is the absence of severity, and prefixing
 * every ordinary status line with "Neutral" is noise, not information.
 */
const DOT_TONE_LABEL: Record<ToastTone, string | null> = {
  neutral: null,
  success: "Success",
  info: "Information",
  warning: "Warning",
  destructive: "Error",
};

function ToneDot({ tone }: { tone: ToastTone }) {
  const label = DOT_TONE_LABEL[tone];
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="toast-tone-dot"
        className={twMerge(
          "icon-status shrink-0 rounded-full",
          DOT_TONE_CLASS[tone],
        )}
      />
      {label ? <span className="sr-only">{label}: </span> : null}
    </>
  );
}

/**
 * The X owns dismissal: always visible, in the corner, 24×24. Reveal-on-hover
 * made dismissal a hunt, and `Dismiss` buttons in the action cluster made it
 * a decision — one corner control replaces both.
 */
function CloseButton({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label="Close"
      className={twMerge(
        "h-6 w-6 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-hover hover:text-foreground",
        className,
      )}
      onClick={onClose}
    >
      <X aria-hidden className="size-3.5" strokeWidth={1.5} />
    </Button>
  );
}

/**
 * status — one row. Truncates rather than growing a second line, and carries
 * the full string on `title` so nothing is lost to the ellipsis.
 */
export function StatusToastBody({
  input,
  onClose,
}: {
  input: StatusToastInput;
  onClose: () => void;
}) {
  const tone = input.tone ?? "neutral";
  const truncated = input.message.length > STATUS_MESSAGE_MAX_CHARS;

  return (
    <div
      className={twMerge(
        TOAST_CARD_CLASS,
        "flex w-[356px] items-center gap-2 py-2 pl-3 pr-2",
      )}
    >
      <ToneDot tone={tone} />
      <span
        className="min-w-0 flex-1 truncate whitespace-nowrap text-ui text-foreground"
        title={truncated ? input.message : undefined}
      >
        {input.message}
      </span>
      {input.code ? (
        <span className="shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground">
          {input.code}
        </span>
      ) : null}
      {input.action ? (
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="shrink-0 px-1 text-ui text-muted-foreground hover:text-foreground"
          onClick={input.action.onClick}
        >
          {input.action.label}
        </Button>
      ) : null}
      <CloseButton onClose={onClose} />
    </div>
  );
}

/** Mono excerpt: at most three countable lines, then "+N more". */
function ToastExcerpt({ payload }: { payload: string }) {
  const reading = readToastPayload(payload);
  if (reading.blob || reading.lines.length === 0) {
    return null;
  }
  const overflow = toastOverflowLabel(reading.overflow);

  return (
    <div
      data-testid="toast-excerpt"
      className="mt-2 rounded-md border border-border-light bg-surface-elevated-secondary px-2 py-1.5 font-mono text-ui-sm leading-5 text-muted-foreground"
    >
      {/* Keyed by index, not by content: an output log repeating an identical
          line is ordinary, and a duplicate key would warn and reconcile wrong. */}
      {reading.lines.map((line, index) => (
        <span key={index} className="block truncate" title={line}>
          {line}
        </span>
      ))}
      {overflow ? (
        <span className="block text-foreground/70">{overflow}</span>
      ) : null}
    </div>
  );
}

/**
 * announcement / detail — badge above a wrapping title, a description that
 * states the consequence, then the action cluster bottom-right. `detail` adds
 * the mono excerpt between description and actions for countable payloads.
 *
 * `inlinePayload` is what makes the toast expandable: Details is an in-place
 * transform, not a destination. The card widens 356→480px while the payload
 * unfolds as a full-bleed strip between text and actions — one continuous
 * surface, fully reversible (`Details` ↔ `Collapse`), exclusive across the
 * stack. Retry and the X collapse it on the way out.
 */
export function AnnouncementToastBody({
  input,
  toastId,
  inlinePayload,
  navigateAction,
  copyAction,
  onClose,
  onCardResize,
}: {
  input: AnnouncementToastInput | DetailToastInput;
  toastId: string;
  /** Raw payload behind Details; its presence makes the toast expandable. */
  inlinePayload?: string;
  navigateAction?: ToastAction;
  copyAction?: ToastAction;
  onClose: () => void;
  /**
   * Fired when the card's rendered size changes. Sonner measures a toast only
   * when its content element is replaced, so the expansion has to report its
   * own frames or the rest of the stack keeps stale offsets and overlaps.
   */
  onCardResize?: () => void;
}) {
  const tone = input.tone ?? "neutral";
  const payload = input.weight === "detail" ? input.payload : null;
  // A blob payload (prose, a stack trace) is structurally unrenderable as an
  // excerpt, so `ToastExcerpt` returns null for it. Without this the toast would
  // show a headline and nothing else. Its first sentence is the one part of a
  // blob that reads as a sentence, so it stands in as the description.
  const payloadReading = payload === null ? null : readToastPayload(payload);
  const description =
    input.description
    ?? (payloadReading?.blob ? payloadReading.firstSentence || undefined : undefined);
  const jump = input.weight === "detail" ? input.jump : undefined;

  const expandable = inlinePayload !== undefined;
  const expandedInStore = useSyncExternalStore(
    subscribeToastExpansion,
    () => readExpandedToastId() === toastId,
    () => false,
  );
  const expanded = expandable && expandedInStore;

  const reactId = useId();
  const titleId = `toast-title-${reactId}`;
  const detailsId = `toast-details-${reactId}`;

  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!onCardResize || !node || typeof ResizeObserver === "undefined") {
      return;
    }
    let initial = true;
    const observer = new ResizeObserver(() => {
      // The mount-time fire reports a size sonner has already measured.
      if (initial) {
        initial = false;
        return;
      }
      onCardResize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onCardResize]);

  // Which copy control just fired, so its label — and only its label — flips
  // to "Copied". The flip is the whole feedback for a click whose effect lands
  // in the clipboard, where nothing visible changes.
  const [copied, setCopied] = useState<"payload" | "details" | null>(null);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyResetRef.current), []);
  const markCopied = (control: "payload" | "details") => {
    setCopied(control);
    clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(null), 1_500);
  };
  const handleCopyDetails = () => {
    if (inlinePayload === undefined) {
      return;
    }
    void navigator.clipboard?.writeText(inlinePayload);
    markCopied("details");
  };

  const quiet = [jump, input.secondary, navigateAction].filter(
    (action): action is ToastAction => action !== undefined,
  );
  const commit = input.commit;

  return (
    <div
      ref={cardRef}
      data-toast-expanded={expandable ? expanded : undefined}
      className={twMerge(
        TOAST_CARD_CLASS,
        "w-[356px] p-3",
        expandable && `transition-[width] ${DETAILS_TRANSFORM_EASING}`,
        expanded && "w-[480px]",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {input.badge ? (
            <Badge tone={BADGE_TONE[tone]} className="mb-1.5">
              {input.badge}
            </Badge>
          ) : null}
          <div
            id={titleId}
            className="min-w-0 whitespace-normal break-words text-ui font-medium text-foreground [overflow-wrap:anywhere]"
            title={input.title}
          >
            {input.title}
          </div>
          {description ? (
            <div className="mt-0.5 min-w-0 whitespace-normal text-ui text-muted-foreground">
              {/* Two clamps, because the character count alone is a guess: at a
                  narrow width 140 characters can still wrap to three lines.
                  `line-clamp-2` is the guarantee; the character clamp keeps the
                  ellipsis near a word boundary.

                  The link sits OUTSIDE the clamped box on purpose. Inside it, a
                  long description would clamp away the only affordance the toast
                  offers, which is the one part of this block that must survive. */}
              <span className="line-clamp-2 block">
                {typeof description === "string" ? clampDescription(description) : description}
              </span>
              {input.link ? (
                <>
                  {" "}
                  <Button
                    type="button"
                    variant="unstyled"
                    size="unstyled"
                    className="text-ui text-foreground underline decoration-border-heavy underline-offset-2 hover:decoration-foreground"
                    onClick={input.link.onClick}
                  >
                    {input.link.label}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <CloseButton onClose={onClose} className="-mr-0.5 -mt-0.5" />
      </div>
      {payload ? <ToastExcerpt payload={payload} /> : null}
      {expandable ? (
        /* The unfold: `0fr → 1fr` is the one animatable path to auto height,
           and the payload stays mounted through both directions of it. While
           collapsed the strip is clipping away real content, so it is hidden
           from the accessibility tree, not just from pixels. */
        <div
          aria-hidden={expanded ? undefined : true}
          className={twMerge(
            `-mx-3 grid grid-rows-[0fr] transition-[grid-template-rows] ${DETAILS_TRANSFORM_EASING}`,
            expanded && "grid-rows-[1fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {/* Anti-jitter: the strip is laid out at the expanded card width
                from the first frame, so line wrapping never changes while the
                card widens — the clipping wrapper reveals it instead. */}
            <pre
              id={detailsId}
              role="region"
              aria-labelledby={titleId}
              tabIndex={expanded ? 0 : -1}
              className="m-0 mt-2.5 max-h-72 w-[480px] overflow-y-auto whitespace-pre-wrap break-words border-y border-border-light bg-surface-elevated-secondary px-3 py-2 font-mono text-ui-sm leading-[18px] text-muted-foreground"
            >
              {inlinePayload}
            </pre>
          </div>
        </div>
      ) : null}
      {copyAction || quiet.length > 0 || commit || expandable ? (
        <div className="mt-2.5 flex items-center justify-end gap-2">
          {expanded ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className={twMerge(GHOST_ACTION_CLASS, "mr-auto")}
              onClick={handleCopyDetails}
            >
              {copied === "details" ? "Copied" : "Copy details"}
            </Button>
          ) : null}
          {copyAction ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className={SECONDARY_ACTION_CLASS}
              onClick={() => {
                copyAction.onClick();
                markCopied("payload");
              }}
            >
              {copied === "payload" ? "Copied" : copyAction.label}
            </Button>
          ) : null}
          {quiet.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant="unstyled"
              size="unstyled"
              className={SECONDARY_ACTION_CLASS}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
          {expandable ? (
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className={SECONDARY_ACTION_CLASS}
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => toggleToastExpansion(toastId)}
            >
              {expanded ? "Collapse" : "Details"}
            </Button>
          ) : null}
          {commit ? (
            <Button
              type="button"
              variant="primary"
              size="unstyled"
              className={ACTION_SIZE_CLASS}
              onClick={() => {
                // Retry springs the card back: the state it explained is being
                // retried, so the explanation folds away with it.
                collapseToastExpansion(toastId);
                commit.onClick();
              }}
            >
              {commit.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
