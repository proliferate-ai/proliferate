import type { ReactNode } from "react";

/**
 * The toast contract, as types.
 *
 * A toast is a headline plus at most two lines; anything longer is a pointer
 * to where the real content lives. There are exactly three weights, chosen by
 * how much the message needs — not by severity. A red one-liner is fine and a
 * neutral announcement is fine.
 *
 * The union below is deliberately closed. There is no escape hatch that takes
 * arbitrary children, because every historical toast-as-panel started as one.
 * The negative rules — needs a decision → dialog, belongs to a field the user
 * is looking at → inline error, persistent condition → an in-page notice — are
 * enforced by the absence of an API for them.
 */

/** Severity, carried by a 6px dot or a badge — never by a tinted surface. */
export type ToastTone = "neutral" | "success" | "info" | "warning" | "destructive";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/**
 * Where `Details` goes. Exactly three destinations exist and a fourth cannot
 * be expressed:
 *
 * - `navigate` — the error has a home (a run, a session, a form field). The
 *   toast is a pointer to it, not a copy: following the link dismisses it.
 * - `modal` — no home. A compact details modal is the terminus: read it, copy
 *   it, close it. It carries no Retry, because retrying belongs to the toast
 *   where the action was.
 * - `none` — nothing worth reading. No Details button at all; an empty modal
 *   is worse than no modal.
 */
export type ToastDetails =
  | { kind: "navigate"; label?: string; onNavigate: () => void }
  | { kind: "modal"; title: string; subtitle?: string; payload: string }
  | { kind: "none" };

interface ToastCommon {
  /** Reusing an id replaces the live toast instead of stacking a second one. */
  id?: string;
  tone?: ToastTone;
  /**
   * Shorten the default dwell. Only shortening is possible in practice: the
   * persistence rule below still forces Infinity for anything carrying an error
   * or an action, so this cannot be used to auto-close a decision.
   */
  duration?: number;
  /**
   * Fired when the user closes the toast. Needed because a same-id toast that
   * re-renders on a tick would otherwise resurface something the user just
   * dismissed: the caller records the dismissal and stops re-raising it.
   */
  onDismiss?: () => void;
}

/**
 * One line, never wraps. The default for `toast("…")` with no options: an
 * outcome the user already expected. A second line means it was the wrong
 * weight, so the message truncates and carries the full string on `title`.
 */
export interface StatusToastInput extends ToastCommon {
  weight?: "status";
  message: string;
  /** Short mono suffix — a code, a count. Not a payload. */
  code?: string;
  action?: ToastAction;
}

/**
 * Headline plus at most two lines: the default for something a person has to
 * understand. The description states the consequence — what did and did not
 * happen. Solid fill is reserved for the single committing action.
 */
export interface AnnouncementToastInput extends ToastCommon {
  weight: "announcement";
  /** Domain eyebrow (UPDATE, WORKFLOWS, RUN…). Tone carries the severity. */
  badge?: string;
  title: string;
  description?: ReactNode;
  /** Inline text link after the description (what's new, docs). */
  link?: ToastAction;
  /** The one committing action. Solid. */
  commit?: ToastAction;
  /** Quiet secondary action, left of the commit. */
  secondary?: ToastAction;
  details?: ToastDetails;
  /** An error persists until dismissed and never auto-closes. */
  isError?: boolean;
}

/**
 * An announcement plus a mono excerpt, for payloads. The headline counts the
 * problems; the excerpt shows at most three countable items and a fourth
 * becomes "+N more". Free-form prose and stack traces never reach the excerpt
 * — `readToastPayload` refuses them and the first sentence goes in the
 * description instead.
 */
export interface DetailToastInput extends Omit<AnnouncementToastInput, "weight"> {
  weight: "detail";
  /** Raw payload. Rendered inline only if it passes the excerpt test. */
  payload: string;
  /** Jump to the surface that owns the payload. */
  jump?: ToastAction;
}

export type ToastInput =
  | StatusToastInput
  | AnnouncementToastInput
  | DetailToastInput;

/**
 * A failed action, as fields instead of a sentence.
 *
 * Every toast of this class used to be written as one string —
 * `Failed to send queued message next: ${errorMessage(error)}` — which is a
 * human headline concatenated with an exception. That string has no good
 * length: narrow clips it mid-word, wide clips it later, and wrapping prints
 * the exception to the user. No width fixes concatenation, so the concatenation
 * is what goes away.
 *
 * Splitting it into fields makes the failure mode unexpressible rather than
 * discouraged: `headline` is the outcome a person reads, `cause` is the raw
 * text a person reports, and there is no field where the two can meet.
 */
