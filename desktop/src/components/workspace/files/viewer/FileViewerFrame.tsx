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
import { PopoverButton } from "@/components/ui/PopoverButton";
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <FileTreeEntryIcon name={basename} path={filePath} kind="file" className="size-4 shrink-0" />
        <div className="min-w-0 flex-1" title={filePath}>
          <div className="truncate text-sm font-medium leading-4 text-foreground [direction:ltr] [unicode-bidi:plaintext]">
            {basename}
          </div>
          {parentPath && (
            <div className="truncate text-[10px] leading-3 text-muted-foreground [direction:ltr] [unicode-bidi:plaintext]">
              {parentPath}
            </div>
          )}
        </div>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/50" />}
        {(markdown || canRenderDiff) && (
          <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
            {canRenderDiff && (
              <FileViewerModeButton
                active={mode === "diff"}
                label="Diff"
                onClick={() => onModeChange("diff")}
              >
                <GitBranch className="size-3.5" />
              </FileViewerModeButton>
            )}
            {markdown && (
              <FileViewerModeButton
                active={mode === "rendered"}
                label="Preview"
                onClick={() => onModeChange("rendered")}
              >
                <FileText className="size-3.5" />
              </FileViewerModeButton>
            )}
            <FileViewerModeButton
              active={mode === "edit"}
              label="Edit"
              onClick={() => onModeChange("edit")}
            >
              <FilePen className="size-3.5" />
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
              className="size-7"
            >
              <SplitPanel className="size-3.5" />
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
            className="size-7"
          >
            <Copy className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Reload">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onReload}
            aria-label="Reload file"
            className="size-7"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </Tooltip>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={mode !== "edit" || !dirty || saveState === "saving"}
          loading={saveState === "saving"}
          className="h-7 px-2 text-xs"
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
      className={`h-7 gap-1.5 rounded-md px-2 text-xs ${active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
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
          className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label="Diff scope"
        >
          {activeOption.label}
          <ChevronDown className="size-3" />
        </Button>
      )}
      align="end"
      className="w-48 rounded-xl border border-border bg-popover p-1 shadow-floating"
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
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {option.description}
              </span>
            </PopoverMenuItem>
          ))}
        </PickerPopoverContent>
      )}
    </PopoverButton>
  );
}
