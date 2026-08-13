import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

export function McpElicitationInlineError({ message }: { message: string }) {
  // px-3 py-2 rather than the banner's default p-3: this is a one-line error
  // tucked under a form field, not a standalone block, and the tighter vertical
  // padding is layout at the call site.
  return (
    <NoticeBanner tone="destructive" className="px-3 py-2 text-ui-sm">
      {message}
    </NoticeBanner>
  );
}
