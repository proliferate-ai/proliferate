import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "../utils/tw-merge";

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
  tabClassName?: string;
}

export function Tabs({
  items,
  activeId,
  onChange,
  className = "",
  tabClassName = "",
}: TabsProps) {
  return (
    <div
      role="tablist"
      className={twMerge(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1",
        className,
      )}
    >
      {items.map((item) => (
        <TabButton
          key={item.id}
          active={item.id === activeId}
          disabled={item.disabled}
          className={tabClassName}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </TabButton>
      ))}
    </div>
  );
}

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
}

function TabButton({ active, className = "", children, type = "button", ...props }: TabButtonProps) {
  return (
    <button
      role="tab"
      type={type}
      aria-selected={active}
      data-active={active ? "" : undefined}
      className={twMerge(
        "inline-flex h-7 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
