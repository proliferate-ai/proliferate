import { Pencil, Trash } from "@/components/ui/icons";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";

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
        icon={<Pencil className="size-3.5" />}
        label="Rename"
        onClick={onRename}
      />
      <PopoverMenuItem
        icon={<Trash className="size-3.5" />}
        label="Archive"
        className="text-destructive hover:text-destructive"
        onClick={onArchive}
      />
    </div>
  );
}