export interface ToastErrorInput {
  /** Reusing an id replaces the live toast instead of stacking a second one. */
  id?: string;
  onDismiss?: () => void;
  /**
   * The outcome in human words, at most one line ("Message not sent"). A plain
   * string literal at every call site — never interpolated, which is what the
   * `toast-copy` guard enforces, because interpolation is how exception text
   * reached headlines in the first place.
   */
  headline: string;
  /**
   * What did and did not happen ("Your message is still in the composer,
   * unsent"). The reason a person can stop worrying, or knows to act.
   */
  consequence?: string;
  /**
   * The raw exception, response body, or payload. NEVER rendered in the toast
   * body — it reaches the user only through Details, where a scrolling `pre`
   * and a Copy button can actually hold it.
   */
  cause?: string;
  /**
   * Re-run the action that failed. When present the toast offers Retry as its
   * one committing action; a retry is the only thing in an error toast that
   * commits anything, so it is the only thing that gets a fill.
   */
  retry?: () => void;
  /**
   * Override where Details goes. Defaults to the compact details modal when
   * there is a `cause` and to no button at all when there is not; pass
   * `navigate` when the error has a home worth opening instead.
   */
  details?: ToastDetails;
  /**
   * A quiet way out that is not a retry — docs for the thing that has to change
   * before the action could work at all. Separate from `retry` because it
   * commits nothing, and separate from `details` because `details` is where the
   * exception lives: an error can need both the raw text and a page to read.
   */
  link?: ToastAction;
}

/**
 * Project an error into the `announcement` weight.
 *
 * An error from something the user just did always needs a decision — retry,
 * read the cause, or accept it — so it is an announcement every time and never
 * a status line that scrolls away after four seconds with the decision unmade.
 *
 * Kept pure and separate from the raise so the classification is testable
 * without a DOM: what an error toast becomes is a fact about the input.
 */
export function toErrorAnnouncement(input: ToastErrorInput): AnnouncementToastInput {
  return {
    weight: "announcement",
    tone: "destructive",
    isError: true,
    id: input.id,
    onDismiss: input.onDismiss,
    title: input.headline,
    description: input.consequence,
    link: input.link,
    details: resolveErrorDetails(input),
    commit: input.retry ? { label: "Retry", onClick: input.retry } : undefined,
  };
}

/**
 * `cause` is the only thing that earns a Details button. Without one there is
 * nothing behind the button, and an empty modal is worse than no modal.
 */
function resolveErrorDetails(input: ToastErrorInput): ToastDetails {
  if (input.details) {
    return input.details;
  }
  const cause = input.cause?.trim();
  if (cause) {
    return { kind: "modal", title: input.headline, payload: cause };
  }
  return { kind: "none" };
}

/** status: an expected outcome, gone in 4 seconds. */
export const STATUS_TOAST_DURATION_MS = 4_000;
/** announcement: long enough to read two lines. */
export const ANNOUNCEMENT_TOAST_DURATION_MS = 8_000;

/** A status line is one line: past this it is an announcement. */
export const STATUS_MESSAGE_MAX_CHARS = 60;
/** Two lines of description, ~70 characters each. */
export const ANNOUNCEMENT_DESCRIPTION_MAX_CHARS = 140;

/**
 * `status` is the default weight, so it is the one input whose discriminant may
 * be omitted — `toast("…")` with no options is a status line. This predicate is
 * the single place that reads the absent-means-status rule.
 */
export function isStatusToast(input: ToastInput): input is StatusToastInput {
  return input.weight === undefined || input.weight === "status";
}

/**
 * Anything carrying an error or an action stays until dismissed — an
 * auto-dismissing toast that asked for a decision loses the decision.
 */
export function resolveToastDuration(input: ToastInput): number {
  if (isStatusToast(input)) {
    if (input.action) {
      return Number.POSITIVE_INFINITY;
    }
    return input.duration ?? STATUS_TOAST_DURATION_MS;
  }
  const hasAction =
    input.commit !== undefined
    || input.secondary !== undefined
    || (input.weight === "detail" && input.jump !== undefined)
    || (input.details !== undefined && input.details.kind !== "none");
  if (input.isError || hasAction) {
    return Number.POSITIVE_INFINITY;
  }
  return input.duration ?? ANNOUNCEMENT_TOAST_DURATION_MS;
}
