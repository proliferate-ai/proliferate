import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
import { Input } from "@proliferate/ui/primitives/Input";
import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { ChevronRight, Search } from "@proliferate/ui/icons";

export interface PaneFileTreeNode<TData = unknown> {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  label?: ReactNode;
  title?: string;
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  trailing?: ReactNode;
  children?: PaneFileTreeNode<TData>[];
  data?: TData;
}

export interface PaneFileTreeSection<TData = unknown> {
  id: string;
  label?: ReactNode;
  trailing?: ReactNode;
  nodes: PaneFileTreeNode<TData>[];
}

export function PaneFileTree<TData = unknown>({
  sections,
  searchValue,
  searchPlaceholder = "Filter files",
  searchAutoFocus = false,
  emptyMessage = "No files",
  onSearchChange,
  onSelectNode,
  onToggleDirectory,
  className = "",
}: {
  sections: readonly PaneFileTreeSection<TData>[];
  searchValue?: string;
  searchPlaceholder?: string;
  searchAutoFocus?: boolean;
  emptyMessage?: string;
  onSearchChange?: (value: string) => void;
  onSelectNode?: (node: PaneFileTreeNode<TData>) => void;
  onToggleDirectory?: (node: PaneFileTreeNode<TData>) => void;
  className?: string;
}) {
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;
  const hasSections = sections.some((section) => section.nodes.length > 0);

  return (
    <div className={twMerge("flex h-full min-h-0 flex-col bg-sidebar-background", className)}>
      {hasSearch && (
        <div className="border-b border-sidebar-border/70 p-2">
          <div className="flex h-7 items-center gap-1.5 rounded-lg bg-sidebar-accent px-2 text-sidebar-muted-foreground">
            <Search className="size-3 shrink-0" />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder={searchPlaceholder}
              autoFocus={searchAutoFocus}
              className="h-full border-0 bg-transparent px-0 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground focus:ring-0"
            />
          </div>
        </div>
      )}
      <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="px-1.5 py-1.5">
        {!hasSections ? (
          <p className="px-2 py-3 text-xs text-sidebar-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {sections.map((section) => (
              <div key={section.id} className="flex flex-col gap-px">
                {section.label && (
                  <div className="flex h-6 items-center justify-between gap-2 px-2 text-sm font-medium uppercase tracking-wide text-sidebar-muted-foreground">
                    <span className="min-w-0 truncate">{section.label}</span>
                    {section.trailing}
                  </div>
                )}
                {section.nodes.map((node) => (
                  <PaneFileTreeNodeRow
                    key={node.id}
                    node={node}
                    level={0}
                    onSelectNode={onSelectNode}
                    onToggleDirectory={onToggleDirectory}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </AutoHideScrollArea>
    </div>
  );
}

function PaneFileTreeNodeRow<TData>({
  node,
  level,
  onSelectNode,
  onToggleDirectory,
}: {
  node: PaneFileTreeNode<TData>;
  level: number;
  onSelectNode?: (node: PaneFileTreeNode<TData>) => void;
  onToggleDirectory?: (node: PaneFileTreeNode<TData>) => void;
}) {
  const isDirectory = node.kind === "directory";
  const expanded = node.expanded ?? true;
  const children = node.children ?? [];
  const rowPaddingLeft = isDirectory ? 8 + level * 12 : 18 + level * 12;

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={node.disabled}
        aria-expanded={isDirectory ? expanded : undefined}
        aria-pressed={node.selected || undefined}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory?.(node);
          } else {
            onSelectNode?.(node);
          }
        }}
        title={node.title ?? node.path}
        className={twMerge(
          "h-6 w-full justify-start gap-1.5 rounded-md px-2 text-sm hover:bg-sidebar-accent",
          isDirectory ? "text-sidebar-muted-foreground" : "text-sidebar-foreground",
          node.selected && "bg-sidebar-accent text-sidebar-foreground",
        )}
        style={{ paddingLeft: rowPaddingLeft }}
      >
        {isDirectory && (
          <ChevronRight
            className={twMerge(
              "size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
        <FileTreeEntryIcon
          name={node.name}
          path={node.path}
          kind={node.kind}
          isExpanded={isDirectory ? expanded : undefined}
          className="size-3 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-left [direction:ltr] [unicode-bidi:plaintext]">
          {node.label ?? node.name}
        </span>
        {node.trailing && (
          <span className="inline-flex shrink-0 items-center">{node.trailing}</span>
        )}
      </Button>
      {isDirectory && expanded && children.map((child) => (
        <PaneFileTreeNodeRow
          key={child.id}
          node={child}
          level={level + 1}
          onSelectNode={onSelectNode}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
    </div>
  );
}

export function PaneFileTreeBadge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={twMerge(
        "rounded bg-sidebar-accent px-1 py-px text-[9px] font-medium leading-none text-sidebar-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
