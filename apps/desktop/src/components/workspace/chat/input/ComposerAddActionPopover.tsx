import type { MouseEvent, ReactNode } from "react";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  FilePlus,
  Plus,
} from "@proliferate/ui/icons";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { ComposerPopoverSurface } from "@proliferate/product-ui/chat/composer/ComposerPopoverSurface";

interface ComposerAddActionPopoverProps {
  canAttachFile: boolean;
  attachFileDetail: string;
  onAttachFile: () => void;
}

export function ComposerAddActionPopover({
  canAttachFile,
  attachFileDetail,
  onAttachFile,
}: ComposerAddActionPopoverProps) {
  return (
    <PopoverButton
      trigger={(
        <ComposerControlButton
          iconOnly
          icon={<Plus className="size-4" />}
          label="Add"
          title="Add file"
          aria-label="Add file"
        />
      )}
      align="end"
      side="top"
      offset={8}
      className="w-auto border-0 bg-transparent p-0 shadow-none"
    >
      {(close) => (
        <ComposerPopoverSurface className="w-72 p-1.5">
          <div className="space-y-1">
            <ComposerActionRow
              icon={<FilePlus className="size-4 text-muted-foreground" />}
              label="Add file"
              detail={attachFileDetail}
              disabled={!canAttachFile}
              onClick={() => {
                onAttachFile();
                close();
              }}
            />
          </div>
        </ComposerPopoverSurface>
      )}
    </PopoverButton>
  );
}

function ComposerActionRow({
  icon,
  label,
  detail,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex items-start gap-1">
      <PopoverMenuItem
        icon={icon}
        label={label}
        disabled={disabled}
        onClick={onClick}
        className="min-w-0 flex-1"
      >
        <span className="block whitespace-normal text-ui-sm text-muted-foreground">
          {detail}
        </span>
      </PopoverMenuItem>
    </div>
  );
}
