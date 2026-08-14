import { Copy } from "#product/primitives/icons/core";
import { Globe } from "#product/primitives/icons/platform";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";

export function WebLinkMenu({
  close,
  onOpen,
  onCopy,
}: {
  close: () => void;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <div role="menu" aria-label="Link actions" className="flex flex-col gap-px">
      <PopoverMenuItem
        density="compact"
        role="menuitem"
        icon={<Globe className="icon-paired" />}
        label="Open in Browser"
        onClick={() => {
          onOpen();
          close();
        }}
      />
      <PopoverMenuItem
        density="compact"
        role="menuitem"
        icon={<Copy className="icon-paired" />}
        label="Copy link"
        onClick={() => {
          onCopy();
          close();
        }}
      />
    </div>
  );
}
