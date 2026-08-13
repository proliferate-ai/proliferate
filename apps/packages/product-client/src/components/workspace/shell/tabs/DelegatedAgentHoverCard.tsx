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
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";
import { DelegatedAgentIdenticon } from "#product/components/workspace/delegated-work/DelegatedAgentIdenticon";
import type { DelegatedWorkTabIdentity } from "#product/lib/domain/delegated-work/model";

/**
 * WAVE-2 NOTE (shell slice, DESIGN_SYSTEM.md UI-conformance review): the
 * doctrine rules this card onto `Tooltip`. `Tooltip`'s `content` prop is
 * `string`, not `ReactNode` — it cannot host this card's identicon + name +
 * origin + key/value rows without a second edit to a library file this
 * slice does not own, and nesting a Radix Tooltip inside the existing
 * `PopoverButton`-based rename/context-menu trigger chain needs hand
 * verification in a running app (focus neutrality — see the frozen spec's
 * Risk 3) that this environment cannot perform. Escalated per the frozen
 * spec's own §2-C fallback clause rather than forced through.
 *
 * What DID land here: the ruled dead-code deletion. `onCardClick` has
 * exactly one call site (`ChatTabWithMenu.tsx`) and it passes neither
 * `onCardClick` nor `cardAriaLabel` — the clickable mode was unreachable.
 * Removed: the `onCardClick` branch, `scheduleHide`'s hide-grace timer,
 * `isInsideCard`, and the `cardAriaLabel` prop. The read-only tooltip-role
 * portal (positioning, collision clamp, resize/scroll reposition, the
 * `measured` flicker guard) stays — it is still the only implementation,
 * not yet replaced.
 */

const VIEWPORT_MARGIN = 12;
const HOVER_CARD_OFFSET = 6;
const CARD_WIDTH = 224;

interface DelegatedAgentHoverCardProps extends HTMLAttributes<HTMLDivElement> {
  agent: DelegatedWorkTabIdentity;
  children: ReactElement;
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
    ...props
  }, forwardedRef) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLElement | null>(null);
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
      setOpen(false);
      setMeasured(false);
    }, []);

    const show = useCallback(() => {
      updatePosition();
      setOpen(true);
    }, [updatePosition]);

    const card = (
      <div>
        <div className="flex min-w-0 items-center gap-2">
          <DelegatedAgentIdenticon
            identity={agent.identity}
            className={`size-4 shrink-0 ${agent.identity.textColorClassName}`}
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
            hide();
          }}
          onFocus={(event: FocusEvent<HTMLDivElement>) => {
            onFocus?.(event);
            show();
          }}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            onBlur?.(event);
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              hide();
            }
          }}
        >
          {children}
        </div>
        {open && position && createPortal(
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
          </div>,
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
