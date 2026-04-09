import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface HomeActionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function HomeActionCard({
  title,
  description,
  icon,
  onClick,
  disabled = false,
  loading = false,
}: HomeActionCardProps) {
  return (
    <Button
      variant="ghost"
      size="md"
      onClick={onClick}
      disabled={disabled || loading}
      loading={loading}
      title={description}
      className="!h-32 !w-full !cursor-pointer !flex-col !items-stretch !justify-between !gap-0 rounded-lg border border-border bg-secondary p-4 text-left text-secondary-foreground shadow-none transition-colors hover:bg-secondary/80 hover:text-secondary-foreground"
    >
      <div className="flex w-full justify-start text-secondary-foreground">
        <div className="flex size-4 items-center justify-center">
          {icon}
        </div>
      </div>
      <div className="flex w-full items-end">
        <p className="text-sm font-normal text-secondary-foreground">
          {title}
        </p>
      </div>
    </Button>
  );
}
