import type { ReactNode } from "react";

export function ChatComposerControlRowFrame({
  leading,
  trailing,
  action,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  action: ReactNode;
}) {
  // UX_SPEC §5: 28px-tall control row. [CHAT-02] (D-V2-4) RULED: composer
  // control gaps are 8px — that applies to the gaps BETWEEN controls inside
  // each cluster too, not only to the outer grid, so the inner clusters move
  // off 4px. CloudChatComposerControlStrip carries the same 8px so both
  // composer control rows read identically.
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
      </div>
      <div className="min-w-0" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-2">
        {trailing}
        {action}
      </div>
    </div>
  );
}
