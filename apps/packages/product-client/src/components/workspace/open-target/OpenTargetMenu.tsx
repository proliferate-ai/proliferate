import type { ReactElement, ReactNode, Ref } from "react";
import { Copy } from "@proliferate/ui/icons";
import { OpenTargetIcon } from "#product/components/workspace/open-target/OpenTargetIcon";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { POPOVER_FRAME_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";

export function TargetIcon({ target, size = "icon-paired" }: { target: OpenTarget; size?: string }) {
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
    <PopoverMenuItem
      density="compact"
      role="menuitem"
      onClick={onClick}
      icon={icon}
      iconClassName="icon-paired text-current"
      label={label}
      trailing={shortcut ? (
        <span className="inline-flex shrink-0 items-center pl-1">
          <span className="text-xs leading-4 text-muted-foreground/80 transition-colors group-hover/menu-item:text-muted-foreground group-focus/menu-item:text-muted-foreground">
            {shortcut}
          </span>
        </span>
      ) : null}
      trailingClassName="ml-0 size-auto"
    />
  );
}

interface OpenTargetMenuProps {
  targets: OpenTarget[];
  onTargetClick: (target: OpenTarget) => void;
  /** Trigger element; PopoverButton wires click/aria/data-state onto it. */
  trigger: ReactElement<{ onClick?: (...args: unknown[]) => void; ref?: Ref<HTMLElement> }>;
  align?: "start" | "end";
}

/**
 * Compact "open in <app>" dropdown (codex popover recipe: 220px, icon+label
 * rows). Built on the canonical Radix PopoverButton so it portals, handles
 * collision/dismiss, and matches every other menu's chrome.
 */
export function OpenTargetMenu({ targets, onTargetClick, trigger, align = "start" }: OpenTargetMenuProps) {
  return (
    <PopoverButton
      trigger={trigger}
      align={align}
      side="bottom"
      className={`${POPOVER_FRAME_CLASS} flex max-h-80 w-[200px] select-none flex-col overflow-y-auto p-1`}
    >
      {(close) => (
        <div role="menu" className="flex flex-col gap-px">
          {targets.map((target) => (
            <DropdownItem
              key={target.id}
              icon={<TargetIcon target={target} />}
              label={target.label}
              shortcut={target.shortcut}
              onClick={() => {
                close();
                onTargetClick(target);
              }}
            />
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
