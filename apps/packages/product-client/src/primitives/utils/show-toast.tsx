import { toast } from "#product/primitives/Sonner";
import {
  AnnouncementToastBody,
  StatusToastBody,
} from "#product/primitives/patterns/toast/ToastBody";
import { collapseToastExpansion } from "./toast-expansion-store";
import { readToastPayload } from "./toast-payload";
import {
  isStatusToast,
  resolveToastDuration,
  toErrorAnnouncement,
  type AnnouncementToastInput,
  type DetailToastInput,
  type ToastAction,
  type ToastErrorInput,
  type ToastInput,
} from "./toast-model";

/**
 * The single way to raise a toast.
 *
 * Callers pick a weight; they never hand-author layout, so no one flow ends up
 * with a treatment nothing else inherits. Duration, the persistence rule for
 * errors and actions, the 3-visible cap, and same-id replacement are owned
 * here and by the kit `Toaster` — not restated per call site.
 *
 * Each weight renders into sonner's title slot as one element — the card
 * included, since the shell is a transparent positioner (see `Sonner.tsx`).
 * Riding the title slot (rather than `toast.custom`) keeps sonner's own
 * anchoring, swipe-to-dismiss and stacking, so the kit supplies everything
 * visible and sonner supplies only where it sits.
 *
 * Every toast gets an id up front — sonner would mint one, but the X, the
 * details expansion, and dismissal bookkeeping all need to name the toast
 * before sonner has seen it.
 */

let raisedToastCount = 0;
function nextToastId(): string {
  raisedToastCount += 1;
  return `toast-kit-${raisedToastCount}`;
}

/**
 * Per-toast custody, reachable by id. `showToast` closes over per-toast state
 * (the re-raise guard, the report-once flag, the expansion), but `dismissToast`
 * is a plain function a caller can point at any id — this map is how it
 * reaches those closures. Same-id replacement retires the superseded closure
 * (no re-raise, no report) without touching the expansion, which transfers to
 * the heir.
 */
interface LiveToastHandle {
  /** Silence this closure: no re-raise, no dismissal report. */
  retire: () => void;
  /** Retire and release the id's bookkeeping, without touching sonner. */
  settle: () => void;
  /** Programmatic dismissal — quiet by definition. */
  dismissQuietly: () => void;
}

const liveToasts = new Map<string, LiveToastHandle>();

export function showToast(input: ToastInput): string {
  const id = input.id ?? nextToastId();
  const duration = resolveToastDuration(input);

  // `alive` gates the resize re-raise: a ResizeObserver also fires during the
  // exit animation, and re-raising a dismissed id would resurrect the toast.
  // `report` makes `onDismiss` a user-dismissal signal that fires at most
  // once: sonner forwards *every* `toast.dismiss(id)` into its `onDismiss`
  // callback — programmatic ones included — so each programmatic path retires
  // the closure first and the report survives only for swipe and the X.
  let alive = true;
  let report = true;
  // Whether THIS instance asked sonner to dismiss (the X or a programmatic
  // path). Sonner delivers `toast.dismiss(id)` on a requestAnimationFrame, so
  // a dismissal aimed at a predecessor can land a frame late — on a brand-new
  // same-id toast — as a delete-effect nobody here requested. That replay must
  // not settle (or report for) the new instance.
  let dismissRequested = false;
  // Set per-branch below; re-raises this toast's element after a stale replay
  // deleted it out from under us.
  let rerender: () => void = () => {};
  const retire = () => {
    alive = false;
    report = false;
  };
  const settle = () => {
    retire();
    if (liveToasts.get(id) === handle) {
      liveToasts.delete(id);
      collapseToastExpansion(id);
    }
  };

  // Same-id replacement: the predecessor may neither report nor re-raise, but
  // its expansion state is the heir's to keep.
  liveToasts.get(id)?.retire();
  const handle: LiveToastHandle = {
    retire,
    settle: () => settle(),
    dismissQuietly: () => {
      dismissRequested = true;
      settle();
      toast.dismiss(id);
    },
  };
  liveToasts.set(id, handle);
  const dismissQuietly = handle.dismissQuietly;

  // The X. The report itself happens in `onDismiss` below when sonner's
  // dismissal flow lands there — going through that single gate (rather than
  // reporting here *and* letting sonner's forward report again) is what keeps
  // it to exactly once.
  const close = () => {
    alive = false;
    dismissRequested = true;
    toast.dismiss(id);
  };

  const common = {
    id,
    duration,
    onDismiss: (dismissed?: { delete?: boolean }) => {
      // A delete-effect dismissal this instance never asked for is a stale
      // replay: a predecessor's `toast.dismiss(id)` arriving a frame late.
      // (A user swipe also arrives unrequested, but reaches this callback
      // before sonner marks the toast deleted, so `delete` distinguishes.)
      if (!dismissRequested && dismissed?.delete === true) {
        if (alive) {
          rerender();
        }
        return;
      }
      const shouldReport = report;
      settle();
      if (shouldReport) {
        input.onDismiss?.();
      }
    },
    onAutoClose: () => {
      settle();
    },
    // The weights draw their own action clusters and close button, so sonner's
    // own buttons stay unused — leaving them undefined is what guarantees a
    // caller can't smuggle in a second button treatment.
    action: undefined,
    cancel: undefined,
    // Sonner's Observer merges `{...oldToast, ...data}` on same-id replacement,
    // and a dismissed predecessor leaves `delete: true` in the merged object.
    // That stale flag triggers sonner's delete-effect on the next re-render
    // (e.g., the Collapse click), firing the NEW toast's onDismiss → settle.
    // Explicitly setting `delete: false` here overrides the stale flag.
    delete: false,
  } as const;

  if (isStatusToast(input)) {
    const raiseStatus = () =>
      toast(<StatusToastBody input={input} onClose={close} />, common);
    rerender = () => {
      raiseStatus();
    };
    return String(raiseStatus());
  }

  const inlinePayload = resolveInlinePayload(input);
  const navigateAction = resolveNavigateAction(input.details, dismissQuietly);
  const copyPayload = resolveCopyPayload(input);

  // Sonner re-measures a toast's height only when the title element is
  // replaced, so the details transform re-raises a fresh element for every
  // frame the card's size changes (see `onCardResize`). React reconciles the
  // same component in the same slot, so body state survives the churn.
  const raise = (): string | number =>
    toast(
      <AnnouncementToastBody
        input={input}
        toastId={id}
        inlinePayload={inlinePayload}
        navigateAction={navigateAction}
        copyPayload={copyPayload}
        onClose={close}
        onCardResize={inlinePayload === undefined ? undefined : remeasure}
      />,
      common,
    );
  const remeasure = () => {
    if (alive) {
      raise();
    }
  };
  rerender = () => {
    raise();
  };

  return String(raise());
}

