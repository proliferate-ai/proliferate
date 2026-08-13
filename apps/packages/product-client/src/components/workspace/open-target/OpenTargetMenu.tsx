import type { ReactElement, Ref } from "react";
import { Copy } from "#product/primitives/icons/core";
import { OpenTargetIcon } from "#product/components/workspace/open-target/OpenTargetIcon";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import { POPOVER_FRAME_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import type { OpenTarget } from "@proliferate/product-client/host/desktop-bridge";

export function TargetIcon({ target, size = "icon-paired" }: { target: OpenTarget; size?: string }) {
  if (target.kind === "copy") {
    return <Copy className={size} />;
  }
  return <OpenTargetIcon iconId={target.iconId} className={size} variant="menu" />;
}

// The trailing shortcut hint stays hand-rolled rather than adopting
// `ShortcutBadge`: ShortcutBadge paints a filled pill (bg-current/10,
// rounded-md, padding), visibly different chrome from this bare, menu-hover
// reactive text hint. Per the frozen wave-2 shell spec §2-E, a visible paint
// delta keeps the current spelling rather than forcing the migration — this
// is the same duplicate as `TabContextMenu.tsx`'s shortcut hint, tracked as
// residue in the wave-2 vocabulary report, not fixed in this slice.
function OpenTargetItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <PopoverMenuItem
      density="compact"
      onClick={onClick}
      icon={icon}
      iconClassName="icon-paired text-current"
      label={label}
      trailing={shortcut ? (
        <span className="inline-flex shrink-0 items-center pl-1">
          <span className="text-ui-sm leading-4 text-muted-foreground/80 transition-colors group-hover/menu-item:text-muted-foreground group-focus/menu-item:text-muted-foreground">
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
 * Compact "open in <app>" dropdown: 220px wide, icon+label rows. Built on
 * the canonical Radix PopoverButton so it portals, handles collision and
 * dismiss, and matches every other menu's chrome.
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
        <div className="flex flex-col gap-px">
          {targets.map((target) => (
            <OpenTargetItem
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
