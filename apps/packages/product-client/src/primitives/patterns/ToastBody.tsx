import { Badge, type BadgeTone } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { twMerge } from "#product/primitives/utils/tw-merge";
import {
  readToastPayload,
  toastOverflowLabel,
} from "#product/primitives/utils/toast-payload";
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
 * The three toast weights, rendered.
 *
 * All three share one surface: the kit `Toaster`'s popover frame, never a
 * tinted one. Severity lives in a 6px dot (status) or the badge tone
 * (announcement/detail), so three stacked toasts read as three messages
 * rather than three warnings.
 */

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

/** Quiet secondary: faint fill plus a full-contrast label. */
const SECONDARY_ACTION_CLASS =
  "h-6 rounded-md border border-input bg-surface-elevated-secondary px-2 text-ui-sm font-medium text-foreground hover:bg-hover active:bg-active";
const COMMIT_ACTION_CLASS =
  "h-6 rounded-md px-2 text-ui-sm font-medium";

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
 * status — one row. Truncates rather than growing a second line, and carries
 * the full string on `title` so nothing is lost to the ellipsis.
 */
export function StatusToastBody({
  input,
}: {
  input: StatusToastInput;
}) {
  const tone = input.tone ?? "neutral";
  const truncated = input.message.length > STATUS_MESSAGE_MAX_CHARS;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <ToneDot tone={tone} />
      <span
        className="min-w-0 flex-1 truncate whitespace-nowrap text-ui-sm text-foreground"
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
          variant="ghost"
          size="unstyled"
          className="shrink-0 px-1 text-ui-sm text-muted-foreground hover:text-foreground"
          onClick={input.action.onClick}
        >
          {input.action.label}
        </Button>
      ) : null}
    </span>
  );
}

/**
 * Actions cluster bottom-right, quiet first and the single committing action
 * last. Only `commit` carries a fill — a toast never shows two equally loud
 * buttons, so navigation and Copy stay quiet even when they are the only
 * actions present.
 */
function ActionCluster({
  quiet,
  commit,
}: {
  quiet: ToastAction[];
  commit?: ToastAction;
}) {
  if (quiet.length === 0 && !commit) {
    return null;
  }
  return (
    <span className="mt-2.5 flex items-center justify-end gap-2">
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
      {commit ? (
        <Button
          type="button"
          variant="primary"
          size="unstyled"
          className={COMMIT_ACTION_CLASS}
          onClick={commit.onClick}
        >
          {commit.label}
        </Button>
      ) : null}
    </span>
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
    <span
      data-testid="toast-excerpt"
      className="mt-2 block rounded-md border border-border/60 bg-surface-elevated-secondary px-2 py-1.5 font-mono text-ui-sm leading-5 text-muted-foreground"
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
    </span>
  );
}

/**
 * announcement / detail — badge above a wrapping title, a description that
 * states the consequence, then the action cluster bottom-right. `detail` adds
 * the mono excerpt between description and actions.
 */
export function AnnouncementToastBody({
  input,
  detailsAction,
  copyAction,
}: {
  input: AnnouncementToastInput | DetailToastInput;
  detailsAction?: ToastAction;
  copyAction?: ToastAction;
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

  return (
    <span className="flex min-w-0 flex-1 flex-col items-stretch">
      {input.badge ? (
        <Badge tone={BADGE_TONE[tone]} className="mb-1.5 self-start">
          {input.badge}
        </Badge>
      ) : null}
      <span
        className="min-w-0 whitespace-normal break-words text-ui-sm font-medium text-foreground [overflow-wrap:anywhere]"
        title={input.title}
      >
        {input.title}
      </span>
      {description ? (
        <span className="mt-0.5 block min-w-0 whitespace-normal text-ui-sm leading-5 text-muted-foreground">
          {/* Two clamps, because the character count alone is a guess: at a
              narrow width 140 characters can still wrap to three lines, and the
              frame's max-height would then clip the third mid-word rather than
              ellipsising it. `line-clamp-2` is the guarantee; the character
              clamp keeps the ellipsis near a word boundary.

              The link sits OUTSIDE the clamped box on purpose. Inside it, a long
              description would clamp away the only affordance the toast offers,
              which is the one part of this block that must survive. */}
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
                className="text-ui-sm text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                onClick={input.link.onClick}
              >
                {input.link.label}
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
      {payload ? <ToastExcerpt payload={payload} /> : null}
      <ActionCluster
        quiet={[detailsAction, copyAction, jump, input.secondary].filter(
          (action): action is ToastAction => action !== undefined,
        )}
        commit={input.commit}
      />
    </span>
  );
}
