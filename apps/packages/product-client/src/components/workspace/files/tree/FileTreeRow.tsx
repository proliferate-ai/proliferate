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
  // Directories show a chevron and files show a type icon in the same
  // leading slot (see render below), so both kinds share one indent formula.
  const paddingLeft = 6 + level * 14;
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
        // The reference tree rows read at chat-body size; ours follows
        // --text-message so the tree tracks transcript prose across
        // appearance presets.
        "flex h-7 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-sidebar-row leading-none text-sidebar-foreground transition-colors duration-hover hover:bg-hover active:bg-active",
        selected && "bg-selected",
      )}
      style={{ paddingLeft }}
      onClick={onClick}
    >
      {isDirectory ? (
        // Reference tree rows mark directories with a disclosure chevron only
        // — no folder glyph. Files keep their per-type icon in that same
        // leading slot, so the two kinds never both show a leading icon.
        <ChevronRight
          className={twMerge(
            "icon-compact shrink-0 text-sidebar-muted-foreground transition-transform duration-disclosure",
            expanded && "rotate-90",
          )}
        />
      ) : (
        <FileTreeEntryIcon
          name={name}
          path={path}
          kind={kind}
          className="icon-paired shrink-0 [font-size:var(--text-sidebar-row)]"
          toneClassName={iconTone}
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        {name}
      </span>
      {changed && (
        <span
          className="shrink-0 pr-1 text-ui-sm font-medium leading-none text-git-yellow"
          aria-label="Modified"
        >
          M
        </span>
      )}
    </Button>
  );
}