/**
 * The way to report a failed action.
 *
 * A thin projection onto `showToast`, and deliberately thin: the value is in
 * the *shape* of the argument, not in anything this function does. A caller
 * with `{ headline, cause }` cannot accidentally print the cause, and a caller
 * with a `retry` cannot accidentally auto-dismiss the offer to use it.
 */
export function toastError(input: ToastErrorInput): string {
  return showToast(toErrorAnnouncement(input));
}

/**
 * What the Details transform unfolds, or undefined for a toast that cannot
 * expand. An explicit `inline` details wins; beyond that, a `detail` weight
 * whose payload failed the excerpt test has a payload the collapsed card
 * cannot show at all, so Details is derived — the strip is the only surface
 * that can hold a stack trace. The derivation applies only when the caller
 * said nothing: an explicit `navigate` already has a Details-shaped button
 * (two would collide), and an explicit `none` is a decision to respect. An
 * all-whitespace payload cannot expand either — a strip with nothing in it is
 * a broken-looking animation, not details.
 */
function resolveInlinePayload(
  input: AnnouncementToastInput | DetailToastInput,
): string | undefined {
  const payload =
    input.details?.kind === "inline"
      ? input.details.payload
      : input.details === undefined
          && input.weight === "detail"
          && readToastPayload(input.payload).blob
        ? input.payload
        : undefined;
  return payload !== undefined && payload.trim().length > 0 ? payload : undefined;
}

/**
 * `navigate` is the one Details destination that leaves the toast: the error
 * has a home, the toast was only ever a pointer to it, and following the
 * pointer dismisses it. `none` produces no button at all. `inline` is not an
 * action — the body renders the Details ↔ Collapse toggle itself, because the
 * toggle carries expansion state.
 */
function resolveNavigateAction(
  details: (AnnouncementToastInput | DetailToastInput)["details"],
  dismissQuietly: () => void,
): ToastAction | undefined {
  if (details?.kind !== "navigate") {
    return undefined;
  }
  return {
    label: details.label ?? "Details",
    onClick: () => {
      details.onNavigate();
      dismissQuietly();
    },
  };
}

/**
 * `detail` toasts get Copy, and Copy carries the *whole* payload even when the
 * inline excerpt was capped at three lines — that is the point of the cap. A
 * payload that failed the excerpt test has no inline excerpt to complement, so
 * its full text belongs to the details strip and its own Copy details instead.
 *
 * The body owns the clipboard write itself: the "Copied" receipt has to wait
 * for the write to resolve, so handing over the text — not a fired-and-
 * forgotten onClick — is what makes an honest receipt possible.
 */
function resolveCopyPayload(
  input: AnnouncementToastInput | DetailToastInput,
): string | undefined {
  if (input.weight !== "detail") {
    return undefined;
  }
  return readToastPayload(input.payload).blob ? undefined : input.payload;
}

/**
 * Dismiss one toast by id, or every toast when no id is given.
 *
 * Quiet on purpose: `onDismiss` means *the user* closed the toast, and this
 * function is how code closes one — a presenter leaving its error phase, a
 * flow superseding its own message. Letting it report would turn "the state
 * you were being told about no longer exists" into "the user walked away",
 * which for an update-failed toast is the difference between cleaning up and
 * cancelling the retry that was just pressed.
 */
export function dismissToast(id?: string): void {
  if (id === undefined) {
    for (const handle of [...liveToasts.values()]) {
      handle.dismissQuietly();
    }
    // Toasts raised outside `showToast` (none today) still fall to sonner.
    toast.dismiss();
    return;
  }
  const handle = liveToasts.get(id);
  if (handle) {
    handle.dismissQuietly();
  } else {
    toast.dismiss(id);
  }
}
