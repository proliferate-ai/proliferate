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
import { Button } from "@proliferate/ui/primitives/Button";
import { Robot } from "@/components/ui/icons";
import type { DelegatedWorkTabIdentity } from "@/lib/domain/delegated-work/model";

const VIEWPORT_MARGIN = 12;
const HOVER_CARD_OFFSET = 6;
const CARD_WIDTH = 224;
const CLICKABLE_CARD_HIDE_DELAY_MS = 120;

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
      }, CLICKABLE_CARD_HIDE_DELAY_MS);
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
          <Robot className={`size-4 shrink-0 ${agent.identity.textColorClassName}`} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
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
              className={`fixed z-[70] block whitespace-normal rounded-lg border border-border/70 bg-popover/96 p-2.5 text-left text-xs text-popover-foreground shadow-floating backdrop-blur-lg hover:bg-popover focus-visible:ring-2 focus-visible:ring-ring ${
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
              className={`pointer-events-none fixed z-[70] rounded-lg border border-border/70 bg-popover/96 p-2.5 text-xs text-popover-foreground shadow-floating backdrop-blur-lg ${
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
