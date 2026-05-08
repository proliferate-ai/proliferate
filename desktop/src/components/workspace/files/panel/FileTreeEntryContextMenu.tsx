import type { ReactElement, Ref } from "react";
import type { WorkspaceFileEntry } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import { FilePlus, FolderPlus, Pencil, Trash } from "@/components/ui/icons";
import {
  TargetIcon,
} from "@/components/workspace/open-target/OpenTargetMenu";
import type { OpenTarget } from "@/hooks/access/tauri/use-shell-actions";

type PopoverTriggerElement = ReactElement<{
  onClick?: (...args: unknown[]) => void;
  onDoubleClick?: (...args: unknown[]) => void;
  onContextMenu?: (...args: unknown[]) => void;
  ref?: Ref<HTMLElement>;
}>;

export function FileTreeEntryContextMenu({
  entry,
  targets,
  trigger,
  onOpenInProliferate,
  onOpenTarget,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  entry: WorkspaceFileEntry;
  targets: OpenTarget[];
  trigger: PopoverTriggerElement;
  onOpenInProliferate: () => void;
  onOpenTarget: (targetId: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      stopPropagation
      className="w-52 rounded-lg border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenInProliferate();
              close();
            }}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
          >
            <FileTreeEntryIcon
              name={entry.name}
              path={entry.path}
              kind={entry.kind}
              className="size-3.5 shrink-0"
            />
            <span>Open in Proliferate</span>
          </Button>
          <div className="my-1 h-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onNewFile();
              close();
            }}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
          >
            <FilePlus className="size-3.5 shrink-0" />
            <span>New File</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onNewFolder();
              close();
            }}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
          >
            <FolderPlus className="size-3.5 shrink-0" />
            <span>New Folder</span>
          </Button>
          <div className="my-1 h-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onRename();
              close();
            }}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
          >
            <Pencil className="size-3.5 shrink-0" />
            <span>Rename</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onDelete();
              close();
            }}
            className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-destructive hover:bg-accent/40 hover:text-destructive"
          >
            <Trash className="size-3.5 shrink-0" />
            <span>Delete</span>
          </Button>
          {targets.length > 0 && <div className="my-1 h-px bg-border" />}
          {targets.map((target) => (
            <Button
              key={target.id}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenTarget(target.id);
                close();
              }}
              className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-[0.5rem] text-foreground/80 hover:bg-accent/40 hover:text-foreground"
            >
              <TargetIcon target={target} size="size-3.5" />
              <span>{target.label}</span>
            </Button>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}
