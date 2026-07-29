import { Badge, type BadgeTone } from "../primitives/Badge";
import { Button } from "../primitives/Button";
import { twMerge } from "../utils/tw-merge";
import {
  readToastPayload,
  toastOverflowLabel,
} from "../utils/toast-payload";
import {
  ANNOUNCEMENT_DESCRIPTION_MAX_CHARS,
  STATUS_MESSAGE_MAX_CHARS,
  type AnnouncementToastInput,
  type DetailToastInput,
  type StatusToastInput,
  type ToastAction,
  type ToastTone,
} from "../utils/toast-model";

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

function ToneDot({ tone }: { tone: ToastTone }) {
  return (
    <span
      aria-hidden="true"
      data-testid="toast-tone-dot"
      className={twMerge(
        "icon-status shrink-0 rounded-full",
        DOT_TONE_CLASS[tone],
      )}
    />
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
      {reading.lines.map((line) => (
        <span key={line} className="block truncate" title={line}>
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
      {input.description ? (
        <span className="mt-0.5 block min-w-0 whitespace-normal text-ui-sm leading-5 text-muted-foreground">
          {typeof input.description === "string"
            ? clampDescription(input.description)
            : input.description}
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
