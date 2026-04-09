import { useState, useRef, useEffect, type ReactNode } from "react";
import { Copy } from "@/components/ui/icons";
import { OpenTargetIcon } from "./OpenTargetIcon";
import type { OpenTarget } from "@/platform/tauri/shell";

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
    <div
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className="relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent/40 focus:bg-accent/40 focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
      {icon}
      <span className="ml-2">{label}</span>
      {shortcut && (
        <span className="inline-flex items-center ml-auto pl-1">
          <span className="text-xs text-muted-foreground">{shortcut}</span>
        </span>
      )}
    </div>
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
          className={`absolute top-full z-50 mt-1 min-w-[10rem] overflow-auto rounded-lg border border-border bg-popover p-1 text-foreground shadow-floating transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
