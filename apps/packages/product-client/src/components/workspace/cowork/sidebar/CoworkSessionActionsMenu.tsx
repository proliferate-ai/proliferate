import { Pencil, Trash } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";

export function CoworkSessionActionsMenu({
  onRename,
  onArchive,
}: {
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="py-0.5">
      <PopoverMenuItem
        icon={<Pencil className="size-4" />}
        label="Rename"
        onClick={onRename}
      />
      <PopoverMenuItem
        icon={<Trash className="size-4" />}
        label="Archive"
        className="text-destructive hover:text-destructive"
        onClick={onArchive}
      />
    </div>
  );
}
