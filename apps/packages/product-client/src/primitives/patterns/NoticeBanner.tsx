import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

/** The one tone axis: what the notice means, never how large or how loud it is. */
export type NoticeBannerTone =
  | "neutral"
  | "info"
  | "warning"
  | "destructive";

interface ToneStyle {
  /** Frame paint: border, fill, and the ink the whole banner inherits. */
  frame: string;
  /** The subordinate ink for the body slot under a title. */
  body: string;
  /** Live-region role a tone implies when the caller does not name one. */
  role: "status" | "alert";
}

const TONE_STYLES: Record<NoticeBannerTone, ToneStyle> = {
  neutral: {
    frame: "border-border bg-card text-foreground",
    body: "text-muted-foreground",
    role: "status",
  },
  info: {
    frame: "border-info/40 bg-info/10 text-foreground",
    body: "text-muted-foreground",
    role: "status",
  },
  warning: {
    frame: "border-warning-border bg-warning-subtle text-warning-foreground",
    body: "opacity-90",
    role: "status",
  },
  destructive: {
    frame: "border-destructive/30 bg-destructive-subtle text-destructive",
    body: "opacity-90",
    role: "alert",
  },
};

export interface NoticeBannerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role"> {
  /** Semantic weight of the message. One axis; there is no size or density axis. */
  tone?: NoticeBannerTone;
  /** Leading glyph slot. Sized to `icon-paired` by the frame — pass the bare glyph. */
  icon?: ReactNode;
  /** Optional emphasized first line. Omit for a single-sentence notice. */
  title?: ReactNode;
  /** The message body. */
  children?: ReactNode;
  /** Optional trailing action slot — fill it with a `Button`, never a raw element. */
  action?: ReactNode;
  /** Live-region role. Defaults to `alert` for the destructive tone, `status` otherwise. */
  role?: "status" | "alert";
}

/**
 * The shared inline-notice frame: a tinted, bordered block carrying a leading
 * glyph, a message, and an optional trailing action.
 *
 * Anatomy is fixed and the slots are `ReactNode` — the banner owns the frame,
 * the tone paint, the icon box, and the title/body rhythm, and callers fill
 * slots rather than redrawing the skeleton around them. It paints no
 * interaction states of its own: the action slot takes an interactive
 * primitive (`Button`, `IconButton`) whose states that primitive already owns,
 * so no hover/active/focus-visible stack is ever hand-assembled here.
 */
export function NoticeBanner({
  tone = "neutral",
  icon,
  title,
  children,
  action,
  role,
  className,
  ...props
}: NoticeBannerProps) {
  const style = TONE_STYLES[tone];

  return (
    <div
      role={role ?? style.role}
      className={twMerge(
        "flex items-start gap-3 rounded-lg border p-3 text-ui",
        style.frame,
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden className="mt-0.5 shrink-0 [&>svg]:icon-paired">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? (
          <div className={twMerge(title ? "mt-1" : "", title ? style.body : "")}>
            {children}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
