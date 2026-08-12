import type { CSSProperties } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { CircleQuestion } from "#product/primitives/icons/core";
import {
  CalendarClock,
  CloudIcon,
  Monitor,
  Smartphone,
  UsersRound,
} from "#product/primitives/icons/platform";
import { Robot } from "#product/primitives/icons/product";
import { Braces } from "#product/primitives/icons/workspace";

import type {
  WorkspaceInventorySourceKind,
  WorkspaceInventoryStatusKind,
} from "#product/domain/workspaces/inventory";

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
  const iconClass = "icon-paired text-ui";
  const icon = (() => {
    switch (source) {
      case "desktop_exposed":
        return <Monitor className={iconClass} aria-hidden />;
      case "cloud_sandbox":
        return <CloudIcon className={iconClass} aria-hidden />;
      case "web":
        return <Smartphone className={iconClass} aria-hidden />;
      case "mobile":
        return <Smartphone className={iconClass} aria-hidden />;
      case "personal_automation":
        return <CalendarClock className={iconClass} aria-hidden />;
      case "team_automation":
        return <Robot className={iconClass} aria-hidden />;
      case "slack":
        return <UsersRound className={iconClass} aria-hidden />;
      case "api":
        return <Braces className={iconClass} aria-hidden />;
      case "unknown":
        return <CircleQuestion className={iconClass} aria-hidden />;
    }
  })();
  return (
    <span
      title={label}
      aria-label={label}
      className="flex size-5 items-center justify-center text-ui text-muted-foreground [&_svg]:icon-paired"
    >
      {icon}
    </span>
  );
}

export function StatusGlyph({
  status,
  className,
}: {
  status: WorkspaceInventoryStatusKind;
  className?: string;
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
        viewBox="0 0 14 14"
        className={twMerge(
          "icon-paired shrink-0 text-ui",
          STATUS_GLYPH_CLASSES[status],
          className,
        )}
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
        viewBox="0 0 14 14"
        className={twMerge(
          "icon-paired shrink-0 text-ui",
          STATUS_GLYPH_CLASSES[status],
          className,
        )}
        style={style}
        aria-hidden
      >
        <circle cx={cx} cy={cy} r="5.25" fill="currentColor" opacity="0.74" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 14 14"
      className={twMerge(
        "icon-paired shrink-0 text-ui",
        STATUS_GLYPH_CLASSES[status],
        className,
      )}
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
