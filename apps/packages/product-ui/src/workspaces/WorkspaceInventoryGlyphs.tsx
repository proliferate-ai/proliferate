import type { CSSProperties } from "react";
import { twMerge } from "tailwind-merge";
import {
  Bot,
  Braces,
  CalendarClock,
  Cloud,
  HelpCircle,
  Monitor,
  Smartphone,
  UsersRound,
} from "lucide-react";

import type {
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "@proliferate/product-domain/workspaces/inventory";

const STATUS_GLYPH_CLASSES: Record<WorkspaceInventoryStatusKind, string> = {
  waiting: "text-muted-foreground",
  working: "text-muted-foreground",
  review: "text-success",
  blocked: "text-destructive",
  done: "text-muted-foreground",
};

const STATUS_GLYPH_STYLES: Partial<Record<WorkspaceInventoryStatusKind, CSSProperties>> = {};

export function SourceGlyph({
  source,
  label,
}: {
  source: WorkspaceInventorySourceKind;
  label: string;
}) {
  const iconClass = "size-3.5";
  const icon = (() => {
    switch (source) {
      case "desktop_exposed":
        return <Monitor className={iconClass} aria-hidden />;
      case "cloud_sandbox":
        return <Cloud className={iconClass} aria-hidden />;
      case "web":
        return <Smartphone className={iconClass} aria-hidden />;
      case "mobile":
        return <Smartphone className={iconClass} aria-hidden />;
      case "personal_automation":
        return <CalendarClock className={iconClass} aria-hidden />;
      case "team_automation":
        return <Bot className={iconClass} aria-hidden />;
      case "slack":
        return <UsersRound className={iconClass} aria-hidden />;
      case "api":
        return <Braces className={iconClass} aria-hidden />;
      case "unknown":
        return <HelpCircle className={iconClass} aria-hidden />;
    }
  })();
  return (
    <span
      title={label}
      aria-label={label}
      className="flex size-[18px] items-center justify-center text-muted-foreground"
    >
      {icon}
    </span>
  );
}

export function StatusGlyph({
  status,
  size = 14,
}: {
  status: WorkspaceInventoryStatusKind;
  size?: number;
}) {
  const cx = 7;
  const cy = 7;
  const style = STATUS_GLYPH_STYLES[status];
  const outer = (
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
  );

  if (status === "waiting") {
    return (
      <svg
        height={size}
        width={size}
        viewBox="0 0 14 14"
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
        style={style}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cy}
          r="6"
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
        className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
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
      className={twMerge("shrink-0", STATUS_GLYPH_CLASSES[status])}
      style={style}
      aria-hidden
    >
      {outer}
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
