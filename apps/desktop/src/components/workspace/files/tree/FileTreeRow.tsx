import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { ChevronRight } from "@proliferate/ui/icons";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
import { fileTreeIconToneClass } from "@/components/workspace/files/tree/file-tree-icon-colors";

interface FileTreeRowProps {
  name: string;
  path: string;
  kind: "file" | "directory";
  level: number;
  selected?: boolean;
  expanded?: boolean;
  changed?: boolean;
  onClick: () => void;
}

export function FileTreeRow({
  name,
  path,
  kind,
  level,
  selected = false,
  expanded,
  changed = false,
  onClick,
}: FileTreeRowProps) {
  const isDirectory = kind === "directory";
  const paddingLeft = isDirectory ? 6 + level * 12 : 18 + level * 12;
  const iconTone = fileTreeIconToneClass(name, path, kind);

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected}
      aria-level={level + 1}
      title={path}
      className={twMerge(
        "flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] leading-none transition-colors duration-150",
        "hover:bg-sidebar-accent",
        isDirectory ? "text-sidebar-muted-foreground" : "text-sidebar-foreground",
        selected && "bg-sidebar-accent text-sidebar-foreground",
      )}
      style={{ paddingLeft }}
      onClick={onClick}
    >
      {isDirectory && (
        <ChevronRight
          className={twMerge(
            "size-3 shrink-0 text-sidebar-muted-foreground/50 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
      )}
      <FileTreeEntryIcon
        name={name}
        path={path}
        kind={kind}
        isExpanded={isDirectory ? expanded : undefined}
        className="size-3.5 shrink-0"
        toneClassName={iconTone}
      />
      <span className="min-w-0 flex-1 truncate">
        {name}
      </span>
      {changed && (
        <span
          className="inline-flex size-1.5 shrink-0 rounded-full bg-accent"
          aria-label="Modified"
        />
      )}
    </button>
  );
}
