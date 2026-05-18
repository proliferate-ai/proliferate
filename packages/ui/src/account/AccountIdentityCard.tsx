import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface AccountIdentityCardProps extends HTMLAttributes<HTMLDivElement> {
  name: ReactNode;
  email?: ReactNode;
  avatar?: ReactNode;
  status?: ReactNode;
}

export function AccountIdentityCard({
  name,
  email,
  avatar,
  status,
  className = "",
  ...props
}: AccountIdentityCardProps) {
  return (
    <div className={twMerge("flex items-center gap-3 rounded-lg border border-border bg-card p-4", className)} {...props}>
      {avatar && <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent">{avatar}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{name}</div>
        {email && <div className="mt-0.5 truncate text-xs text-muted-foreground">{email}</div>}
      </div>
      {status && <div className="shrink-0">{status}</div>}
    </div>
  );
}
