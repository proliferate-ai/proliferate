import type { ReactNode } from "react";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";

interface ChatPreMessageCanvasProps {
  bottomInsetPx: number;
  children: ReactNode;
  /**
   * Optional content pinned above the centered hero, left-aligned at the
   * top of the column (e.g. the workspace-creation receipt). Renders
   * whether or not it has anything to show — callers pass a component that
   * is safe to mount unconditionally.
   */
  topSlot?: ReactNode;
}

/**
 * Shared parent for the loading and ready heroes. Owns the same gutter +
 * column geometry as the transcript so the first turn can land without a
 * horizontal position jump.
 */
export function ChatPreMessageCanvas({
  bottomInsetPx,
  children,
  topSlot,
}: ChatPreMessageCanvasProps) {
  return (
    <div
      className={`flex flex-1 min-h-0 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
      style={{ paddingBottom: bottomInsetPx }}
    >
      <div className={`${CHAT_COLUMN_CLASSNAME} flex flex-col py-8`}>
        {topSlot}
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}
