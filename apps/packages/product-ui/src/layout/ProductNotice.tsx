import { type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

type ProductNoticeTone = "neutral" | "info" | "warning" | "destructive";

interface ProductNoticeProps {
  title?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  tone?: ProductNoticeTone;
  className?: string;
}

const toneClasses: Record<ProductNoticeTone, string> = {
  neutral: "border-border bg-card text-foreground",
  info: "border-info/40 bg-info/10 text-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  destructive: "border-destructive/40 bg-destructive/10 text-foreground",
};

export function ProductNotice({
  title,
  description,
  icon,
  tone = "neutral",
  className = "",
}: ProductNoticeProps) {
  return (
    <div className={twMerge("rounded-lg border p-4", toneClasses[tone], className)}>
      <div className="flex items-start gap-3">
        {icon ? <span className="mt-0.5 shrink-0 text-current">{icon}</span> : null}
        <div className="min-w-0">
          {title ? <div className="text-sm font-medium">{title}</div> : null}
          <p className={twMerge("text-sm leading-5 text-muted-foreground", title ? "mt-1" : "")}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
