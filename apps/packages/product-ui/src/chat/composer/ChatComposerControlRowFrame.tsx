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
  // UX_SPEC §5: 28px-tall control row, gap 8px between control clusters.
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2">
      <div className="flex min-w-0 items-center gap-1">
        {leading}
      </div>
      <div className="min-w-0" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-1">
        {trailing}
        {action}
      </div>
    </div>
  );
}
