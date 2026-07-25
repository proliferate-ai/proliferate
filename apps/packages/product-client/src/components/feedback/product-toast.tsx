import { toast } from "@proliferate/ui/kit/Sonner";

export type ProductToastKind = "error" | "info";

/**
 * The single ad-hoc toast presentation. Every non-update toast in the product
 * funnels through here (via useToastStore for the ~190 legacy call sites, or
 * directly), rendering the message in the same kit Sonner container the update
 * lifecycle toasts use — so there is one toast look, not three.
 *
 * `kind` is accepted for call-site/API compatibility but intentionally does
 * NOT drive a separate visual: almost every legacy call site omits the type
 * and inherits the store's default, so a type-styled badge would mislabel
 * neutral messages. Errors read as errors from their own copy.
 */
export function showProductToast(
  message: string,
  _kind: ProductToastKind = "info",
  options?: { description?: string; duration?: number },
) {
  toast(message, {
    description: options?.description,
    duration: options?.duration ?? 5000,
  });
}
