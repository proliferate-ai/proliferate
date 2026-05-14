import type {
  ReactNode,
  Ref,
} from "react";
import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";
import {
  Check,
  ChevronDown,
  Copy,
  FilePen,
  FileText,
  GitBranch,
  RefreshCw,
  SplitPanel,
} from "@/components/ui/icons";
import { PickerPopoverContent } from "@/components/ui/PickerPopoverContent";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Tooltip } from "@/components/ui/Tooltip";
import type { DiffScopeOption } from "@/lib/domain/workspaces/viewer/file-diff-options";
import type {
  FileDiffViewerScope,
  FileViewerMode,
} from "@/lib/domain/workspaces/viewer/viewer-target";

export function FileViewerFrame({
  rootRef,
  filePath,
  mode,
  canRenderMarkdown: markdown,
  canRenderDiff,
  diffScopeOptions,
  activeDiffScope,
  diffLayout,
  dirty,
  saveState,
  onModeChange,
  onDiffScopeChange,
  onToggleDiffLayout,
  onCopyPath,
  onReload,
  onSave,
  children,
}: {
  rootRef?: Ref<HTMLDivElement>;
  filePath: string;
  mode: FileViewerMode;
  canRenderMarkdown: boolean;
  canRenderDiff: boolean;
  diffScopeOptions: readonly DiffScopeOption[];
  activeDiffScope: FileDiffViewerScope | null;
  diffLayout: "unified" | "split";
  dirty: boolean;
  saveState: string;
  onModeChange: (mode: FileViewerMode) => void;
  onDiffScopeChange: (scope: FileDiffViewerScope) => void;
  onToggleDiffLayout: () => void;
  onCopyPath: () => void;
  onReload: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const basename = filePath.split("/").pop() ?? filePath;
  const parentPath = filePath.split("/").slice(0, -1).join("/");
  return (
    <div ref={rootRef} tabIndex={-1} className="flex h-full min-w-0 flex-col overflow-hidden outline-none">
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-sidebar-border bg-sidebar-background px-2 text-sidebar-foreground">
        <FileTreeEntryIcon name={basename} path={filePath} kind="file" className="size-3 shrink-0" />
        <div className="min-w-0 flex-1" title={filePath}>
          <div className="truncate text-sm font-[450] leading-4 text-sidebar-foreground [direction:ltr] [unicode-bidi:plaintext]">
            {basename}
          </div>
          {parentPath && (
            <div className="truncate text-xs leading-3 text-sidebar-muted-foreground [direction:ltr] [unicode-bidi:plaintext]">
              {parentPath}
            </div>
          )}
        </div>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-sidebar-foreground/50" />}
        {(markdown || canRenderDiff) && (
          <div className="flex shrink-0 items-center gap-1 border-l border-sidebar-border pl-1.5">
            {canRenderDiff && (
              <FileViewerModeButton
                active={mode === "diff"}
                label="Diff"
                onClick={() => onModeChange("diff")}
              >
                <GitBranch className="size-3" />
              </FileViewerModeButton>
            )}
            {markdown && (
              <FileViewerModeButton
                active={mode === "rendered"}
                label="Preview"
                onClick={() => onModeChange("rendered")}
              >
                <FileText className="size-3" />
              </FileViewerModeButton>
            )}
            <FileViewerModeButton
              active={mode === "edit"}
              label="Edit"
              onClick={() => onModeChange("edit")}
            >
              <FilePen className="size-3" />
            </FileViewerModeButton>
          </div>
        )}
        {canRenderDiff && mode === "diff" && diffScopeOptions.length > 1 && activeDiffScope && (
          <DiffScopePicker
            options={diffScopeOptions}
            activeScope={activeDiffScope}
            onScopeChange={onDiffScopeChange}
          />
        )}
        {canRenderDiff && mode === "diff" && (
          <Tooltip content={diffLayout === "split" ? "Unified diff" : "Split diff"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleDiffLayout}
              aria-label="Toggle diff layout"
              className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <SplitPanel className="size-3" />
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Copy path">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCopyPath}
            aria-label="Copy file path"
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Copy className="size-3" />
          </Button>
        </Tooltip>
        <Tooltip content="Reload">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReload}
            aria-label="Reload file"
            className="size-6 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <RefreshCw className="size-3" />
          </Button>
        </Tooltip>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={mode !== "edit" || !dirty || saveState === "saving"}
          loading={saveState === "saving"}
          className="h-6 border-sidebar-border bg-sidebar-accent px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent"
        >
          Save
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

function FileViewerModeButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={`h-6 gap-1 rounded-md px-1.5 text-xs ${active
        ? "bg-sidebar-accent text-sidebar-foreground"
        : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
    >
      {children}
      <span>{label}</span>
    </Button>
  );
}

function DiffScopePicker({
  options,
  activeScope,
  onScopeChange,
}: {
  options: readonly DiffScopeOption[];
  activeScope: FileDiffViewerScope;
  onScopeChange: (scope: FileDiffViewerScope) => void;
}) {
  const activeOption = options.find((option) => option.scope === activeScope) ?? options[0];

  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-md px-1.5 text-xs text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground"
          aria-label="Diff scope"
        >
          {activeOption.label}
          <ChevronDown className="size-3" />
        </Button>
      )}
      align="end"
      className={`w-48 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <PickerPopoverContent className="max-h-72">
          {options.map((option) => (
            <PopoverMenuItem
              key={option.scope}
              label={option.label}
              icon={<GitBranch className="size-3.5 text-muted-foreground" />}
              trailing={option.scope === activeScope
                ? <Check className="size-3.5 text-foreground/70" />
                : null}
              onClick={() => {
                onScopeChange(option.scope);
                close();
              }}
            >
              <span className="block truncate text-sm leading-4 text-muted-foreground">
                {option.description}
              </span>
            </PopoverMenuItem>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
