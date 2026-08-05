import { showToast, toastError } from "#product/primitives/utils/show-toast";
import {
  STATUS_MESSAGE_MAX_CHARS,
  type ToastErrorInput,
} from "#product/primitives/utils/toast-model";

export type ProductToastKind = "error" | "info";

/**
 * The single ad-hoc toast presentation. Every non-update toast in the product
 * funnels through here (via useToastStore for the ~190 legacy call sites, or
 * directly).
 *
 * These call sites are the reason `status` is the default weight: almost all of
 * them pass one short sentence about something that just happened, which is
 * exactly a status line. So the legacy signature maps onto the kit's default
 * rather than getting a compatibility shim — `kind` becomes the tone of the
 * dot, and the dot is the only thing severity is allowed to change.
 *
 * A caller that passes a `description` has, by definition, more than one line
 * to say, so it is promoted to an `announcement` instead of being crushed into
 * a truncated status line. Same for a message too long to fit on one line: the
 * weight follows the content, and neither case needs the call site to know
 * about weights at all.
 */
export function showProductToast(
  message: string,
  kind: ProductToastKind = "info",
  options?: { description?: string; duration?: number },
) {
  const tone = kind === "error" ? "destructive" : "neutral";
  const description = options?.description;

  if (description || message.length > STATUS_MESSAGE_MAX_CHARS) {
    showToast({
      weight: "announcement",
      tone,
      title: message,
      description,
      duration: options?.duration,
    });
    return;
  }

  showToast({ message, tone, duration: options?.duration });
}

/**
 * The product's entry point for a failed action.
 *
 * Separate from `showProductToast` rather than another `kind` on it, because
 * the argument is a different shape and that is the whole point: the string
 * form is what let `Failed to X: ${error}` exist. Anything that wants to report
 * an exception has to come through here and hand the exception over as `cause`,
 * where the kit keeps it out of the body.
 */
export function showProductErrorToast(input: ToastErrorInput) {
  toastError(input);
}
