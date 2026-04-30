import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_DOCK_LOWER_BACKDROP_FADE_HEIGHT_PX,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "@/config/chat-layout";

interface ChatComposerDockProps extends HTMLAttributes<HTMLDivElement> {
  backdrop?: boolean;
  contextSlot?: ReactNode;
  queueSlot?: ReactNode;
  interactionSlot?: ReactNode;
  delegationSlot?: ReactNode;
  footerSlot?: ReactNode;
  lowerBackdropTopPx?: number | null;
  shellClassName?: string;
  children: ReactNode;
}

/**
 * Shared dock shell for the composer area. Renders:
 *   1. optional backdrop wrapper (blur + scrim) so the composer looks
 *      layered over the transcript scroll
 *   2. a padded max-width column
 *   3. optional inset dock regions, top to bottom:
 *      context, queued prompts, active interactions, delegated work
 *   4. children - usually `<ChatInput />` or a playground surface
 *
 * Consumed by `ChatView` (production) and `ChatPlaygroundPage` (dev) so
 * both surfaces stay in sync automatically.
 */
export const ChatComposerDock = forwardRef<HTMLDivElement, ChatComposerDockProps>(
  function ChatComposerDock({
    backdrop = true,
    contextSlot,
    queueSlot,
    interactionSlot,
    delegationSlot,
    footerSlot,
    lowerBackdropTopPx,
    shellClassName,
    children,
    className = "",
    ...rest
  }, ref) {
    const baseShellClassName = shellClassName
      ? "z-10 shrink-0"
      : "relative z-10 mt-auto shrink-0";
    const lowerBackdropFadeTopPx = lowerBackdropTopPx == null
      ? null
      : Math.max(0, lowerBackdropTopPx - CHAT_DOCK_LOWER_BACKDROP_FADE_HEIGHT_PX);

    return (
      <div
        ref={ref}
        className={twMerge(
          baseShellClassName,
          shellClassName,
        )}
      >
        {backdrop && (
          <>
            {lowerBackdropFadeTopPx == null ? (
              <div className="pointer-events-none absolute inset-x-0 -top-8 z-0 h-10 bg-gradient-to-b from-transparent via-background/45 to-background/95" />
            ) : (
              <div
                className="pointer-events-none absolute inset-x-0 z-0 bg-gradient-to-b from-transparent to-background/88"
                style={{
                  height: CHAT_DOCK_LOWER_BACKDROP_FADE_HEIGHT_PX,
                  top: lowerBackdropFadeTopPx,
                }}
              />
            )}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-background/88 backdrop-blur-xl"
              style={{ top: lowerBackdropTopPx == null ? 0 : `${lowerBackdropTopPx}px` }}
            />
          </>
        )}
        <div className={twMerge("pointer-events-none relative z-10 pb-4", CHAT_SURFACE_GUTTER_CLASSNAME, className)} {...rest}>
          <div className={twMerge("pointer-events-auto relative @container", CHAT_COLUMN_CLASSNAME)}>
            {contextSlot && (
              <div className="relative flex flex-col px-8">{contextSlot}</div>
            )}
            {queueSlot && (
              <div className="relative flex flex-col px-7">{queueSlot}</div>
            )}
            {interactionSlot && (
              <div className="relative flex flex-col px-6">{interactionSlot}</div>
            )}
            {delegationSlot && (
              <div className="relative flex flex-col px-5">{delegationSlot}</div>
            )}
            {children}
            {footerSlot ? (
              <div className="mt-2">{footerSlot}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
