import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";

interface ConnectGitHubPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description: ReactNode;
  actionLabel: ReactNode;
  onConnect?: () => void;
  loading?: boolean;
}

export function ConnectGitHubPanel({
  title,
  description,
  actionLabel,
  onConnect,
  loading = false,
  className = "",
  ...props
}: ConnectGitHubPanelProps) {
  return (
    <div
      className={twMerge("rounded-lg border border-border bg-card p-5 text-center", className)}
      {...props}
    >
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{description}</p>
      <Button className="mt-5 w-full" size="md" loading={loading} onClick={onConnect}>
        {actionLabel}
      </Button>
    </div>
  );
}
