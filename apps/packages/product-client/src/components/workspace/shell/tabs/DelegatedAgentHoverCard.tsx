import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type MutableRefObject,
  type MouseEvent,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "@proliferate/design/motion";
import { Button } from "#product/primitives/Button";
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";
import { AgentIdentityGlyph } from "#product/components/workspace/delegated-work/AgentIdentityGlyph";
import type { DelegatedWorkTabIdentity } from "#product/lib/domain/delegated-work/model";

/**
 * WAVE-2 NOTE (shell slice, DESIGN_SYSTEM.md UI-conformance review): the
 * doctrine rules this card onto `Tooltip`, and rules the clickable mode
 * deletable as dead code. Neither landed, for reasons recorded here so the
 * next slice does not re-derive them.
 *
 * 1. `Tooltip`'s `content` prop is `string`, not `ReactNode` — it cannot host
 *    this card's identicon + name + origin + key/value rows without a second
 *    edit to a library file this slice does not own, and nesting a Radix
 *    Tooltip inside the existing `PopoverButton`-based rename/context-menu
 *    trigger chain needs hand verification of focus neutrality in a running
 *    app (the frozen spec's Risk 3). Escalated per the spec's §2-C fallback.
 * 2. The clickable mode is NOT dead. The spec named `ChatTabWithMenu.tsx` as
 *    the only call site; `SubagentToolActionRow.tsx` is a second one and it
 *    passes both `cardAriaLabel` and `onCardClick` (opening the subagent's
 *    session from the transcript). Deleting the branch would have removed a
 *    live affordance and broken that file's types, so the ruling's premise
 *    fails and the branch stays. The tooltip-that-is-also-a-button role
 *    conflict is real and remains open residue for the next slice.
 */

const VIEWPORT_MARGIN = 12;
const HOVER_CARD_OFFSET = 6;
const CARD_WIDTH = 224;

interface DelegatedAgentHoverCardProps extends HTMLAttributes<HTMLDivElement> {
  agent: DelegatedWorkTabIdentity;
  children: ReactElement;
  cardAriaLabel?: string;
  onCardClick?: () => void;
}

export const DelegatedAgentHoverCard = forwardRef<HTMLDivElement, DelegatedAgentHoverCardProps>(
  function DelegatedAgentHoverCard({
    agent,
    children,
    className = "",
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    cardAriaLabel,
    onCardClick,
    ...props
  }, forwardedRef) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLElement | null>(null);
    const hideTimerRef = useRef<number | null>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const [measured, setMeasured] = useState(false);

    const setAnchorRef = useCallback((node: HTMLDivElement | null) => {
      anchorRef.current = node;
      assignRef(forwardedRef, node);
    }, [forwardedRef]);
    const setCardRef = useCallback((node: HTMLElement | null) => {
      cardRef.current = node;
    }, []);

    const updatePosition = useCallback(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.bottom + HOVER_CARD_OFFSET,
        left: rect.left,
      });
      setMeasured(false);
    }, []);

    const hide = useCallback(() => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setOpen(false);
      setMeasured(false);
    }, []);

    const show = useCallback(() => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      updatePosition();
      setOpen(true);
    }, [updatePosition]);

    const scheduleHide = useCallback(() => {
      if (!onCardClick) {
        hide();
        return;
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        hide();
      }, motion.delay.hoverCardHideMs);
    }, [hide, onCardClick]);

    const isInsideCard = useCallback((target: EventTarget | null) =>
      !!target && target instanceof Node && !!cardRef.current?.contains(target),
    []);

    const isInsideAnchor = useCallback((target: EventTarget | null) =>
      !!target && target instanceof Node && !!anchorRef.current?.contains(target),
    []);

    const card = (
      <div>
        <div className="flex min-w-0 items-center gap-2">
          <AgentIdentityGlyph
            identity={agent.identity}
            className={`icon-paired shrink-0 text-ui ${agent.identity.textColorClassName}`}
          />
          <div className="min-w-0">
            <div className="truncate text-ui font-medium text-foreground">
              {agent.identity.displayName}
            </div>
            <div className="mt-0.5 text-muted-foreground">{agent.originLabel}</div>
          </div>
        </div>
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-muted-foreground">
          {agent.parentTitle && (
            <HoverCardRow label="Parent" value={agent.parentTitle} />
          )}
          <HoverCardRow label="Status" value={agent.statusLabel} />
        </div>
      </div>
    );

    useLayoutEffect(() => {
      if (!open || !position || measured) return;
      const card = cardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const maxLeft = window.innerWidth - VIEWPORT_MARGIN - rect.width;
      const clampedLeft = Math.min(Math.max(position.left, VIEWPORT_MARGIN), maxLeft);
      if (clampedLeft !== position.left) {
        setPosition({ ...position, left: clampedLeft });
      }
      setMeasured(true);
    }, [measured, open, position]);

    useEffect(() => {
      if (!open) return;
      const handleWindowChange = () => updatePosition();
      window.addEventListener("resize", handleWindowChange);
      window.addEventListener("scroll", handleWindowChange, true);
      return () => {
        window.removeEventListener("resize", handleWindowChange);
        window.removeEventListener("scroll", handleWindowChange, true);
      };
    }, [open, updatePosition]);

    useEffect(() => () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    }, []);

    return (
      <>
        <div
          {...props}
          ref={setAnchorRef}
          className={`inline-flex min-w-0 ${className}`}
          onMouseEnter={(event: MouseEvent<HTMLDivElement>) => {
            onMouseEnter?.(event);
            show();
          }}
          onMouseLeave={(event: MouseEvent<HTMLDivElement>) => {
            onMouseLeave?.(event);
            if (onCardClick && isInsideCard(event.relatedTarget)) {
              return;
            }
            scheduleHide();
          }}
          onFocus={(event: FocusEvent<HTMLDivElement>) => {
            onFocus?.(event);
            show();
          }}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            onBlur?.(event);
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
              && !(onCardClick && isInsideCard(event.relatedTarget))
            ) {
              hide();
            }
          }}
        >
          {children}
        </div>
        {open && position && createPortal(
          onCardClick ? (
            <Button
              ref={setCardRef}
              type="button"
              variant="unstyled"
              size="unstyled"
              data-telemetry-mask
              data-chat-transcript-ignore
              style={{ top: position.top, left: position.left, width: CARD_WIDTH }}
              className={`fixed z-tooltip block whitespace-normal ${POPOVER_FRAME_CLASS} p-2.5 text-left text-ui hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring ${
                measured ? "opacity-100" : "opacity-0"
              }`}
              aria-label={cardAriaLabel ?? `Open ${agent.identity.displayName}`}
              onMouseEnter={show}
              onMouseLeave={(event) => {
                if (isInsideAnchor(event.relatedTarget)) {
                  return;
                }
                scheduleHide();
              }}
              onBlur={(event) => {
                if (!isInsideAnchor(event.relatedTarget)) {
                  hide();
                }
              }}
              onClick={() => {
                onCardClick();
                hide();
              }}
            >
              {card}
            </Button>
          ) : (
            <div
              ref={setCardRef}
              role="tooltip"
              data-telemetry-mask
              style={{ top: position.top, left: position.left, width: CARD_WIDTH }}
              className={`pointer-events-none fixed z-tooltip ${POPOVER_FRAME_CLASS} p-2.5 text-ui ${
                measured ? "opacity-100" : "opacity-0"
              }`}
            >
              {card}
            </div>
          ),
          document.body,
        )}
      </>
    );
  },
);

function HoverCardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="min-w-0 truncate text-popover-foreground">{value}</span>
    </div>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as MutableRefObject<T | null>).current = value;
}
