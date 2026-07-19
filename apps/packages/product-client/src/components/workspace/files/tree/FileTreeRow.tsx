import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ChevronRight } from "@proliferate/ui/icons";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import { fileTreeIconToneClass } from "#product/lib/domain/files/file-tree-icon-colors";

interface FileTreeRowProps {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  level: number;
  selected?: boolean;
  expanded?: boolean;
  changed?: boolean;
  busy?: boolean;
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
  busy = false,
  onClick,
}: FileTreeRowProps) {
  const isDirectory = kind === "directory";
  const paddingLeft = isDirectory ? 6 + level * 14 : 28 + level * 14;
  const iconTone = fileTreeIconToneClass(name, path, kind);

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      role="treeitem"
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected}
      aria-level={level + 1}
      aria-busy={busy || undefined}
      title={path}
      className={twMerge(
        // Codex tree rows read at chat-body size; ours follows --text-message
        // so the tree tracks transcript prose across appearance presets.
        "flex h-7 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-[length:var(--text-message)] leading-none text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent",
        selected && "bg-sidebar-accent",
      )}
      style={{ paddingLeft }}
      onClick={onClick}
    >
      {isDirectory && (
        <ChevronRight
          className={twMerge(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform duration-150",
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
          className="shrink-0 pr-1 text-[10px] font-medium leading-none text-git-yellow"
          aria-label="Modified"
        >
          M
        </span>
      )}
    </Button>
  );
}
