import { toast } from "../primitives/Sonner";
import {
  AnnouncementToastBody,
  StatusToastBody,
} from "../patterns/ToastBody";
import { openToastDetails } from "./toast-details-store";
import { readToastPayload } from "./toast-payload";
import {
  isStatusToast,
  resolveToastDuration,
  toErrorAnnouncement,
  type AnnouncementToastInput,
  type DetailToastInput,
  type ToastAction,
  type ToastDetails,
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
 * Each weight renders into sonner's title slot as one element, because the
 * three anatomies are genuinely different: a status row is not a title with an
 * empty description underneath it. Riding the title slot (rather than
 * `toast.custom`) keeps sonner's own frame, close button, swipe-to-dismiss and
 * stacking, so the kit only supplies the inside.
 */
export function showToast(input: ToastInput): string {
  const duration = resolveToastDuration(input);
  const common = {
    id: input.id,
    duration,
    closeButton: true,
    onDismiss: input.onDismiss,
    // The weights draw their own action clusters, so sonner's own
    // action/cancel buttons stay unused — leaving them undefined is what
    // guarantees a caller can't smuggle in a second button treatment.
    action: undefined,
    cancel: undefined,
  } as const;

  if (isStatusToast(input)) {
    return String(toast(<StatusToastBody input={input} />, common));
  }

  const detailsAction = resolveDetailsAction(input.details, input.id);
  const copyAction = resolveCopyAction(input);
  return String(
    toast(
      <AnnouncementToastBody
        input={input}
        detailsAction={detailsAction}
        copyAction={copyAction}
      />,
      common,
    ),
  );
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
 * Details resolves to exactly one of three destinations. `none` produces no
 * button at all — an empty modal is worse than no modal — and `navigate`
 * dismisses the toast on the way out, because the toast was only ever a
 * pointer to the surface that owns the error, not a copy of it.
 */
function resolveDetailsAction(
  details: ToastDetails | undefined,
  id: string | undefined,
): ToastAction | undefined {
  if (!details || details.kind === "none") {
    return undefined;
  }
  if (details.kind === "navigate") {
    return {
      label: details.label ?? "Details",
      onClick: () => {
        details.onNavigate();
        if (id !== undefined) {
          toast.dismiss(id);
        }
      },
    };
  }
  return {
    label: "Details",
    onClick: () => {
      openToastDetails({
        title: details.title,
        subtitle: details.subtitle,
        payload: details.payload,
      });
    },
  };
}

/**
 * `detail` toasts get Copy, and Copy carries the *whole* payload even when the
 * inline excerpt was capped at three lines — that is the point of the cap. A
 * payload that failed the excerpt test has no inline excerpt to complement, so
 * its full text belongs to the details modal instead.
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
  toast.dismiss(id);
}
