import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Badge } from "@proliferate/ui/primitives/Badge";

interface ConnectedProviderRowProps extends HTMLAttributes<HTMLDivElement> {
  provider: ReactNode;
  detail?: ReactNode;
  connected: boolean;
  action?: ReactNode;
}

export function ConnectedProviderRow({
  provider,
  detail,
  connected,
  action,
  className = "",
  ...props
}: ConnectedProviderRowProps) {
  return (
    <div className={twMerge("flex items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0", className)} {...props}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{provider}</div>
        {detail && <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
      <Badge tone={connected ? "success" : "neutral"}>{connected ? "Connected" : "Not connected"}</Badge>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
