import { useState, useRef, useEffect, type ReactNode } from "react";
import { Copy } from "@/components/ui/icons";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/PopoverButton";
import { OpenTargetIcon } from "./OpenTargetIcon";
import type { OpenTarget } from "@/hooks/access/tauri/use-shell-actions";

export function TargetIcon({ target, size = "size-3.5" }: { target: OpenTarget; size?: string }) {
  if (target.kind === "copy") {
    return <Copy className={size} />;
  }
  return <OpenTargetIcon iconId={target.iconId} className={size} variant="menu" />;
}

function DropdownItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="group/menu-item flex w-full cursor-default select-none items-center rounded-lg px-2 py-1 text-sm font-[430] leading-4 text-popover-foreground outline-none hover:bg-popover-accent focus:bg-popover-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="ml-1.5 min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut && (
        <span className="ml-2 inline-flex shrink-0 items-center pl-1">
          <span className="text-xs leading-4 text-muted-foreground/80 transition-colors group-hover/menu-item:text-muted-foreground group-focus/menu-item:text-muted-foreground">
            {shortcut}
          </span>
        </span>
      )}
    </button>
  );
}

type DropdownPhase = "closed" | "entering" | "open" | "exiting";

interface OpenTargetMenuProps {
  targets: OpenTarget[];
  onTargetClick: (target: OpenTarget) => void;
  trigger: (props: { ref: React.Ref<HTMLDivElement>; toggle: () => void; isOpen: boolean }) => ReactNode;
  align?: "left" | "right";
}

export function OpenTargetMenu({ targets, onTargetClick, trigger, align = "left" }: OpenTargetMenuProps) {
  const [phase, setPhase] = useState<DropdownPhase>("closed");
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isVisible = phase !== "closed";

  function openMenu() {
    setPhase("entering");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("open"));
    });
  }

  function closeMenu() {
    setPhase("exiting");
  }

  function toggle() {
    if (phase === "closed") openMenu();
    else if (phase === "open" || phase === "entering") closeMenu();
  }

  useEffect(() => {
    if (phase !== "exiting") return;
    const el = menuRef.current;
    if (!el) { setPhase("closed"); return; }
    function onEnd() { setPhase("closed"); }
    el.addEventListener("transitionend", onEnd, { once: true });
    const fallback = setTimeout(onEnd, 200);
    return () => { el.removeEventListener("transitionend", onEnd); clearTimeout(fallback); };
  }, [phase]);

  useEffect(() => {
    if (!isVisible) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isVisible]);

  function handleItemClick(target: OpenTarget) {
    closeMenu();
    onTargetClick(target);
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      {trigger({ ref: containerRef, toggle, isOpen: isVisible })}
      {isVisible && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute top-full z-50 mt-1 max-h-80 w-[220px] overflow-y-auto ${POPOVER_SURFACE_CLASS} transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          } ${
            phase === "open"
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-1 scale-95 opacity-0"
          }`}
        >
          {targets.map((target) => (
            <DropdownItem
              key={target.id}
              icon={<TargetIcon target={target} />}
              label={target.label}
              shortcut={target.shortcut}
              onClick={() => handleItemClick(target)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
