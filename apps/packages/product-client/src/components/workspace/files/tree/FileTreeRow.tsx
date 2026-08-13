import { twMerge } from "#product/primitives/utils/tw-merge";
import { ChevronRight } from "#product/primitives/icons/core";
import { SidebarRowSurface } from "#product/primitives/patterns/sidebar/SidebarRowSurface";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import { fileTreeIconToneClass } from "#product/lib/domain/files/file-tree-icon-colors";
import { fileTreeIndentPaddingLeft } from "#product/lib/domain/files/file-tree-indent";

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
  const paddingLeft = fileTreeIndentPaddingLeft(level);
  const iconTone = fileTreeIconToneClass(name, path, kind);

  return (
    <SidebarRowSurface
      as="button"
      active={selected}
      onPress={onClick}
      role="treeitem"
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected}
      aria-level={level + 1}
      aria-busy={busy || undefined}
      title={path}
      className={twMerge(
        // The reference tree rows read at chat-body size; ours follows
        // --text-message so the tree tracks transcript prose across
        // appearance presets. SidebarRowSurface owns the hover/active/
        // selected state stack (C7) — a selected row no longer also shows
        // hover/active feedback, which is that pattern's own "hover sits one
        // step below selected" ruling, not a local decision.
        "flex h-7 w-full items-center gap-2.5 px-1.5 text-left text-sidebar-row leading-none",
      )}
      style={{ paddingLeft }}
    >
      {isDirectory ? (
        // Reference tree rows mark directories with a disclosure chevron only
        // — no folder glyph. Files keep their per-type icon in that same
        // leading slot, so the two kinds never both show a leading icon.
        // Contradiction, recorded rather than re-derived: spec section 2.6
        // lists this chevron rotate as one of four sites adopting
        // `Disclosure`, but section 2.2's own ruling for this file says
        // "adopt SidebarRowSurface for the interaction surface... and keep
        // everything else." `Disclosure` owns a standalone trigger+content
        // pair with its own ARIA/keyboard contract; this chevron is a purely
        // presentational indicator inside a `role="treeitem"` row whose
        // expand/select click and `aria-expanded` state are owned by
        // `FileTreeDirectory`'s shared store, not by this row. Wrapping it
        // in `Disclosure` would fight the WAI-ARIA treeitem pattern. Left
        // as-is per the more specific 2.2 ruling.
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
    </SidebarRowSurface>
  );
}
