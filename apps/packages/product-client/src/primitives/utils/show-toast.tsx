import { toast } from "#product/primitives/Sonner";
import {
  AnnouncementToastBody,
  StatusToastBody,
} from "#product/primitives/patterns/ToastBody";
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
 * Per-toast teardown, reachable by id. `showToast` closes over per-toast state
 * (the re-raise guard, the expansion), but `dismissToast` is a plain function
 * a caller can point at any id — this map is how it reaches that closure.
 * Same-id replacement overwrites the entry, which is the correct custody
 * transfer; the guard keeps a superseded closure from tearing down its heir.
 */
const liveToastTeardowns = new Map<string, () => void>();

function settleToast(id: string, teardown: () => void): void {
  if (liveToastTeardowns.get(id) === teardown) {
    liveToastTeardowns.delete(id);
  }
  collapseToastExpansion(id);
}

export function showToast(input: ToastInput): string {
  const id = input.id ?? nextToastId();
  const duration = resolveToastDuration(input);

  // `alive` gates the resize re-raise: a ResizeObserver also fires during the
  // exit animation, and re-raising a dismissed id would resurrect the toast.
  let alive = true;
  const teardown = () => {
    alive = false;
    settleToast(id, teardown);
  };
  liveToastTeardowns.set(id, teardown);

  // Quietly settle (swipe, auto-close, programmatic) versus the X, which also
  // reports the dismissal so a same-id caller can stop re-raising it.
  const dismissQuietly = () => {
    teardown();
    toast.dismiss(id);
  };
  const close = () => {
    teardown();
    toast.dismiss(id);
    input.onDismiss?.();
  };

  const common = {
    id,
    duration,
    onDismiss: () => {
      teardown();
      input.onDismiss?.();
    },
    onAutoClose: () => {
      teardown();
    },
    // The weights draw their own action clusters and close button, so sonner's
    // own buttons stay unused — leaving them undefined is what guarantees a
    // caller can't smuggle in a second button treatment.
    action: undefined,
    cancel: undefined,
  } as const;

  if (isStatusToast(input)) {
    return String(toast(<StatusToastBody input={input} onClose={close} />, common));
  }

  const inlinePayload = resolveInlinePayload(input);
  const navigateAction = resolveNavigateAction(input.details, dismissQuietly);
  const copyAction = resolveCopyAction(input);

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
        copyAction={copyAction}
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
 * that can hold a stack trace.
 */
function resolveInlinePayload(
  input: AnnouncementToastInput | DetailToastInput,
): string | undefined {
  if (input.details?.kind === "inline") {
    return input.details.payload;
  }
  if (input.weight === "detail" && readToastPayload(input.payload).blob) {
    return input.payload;
  }
  return undefined;
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
 */
function resolveCopyAction(
  input: AnnouncementToastInput | DetailToastInput,
): ToastAction | undefined {
  if (input.weight !== "detail") {
    return undefined;
  }
  const reading = readToastPayload(input.payload);
  if (reading.blob) {
    return undefined;
  }
  return {
    label: "Copy",
    onClick: () => {
      void navigator.clipboard?.writeText(input.payload);
    },
  };
}

/** Dismiss one toast by id, or every toast when no id is given. */
export function dismissToast(id?: string): void {
  if (id === undefined) {
    for (const teardown of [...liveToastTeardowns.values()]) {
      teardown();
    }
    toast.dismiss();
    return;
  }
  liveToastTeardowns.get(id)?.();
  toast.dismiss(id);
}
