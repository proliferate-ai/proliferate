import type { ReactNode } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";

interface ChatSurfaceCardProps {
  badge?: string;
  bottomInsetPx: number;
  title: string;
  description: string;
  icon?: ReactNode;
}

export function ChatSurfaceCard({
  badge,
  bottomInsetPx,
  title,
  description,
  icon,
}: ChatSurfaceCardProps) {
  return (
    <div
      className={`flex flex-1 min-h-0 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
      style={{ paddingBottom: bottomInsetPx }}
    >
      <div className={`${CHAT_COLUMN_CLASSNAME} flex min-h-full items-center py-10`}>
        <div className="w-full rounded-lg border border-border/70 bg-card/95 px-8 py-10 text-center">
          {badge && (
            <Badge className="rounded-full px-2.5 py-0.5">
              {badge}
            </Badge>
          )}
          {icon && (
            <div className="mt-4 flex justify-center text-muted-foreground">
              {icon}
            </div>
          )}
          <h2 className="mt-4 text-title font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-chat leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
