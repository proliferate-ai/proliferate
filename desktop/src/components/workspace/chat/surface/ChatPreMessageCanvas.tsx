import type { ReactNode } from "react";
import { CHAT_COLUMN_CLASSNAME, CHAT_SURFACE_GUTTER_CLASSNAME } from "@/config/chat-layout";

interface ChatPreMessageCanvasProps {
  bottomInsetPx: number;
  children: ReactNode;
}

/**
 * Shared parent for the loading and ready heroes. Owns the same gutter +
 * column geometry as the transcript so the first turn can land without a
 * horizontal position jump.
 */
export function ChatPreMessageCanvas({
  bottomInsetPx,
  children,
}: ChatPreMessageCanvasProps) {
  return (
    <div
      className={`flex flex-1 min-h-0 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
      style={{ paddingBottom: bottomInsetPx }}
    >
      <div className={`${CHAT_COLUMN_CLASSNAME} flex flex-col items-center justify-center py-8`}>
        {children}
      </div>
    </div>
  );
}
