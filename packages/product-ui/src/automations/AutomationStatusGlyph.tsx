import { type CSSProperties } from "react";
import { twMerge } from "tailwind-merge";
import type { AutomationInventoryStatusKind } from "@proliferate/product-model/automations/inventory";

const STATUS_GLYPH_CLASSES: Record<AutomationInventoryStatusKind, string> = {
  waiting: "text-muted-foreground",
  working: "",
  review: "text-success",
  blocked: "text-destructive",
  done: "text-muted-foreground",
};

const STATUS_GLYPH_STYLES: Partial<Record<AutomationInventoryStatusKind, CSSProperties>> = {
  working: {
    color: "var(--color-status-in-progress, var(--color-warning))",
  },
};

export function AutomationStatusGlyph({
  status,
  size = 14,
  className = "",
}: {
  status: AutomationInventoryStatusKind;
  size?: number;
  className?: string;
}) {
  const cx = 7;
  const cy = 7;
  const style = STATUS_GLYPH_STYLES[status];

  if (status === "waiting") {
    return (
      <svg
        height={size}
        width={size}
        viewBox="0 0 14 14"
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status], className)}
        style={style}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cy}
          r="5.25"
          fill="none"
          stroke="currentColor"
          strokeDasharray="2 2"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (status === "done") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status], className)}
        style={style}
        aria-hidden
      >
        <circle cx={cx} cy={cy} r="5.25" fill="currentColor" opacity="0.74" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status], className)}
      style={style}
      aria-hidden
    >
      <circle
        cx={cx}
        cy={cy}
        r="6"
        fill="none"
        stroke="currentColor"
        strokeDasharray="3.14 0"
        strokeDashoffset="-0.7"
        strokeWidth="1.5"
      />
      {status === "working" && (
        <circle
          cx={cx}
          cy={cy}
          r="2"
          fill="none"
          stroke="currentColor"
          strokeDasharray="12.189379495928398 24.378758991856795"
          strokeDashoffset="6.094689747964199"
          strokeWidth="4"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {status === "review" && (
        <circle
          cx={cx}
          cy={cy}
          r="2"
          fill="none"
          stroke="currentColor"
          strokeDasharray="18.2840692438926 18.2840692438926"
          strokeDashoffset="2.8"
          strokeWidth="4"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      {status === "blocked" && (
        <line
          x1="4.2"
          y1="7"
          x2="9.8"
          y2="7"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      )}
    </svg>
  );
}
