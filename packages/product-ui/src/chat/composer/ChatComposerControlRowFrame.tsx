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
  return (
    <div className="mb-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px] px-2">
      <div className="flex min-w-0 items-center gap-[5px]">
        {leading}
      </div>
      <div className="min-w-0" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-[5px]">
        {trailing}
        {action}
      </div>
    </div>
  );
}
