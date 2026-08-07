import { Toaster } from "#product/primitives/Sonner";

/**
 * The single toast mount: the kit `Toaster`, and nothing else.
 *
 * There used to be a details modal here; Details is an in-place transform of
 * the toast now (see `ToastBody.tsx`), so no second surface needs a mount.
 * Note what is deliberately absent: no notification centre, no toast history.
 * An error that matters after its toast is gone belongs to a surface.
 */
export function ToastHost() {
  return <Toaster />;
}
